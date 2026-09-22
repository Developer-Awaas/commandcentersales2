import { useState, useEffect } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId, DEFAULT_CREATIVE_PLATFORM } from '../lib/constants';
import { aiCall, isAiEnabled } from '../lib/ai-service';
import { generateImageWithGemini } from '../lib/gemini-service';
import { getBrandProvider } from '../lib/providers';
import { saveToolOutput, type AssetRef } from '../lib/history-service';
import { buildSMMCreativePrompt } from '../lib/smm-prompts';
import { resolveGenerationErrorMessage } from '../lib/smm-generation-error';
import { useToast } from '../contexts/ToastContext';
import { useGenerationLock } from '../hooks/useGenerationLock';
import { normalizeHashtags, formatHashtag, formatHashtags } from '../lib/hashtags';
import { MetaPostDialog } from '../components/MetaPostDialog';
import { fetchPublishTargets, canOfferPublish, EMPTY_TARGETS, type PublishTargets } from '../lib/publish-targets';

const C = {
  bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7', accent: '#2563EB',
  text: '#18181B', dim: '#71717A', red: '#ef4444', yellow: '#eab308',
  green: '#22c55e', blue: '#3b82f6', purple: '#8b5cf6'
};

const CREATIVE_TYPES = [
  { value: 'company_branding', label: 'Company Branding', desc: 'Logo, about us, team, office, values', icon: '🏢' },
  { value: 'project_branding', label: 'Project Spotlight', desc: 'Walkthrough, specifications, USPs', icon: '🏠' },
  { value: 'holiday', label: 'Holiday / Festival', desc: 'Diwali, Holi, Independence Day...', icon: '🎉' },
  { value: 'event', label: 'Event Post', desc: 'Launch, site visit day, ceremony', icon: '📅' },
  { value: 'engagement', label: 'Engagement Post', desc: 'Polls, Q&A, this-or-that', icon: '💬' },
  { value: 'awareness', label: 'Awareness / Education', desc: 'Real estate tips, market updates', icon: '📚' },
  { value: 'milestone', label: 'Milestone', desc: 'Units sold, years completed', icon: '🏆' },
  { value: 'testimonial', label: 'Testimonial', desc: 'Happy customer stories', icon: '⭐' },
];

// Kept for TODO(multi-platform) re-exposure — the picker UI using this was
// removed (see DEFAULT_CREATIVE_PLATFORM in lib/constants.ts). Exported so
// the unused-in-this-file array doesn't trip noUnusedLocals.
export const PLATFORMS = ['Nanobanana (Gemini)', 'ChatGPT / DALL-E', 'Canva', 'Adobe Express', 'Midjourney', 'Manual'];

export default function SMMCreatives() {
  const { showToast } = useToast();
  const { start: startGeneration, stop: stopGeneration } = useGenerationLock();
  const [type, setType] = useState('company_branding');
  const [description, setDescription] = useState('');
  const [project, setProject] = useState('');
  const [platform] = useState(DEFAULT_CREATIVE_PLATFORM);
  const [holiday, setHoliday] = useState('');
  const [event] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [savingLib, setSavingLib] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // The storage path behind imageUrl. Kept because saveToLibrary needs the
  // AssetRef (bucket + path), not the public URL, and the image is now made
  // before the save rather than during it.
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  // Publishing. The image lives in brand-assets under smm-creatives/ and has
  // no creative_assets row (that table is ads-specific), so provenance for an
  // SMM post rides tool_output_id instead — which is exactly what
  // published_assets.tool_output_id is for. Server path proven 2026-08-29.
  const [publishTargets, setPublishTargets] = useState<PublishTargets>(EMPTY_TARGETS);
  const [toolOutputId, setToolOutputId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('projects').select('*').eq('is_active', true).eq('org_id', getOrgId()).then(({ data }) => setProjects(data || []));
    supabase.from('events_calendar').select('*').eq('org_id', getOrgId()).order('date').then(({ data }) => setHolidays(data || []));
    // Read-only; returns EMPTY_TARGETS for a member or an unconfigured org, so
    // the button simply never renders rather than failing on click.
    fetchPublishTargets().then(setPublishTargets).catch(() => setPublishTargets(EMPTY_TARGETS));
  }, []);

  // The selected project's id. Looked up in three places before; one owner now.
  const currentProjectId = (): string | null =>
    projects.find(p => (p.name || p['Project Name']) === project)?.id || null;

  const generate = async () => {
    if (!isAiEnabled()) { showToast('AI features are currently unavailable', 'info'); return; }
    if (!description) { showToast('Describe what you want to create', 'info'); return; }
    // T-001 class: a second Generate starts from nothing. Every artefact keyed
    // to the previous result goes with it — the image, its storage path, and
    // the provenance id the publish button gates on — so run 2 can never
    // render run 1's picture under run 2's copy.
    setResult(null);
    setImageUrl(null);
    setImagePath(null);
    setImgError(null);
    setToolOutputId(null);
    setSavedProjectId(null);
    setLoading(true);
    startGeneration('Creating your post…');
    try {
      const proj = projects.find(p => (p.name || p['Project Name']) === project);
      // T-007a: the org's own kit. A failed read degrades to no brand
      // directives rather than blocking the post.
      const brandKit = await getBrandProvider().getBrandKit(getOrgId()).catch(() => null);
      const prompt = buildSMMCreativePrompt({ type, description, project: proj, holiday, event, platform, brandKit });
      const res = await aiCall(prompt);
      if (res && !res.error && !res.raw) {
        // Canonical form has no leading '#' — the UI adds exactly one. Doing
        // this here means smm_calendar and tool_outputs never store the
        // doubled shape either.
        const next: any = { ...res, hashtags: normalizeHashtags(res.hashtags) };
        setResult(next);
        // The image is part of the result now, not part of saving it. Awaited
        // so the button stays disabled across both phases.
        if (next.nanoPrompt) {
          const ref = await runImageStep(next.nanoPrompt, proj?.id ?? null);
          // T-016 (R-A): persist provenance the moment the image exists, not
          // on a manual Save — Post to Instagram/Meta gates on toolOutputId
          // (below) and previously that meant an unavoidable Save-first step.
          // This writes ONLY the tool_outputs row (status 'in_progress' — the
          // closest existing value to "draft"; the CHECK constraint has no
          // 'draft' and adding one needs a migration, out of scope here —
          // T-016b). It never touches smm_calendar: that INSERT is the actual
          // scheduling decision (today's date, a status of 'planned') and
          // stays exclusively behind the user's own Save to Library click.
          if (ref) {
            try {
              const saved = await saveToolOutput({
                orgId: getOrgId(),
                domain: 'social',
                tool: 'smm_creatives',
                campaignId: null,
                payload: { creative: next, creative_type: type, project: project || null, project_id: proj?.id ?? null },
                assetRefs: [ref],
                status: 'in_progress',
              });
              setToolOutputId(saved?.id ?? null);
              setSavedProjectId(proj?.id ?? null);
            } catch (autoErr) {
              // Best-effort — the image and copy are still fully usable;
              // Post to Instagram/Meta just stays hidden until Save to
              // Library runs its own (unchanged) fallback save.
              console.error('[SMM Creatives] auto-save provenance failed (non-fatal):', autoErr);
            }
          }
        }
        showToast('Creative generated!', 'success');
      } else {
        setResult(res?.raw ? { raw: res.raw } : null);
        showToast(resolveGenerationErrorMessage(res), 'error');
      }
    } catch { showToast('Error generating creative', 'error'); } finally { stopGeneration(); }
    setLoading(false);
  };

  // Decode a raw base64 image and upload it to storage under an SMM-specific
  // path (NOT a creative_assets row — that table is ads-creative-specific).
  // Returns the storage path, or null on failure.
  const uploadSmmImage = async (base64: string, mimeType: string): Promise<string | null> => {
    try {
      const byteString = atob(base64);
      const ia = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const ext = mimeType.split('/')[1] ?? 'png';
      const path = `smm-creatives/${getOrgId() || 'shared'}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('brand-assets')
        .upload(path, new Blob([ia], { type: mimeType }), { contentType: mimeType, upsert: true });
      if (error) { console.error('[SMM Creatives] upload failed:', error.message); return null; }
      return path;
    } catch (e) {
      console.error('[SMM Creatives] upload error:', e);
      return null;
    }
  };

  // The image step. generate() owns it; "Try again" re-runs it alone, and
  // saveToLibrary() falls back to it only when an earlier run failed and the
  // user saves anyway. Returns the AssetRef so the caller can persist it.
  const runImageStep = async (nanoPrompt: string, projectId: string | null): Promise<AssetRef | null> => {
    setImgBusy(true);
    setImgError(null);
    try {
      // Without costMeta the ledger defaults to feature='creatives', which
      // made SMM spend indistinguishable from ads spend in
      // agent_interactions (confirmed on a real $0.165 row, 2026-08-29).
      const imgs = await generateImageWithGemini(nanoPrompt, '1:1', undefined, undefined, {
        feature: 'smm-creative-gen',
        projectId,
      });
      if (!imgs[0]) throw new Error('generation service returned no image');
      const path = await uploadSmmImage(imgs[0].base64, imgs[0].mimeType);
      if (!path) throw new Error('upload returned no path');
      const { data } = supabase.storage.from('brand-assets').getPublicUrl(path);
      setImagePath(path);
      setImageUrl(data.publicUrl);
      return { bucket: 'brand-assets', path };
    } catch (imgErr) {
      // The raw provider text stays in the console. The banner gets our copy —
      // a model or storage error is not something a user can act on.
      console.error('[SMM Creatives] image gen/upload failed:', imgErr);
      setImgError(resolveGenerationErrorMessage({ error: 'the image could not be created' }));
      return null;
    } finally {
      setImgBusy(false);
    }
  };

  const saveToLibrary = async () => {
    if (!result || result.raw) return;
    setSavingLib(true);
    try {
      const projectId = currentProjectId();

      // The image already exists — generate() made it. Re-running here is the
      // fallback for one case only: that generation failed and the user chose
      // to save anyway. Still best-effort; a failure saves the text.
      const assetRefs: AssetRef[] = [];
      if (imagePath) {
        assetRefs.push({ bucket: 'brand-assets', path: imagePath });
      } else if (result.nanoPrompt) {
        const ref = await runImageStep(result.nanoPrompt, projectId);
        if (ref) assetRefs.push(ref);
      }

      // post_time is a `time` column — only pass a value that looks like HH:MM,
      // otherwise null (the AI's bestTime is often prose like "6:00 PM evening").
      const bestTime = typeof result.bestTime === 'string' && /^\d{1,2}:\d{2}$/.test(result.bestTime)
        ? result.bestTime : null;

      const { error } = await supabase.from('smm_calendar').insert({
        org_id: getOrgId(),
        project_id: projectId,
        post_date: new Date().toISOString().split('T')[0],
        post_time: bestTime,
        platform: result.bestPlatform || 'both',
        post_type: result.postType || 'static',
        category: type,
        topic: result.concept || description,
        caption_en: result.captionEn || '',
        caption_od: result.captionOd || '',
        hashtags: result.hashtags || [],
        nano_prompt: result.nanoPrompt || '',
        reel_script: result.reelScript || '',
        status: 'planned',
      });
      if (error) {
        console.error('[SMM Creatives] calendar save failed:', error);
        showToast('Failed to save. Try again.', 'error');
        return;
      }

      // History: durable tool_outputs record with the generated asset ref(s).
      // T-016: generate() already auto-saved this row the moment the image
      // existed (status 'in_progress') so publishing never had to wait on
      // this click — reuse that row (UPDATE, never a second INSERT) and
      // promote it to 'saved'. payload is rewritten too, since the project
      // dropdown isn't locked after generation and may have changed.
      // Best-effort — a history failure must never fail the calendar save.
      try {
        if (toolOutputId) {
          const { error: updErr } = await supabase.from('tool_outputs').update({
            payload: { creative: result, creative_type: type, project: project || null, project_id: projectId },
            status: 'saved',
          }).eq('id', toolOutputId);
          if (updErr) throw updErr;
          setSavedProjectId(projectId);
        } else {
          // Fallback: auto-save never ran (no image) or failed silently —
          // the original insert path, unchanged.
          const saved = await saveToolOutput({
            orgId: getOrgId(),
            domain: 'social',
            tool: 'smm_creatives',
            campaignId: null,
            payload: { creative: result, creative_type: type, project: project || null, project_id: projectId },
            assetRefs,
            status: 'saved',
          });
          // Provenance for a later publish. Best-effort like the rest of this
          // block: if history failed, publishing still works, the row just
          // carries no tool_output_id.
          setToolOutputId(saved?.id ?? null);
          setSavedProjectId(projectId);
        }
      } catch (histErr) {
        console.error('[SMM Creatives] tool_outputs (smm_creatives) save failed (non-fatal):', histErr);
      }

      showToast('Saved to Content Library!', 'success');
    } finally {
      setSavingLib(false);
    }
  };

  // One wait from the user's side: copy then image.
  const busy = loading || imgBusy;

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    showToast('Copied!', 'success');
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>SMM Creatives</h1>
        <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>Generate social media post designs for branding, events, and engagement</p>
      </div>

      {/* Type Selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {CREATIVE_TYPES.map(t => (
          <button key={t.value} onClick={() => setType(t.value)} style={{
            padding: 14, borderRadius: 10, cursor: 'pointer', textAlign: 'left',
            background: type === t.value ? C.accent + '15' : C.card,
            border: '1px solid ' + (type === t.value ? C.accent : C.border),
          }}>
            <span style={{ fontSize: 20, display: 'block', marginBottom: 4 }}>{t.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: type === t.value ? C.accent : C.text, display: 'block' }}>{t.label}</span>
            <span style={{ fontSize: 10, color: C.dim }}>{t.desc}</span>
          </button>
        ))}
      </div>

      {/* Form */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
          <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6 }}>Describe what you want</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder={type === 'holiday' ? 'e.g., Diwali wishes from Neelachala Homes with Zenith project integration' : type === 'project_branding' ? 'e.g., Showcase Zenith 3BHK flats with terrace amenities' : 'e.g., Team photo with New Year wishes'}
            rows={3} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13, resize: 'none', outline: 'none' }}
          />
          {(type === 'project_branding' || type === 'event') && (
            <>
              <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6, marginTop: 12 }}>Project (optional)</label>
              <select value={project} onChange={e => setProject(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}>
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.name || p['Project Name']}>{p.name || p['Project Name']}</option>)}
              </select>
            </>
          )}
          {type === 'holiday' && (
            <>
              <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6, marginTop: 12 }}>Festival / Holiday</label>
              <select value={holiday} onChange={e => setHoliday(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}>
                <option value="">Select...</option>
                {holidays.map(h => <option key={h.id} value={h.name}>{h.name} ({h.date})</option>)}
                <option value="custom">Custom Holiday</option>
              </select>
            </>
          )}
        </div>

        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
          <div style={{ padding: 12, borderRadius: 8, background: C.bg }}>
            <p style={{ fontSize: 12, color: C.dim, marginBottom: 4 }}>Selected type:</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>{CREATIVE_TYPES.find(t => t.value === type)?.icon} {CREATIVE_TYPES.find(t => t.value === type)?.label}</p>
            <p style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{CREATIVE_TYPES.find(t => t.value === type)?.desc}</p>
          </div>
        </div>
      </div>

      {/* Disabled across BOTH phases — the copy runs, then the image. One
          button, one wait, so nobody clicks Generate again mid-image. */}
      <button onClick={generate} disabled={busy || !description} style={{
        width: '100%', padding: 14, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: busy || !description ? 'default' : 'pointer',
        background: !busy && description ? C.accent : C.border, color: !busy && description ? C.bg : C.dim, border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {busy ? <><RefreshCw size={16} className="animate-spin" /> Creating your post… this takes 2-3 minutes</> : <><Sparkles size={16} /> Generate Creative</>}
      </button>

      {/* Result */}
      {result && !result.raw && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>{result.concept}</h3>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {result.postType && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: C.blue + '20', color: C.blue }}>{result.postType}</span>}
                  {result.bestPlatform && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: C.green + '20', color: C.green }}>{result.bestPlatform}</span>}
                  {result.bestTime && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: C.yellow + '20', color: C.yellow }}>{result.bestTime}</span>}
                </div>
              </div>
              <button onClick={saveToLibrary} disabled={savingLib} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: savingLib ? 'default' : 'pointer', background: C.accent + '15', color: C.accent, border: '1px solid ' + C.accent, opacity: savingLib ? 0.6 : 1 }}>
                {savingLib ? 'Saving…' : 'Save to Library'}
              </button>
            </div>

            {(imageUrl || imgBusy || imgError) && (
              <div style={{ marginBottom: 12 }}>
                {imageUrl && (
                  <img src={imageUrl} alt="Generated creative" style={{ width: '100%', maxWidth: 360, borderRadius: 10, border: '1px solid ' + C.border, display: 'block' }} />
                )}
                {imgBusy && !imageUrl && (
                  <p style={{ fontSize: 12, color: C.dim, margin: 0 }}>Creating your post… this takes 2-3 minutes</p>
                )}
                {imgError && (
                  <div style={{ background: C.red + '10', border: '1px solid ' + C.red + '40', borderRadius: 8, padding: 10, marginTop: imageUrl ? 8 : 0 }}>
                    <p style={{ fontSize: 12, color: C.red, margin: 0 }}>{imgError}</p>
                    <button
                      onClick={() => { if (result.nanoPrompt) runImageStep(result.nanoPrompt, currentProjectId()); }}
                      disabled={imgBusy}
                      style={{ marginTop: 8, padding: '6px 12px', borderRadius: 6, border: '1px solid ' + C.red, background: 'none', color: C.red, fontSize: 12, fontWeight: 600, cursor: imgBusy ? 'default' : 'pointer' }}
                    >
                      {imgBusy ? 'Trying…' : 'Try again'}
                    </button>
                  </div>
                )}
                {/* Gate is toolOutputId, not imageUrl. The image now exists
                    before the tool_outputs row does, and that row is what
                    published_assets.tool_output_id points at — the only
                    provenance an SMM post has (no creative_assets row). */}
                {toolOutputId && canOfferPublish(publishTargets, !!imageUrl) && (
                  <button
                    onClick={() => setPublishOpen(true)}
                    style={{ marginTop: 8, padding: '8px 14px', borderRadius: 8, border: '1px solid ' + C.accent, background: C.accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {/* SMM is an Instagram beat, but this org may be FB-only
                        (the sandbox currently is). Naming a channel we cannot
                        open on would be a lie on the button itself. */}
                    {publishTargets.igUserId ? 'Post to Instagram' : 'Post to Meta'}
                  </button>
                )}
              </div>
            )}

            {result.engagementHook && (
              <div style={{ background: C.accent + '10', border: '1px solid ' + C.accent + '30', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: C.accent, marginBottom: 2 }}>Engagement Hook (first line)</p>
                <p style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{result.engagementHook}</p>
              </div>
            )}

            {result.captionEn && (
              <div style={{ background: C.bg, padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Caption (English)</span>
                  <button onClick={() => copy(result.captionEn)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.captionEn}</p>
              </div>
            )}

            {result.captionOd && (
              <div style={{ background: C.bg, padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Caption (Odia)</span>
                  <button onClick={() => copy(result.captionOd)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.captionOd}</p>
              </div>
            )}
          </div>

          {/* Demoted: the picture is the result now, the prompts behind it are
              for whoever wants to re-run one by hand. Native <details> — the
              cards themselves are unchanged. */}
          {(result.nanoPrompt || result.nanoPromptStory) && (
            <details style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <summary style={{ fontSize: 12, color: C.dim, cursor: 'pointer' }}>Image prompts</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                {result.nanoPrompt && (
                  <div style={{ background: '#7c3aed10', border: '1px solid #7c3aed30', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#a78bfa' }}>{platform} Prompt (1080×1080)</span>
                      <button onClick={() => copy(result.nanoPrompt)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                    </div>
                    <p style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{result.nanoPrompt}</p>
                  </div>
                )}

                {result.nanoPromptStory && (
                  <div style={{ background: '#7c3aed10', border: '1px solid #7c3aed30', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#a78bfa' }}>Story Prompt (1080×1920)</span>
                      <button onClick={() => copy(result.nanoPromptStory)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                    </div>
                    <p style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{result.nanoPromptStory}</p>
                  </div>
                )}
              </div>
            </details>
          )}

          {result.carouselSlides && result.carouselSlides.length > 0 && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Carousel Slides</p>
              {result.carouselSlides.map((slide: string, i: number) => (
                <div key={i} style={{ background: C.bg, padding: 10, borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: C.dim }}>Slide {i + 1}</span>
                    <button onClick={() => copy(slide)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                  </div>
                  <p style={{ fontSize: 12, color: C.text }}>{slide}</p>
                </div>
              ))}
            </div>
          )}

          {result.reelScript && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1 }}>Reel Script</span>
                <button onClick={() => copy(result.reelScript)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
              </div>
              <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.reelScript}</p>
            </div>
          )}

          {result.hashtags && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1 }}>Hashtags</span>
                <button onClick={() => copy(formatHashtags(result.hashtags))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy All</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {result.hashtags.map((h: string, i: number) => (
                  <span key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: C.bg, color: C.dim }}>{formatHashtag(h)}</span>
                ))}
              </div>
            </div>
          )}

          {result.ctaSuggestion && (
            <div style={{ background: C.bg, borderRadius: 8, padding: 12 }}>
              <p style={{ fontSize: 11, color: C.dim }}>CTA Suggestion</p>
              <p style={{ fontSize: 13, color: C.accent }}>{result.ctaSuggestion}</p>
            </div>
          )}
        </div>
      )}

      {result?.raw && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20, marginTop: 20 }}>
          <p style={{ fontSize: 12, color: C.yellow }}>Couldn't parse output:</p>
          <pre style={{ fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', marginTop: 8 }}>{result.raw}</pre>
        </div>
      )}

      {publishOpen && imageUrl && (
        <MetaPostDialog
          targets={publishTargets}
          imageUrl={imageUrl}
          /* No creative_assets row exists for an SMM image by design — the
             provenance link is tool_output_id. published_assets accepts that
             and the server path was proven live on 2026-08-29. */
          creativeAssetId={null}
          toolOutputId={toolOutputId}
          projectId={savedProjectId}
          preferredPlatform="instagram"
          defaultCaption={[
            result?.engagementHook,
            result?.captionEn,
            result?.hashtags?.length ? formatHashtags(result.hashtags) : '',
          ].filter(Boolean).join('\n\n')}
          onClose={() => setPublishOpen(false)}
        />
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { Brain, Upload, Trash2, Sparkles, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Image as ImageIcon, TrendingUp, Eye, Copy, Check, Bot } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { aiCall, logToLangfuse } from '../lib/ai-service';

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = 'own_ad' | 'competitor' | 'industry_reference' | 'winning_template';
type Platform = 'meta_feed' | 'meta_story' | 'instagram_feed' | 'instagram_story' | 'whatsapp' | 'google_display';
type PerformanceTier = 'top_performer' | 'good_performer' | 'average' | 'underperformer' | 'reference_only';

interface TrainingCreative {
  id: string;
  image_url: string;
  storage_path: string | null;
  source: Source;
  platform: Platform | null;
  performance_tier: PerformanceTier;
  cpl: number | null;
  ctr: number | null;
  notes: string | null;
  vision_analysis: { description?: string; patterns?: string[] } | null;
  extracted_patterns: Record<string, unknown> | null;
  created_at: string;
  project_id: string | null;
}

interface Project {
  id: string;
  name: string;
}

interface DesignDNA {
  dna_summary: string | null;
  confidence_level: string | null;
  last_recomputed_at: string | null;
  best_performing_angles: unknown[] | null;
  best_performing_compositions: unknown[] | null;
  best_performing_color_treatments: unknown[] | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<Source, string> = {
  own_ad: 'Our Ad',
  competitor: 'Competitor',
  industry_reference: 'Industry Ref',
  winning_template: 'Winning Template',
};

const TIER_LABELS: Record<PerformanceTier, string> = {
  top_performer: 'Top Performer',
  good_performer: 'Good Performer',
  average: 'Average',
  underperformer: 'Underperformer',
  reference_only: 'Reference Only',
};

const TIER_COLORS: Record<PerformanceTier, string> = {
  top_performer: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  good_performer: 'bg-blue-100 text-blue-800 border-blue-200',
  average: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  underperformer: 'bg-red-100 text-red-800 border-red-200',
  reference_only: 'bg-surface-subtle text-text-secondary border-border',
};

const PLATFORM_LABELS: Record<Platform, string> = {
  meta_feed: 'Meta Feed',
  meta_story: 'Meta Story',
  instagram_feed: 'IG Feed',
  instagram_story: 'IG Story',
  whatsapp: 'WhatsApp',
  google_display: 'Google Display',
};

// ─── Vision analysis via Claude Haiku ─────────────────────────────────────────

async function analyzeCreativeWithVision(imageUrl: string): Promise<{ description: string; patterns: string[] } | null> {
  const apiKey = localStorage.getItem('claude_api_key') || (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) || '';
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            {
              type: 'text',
              text: `You are Aanya Mehta, Senior Creative Director. Analyze this real estate ad creative.

Return a JSON object with exactly these fields:
{
  "description": "2-3 sentence visual description: layout type, dominant visual element, color palette (include hex if readable), typography style, and overall mood",
  "patterns": ["pattern1", "pattern2", "pattern3", "pattern4", "pattern5"]
}

For "patterns", extract 4-6 specific design/copy patterns like:
- Layout: "dark background with dual photo cards"
- Color: "gold accent on navy base"
- Typography: "bold sans-serif headline + light subtext"
- Copy angle: "price + urgency CTA"
- Composition: "architectural hero shot + feature checklist"
- Mood: "aspirational luxury"

Return ONLY the JSON object, no markdown, no preamble.`,
            },
          ],
        }],
      }),
    });

    if (!res.ok) {
      logToLangfuse('aanya-memory-vision-analysis', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: `API error ${res.status}` });
      return null;
    }
    const data = await res.json() as { content?: { type: string; text: string }[]; usage?: { input_tokens: number; output_tokens: number } };
    const text = (data?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const parsed = JSON.parse(text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim());
    logToLangfuse('aanya-memory-vision-analysis', {
      output: parsed,
      model: 'claude-haiku-4-5-20251001',
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
    });
    return parsed as { description: string; patterns: string[] };
  } catch (err) {
    logToLangfuse('aanya-memory-vision-analysis', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error' });
    return null;
  }
}

// ─── DNA Synthesis ────────────────────────────────────────────────────────────

async function synthesizeDNA(
  creatives: TrainingCreative[],
  projectId: string,
  projectName: string
): Promise<{ success: boolean; summary: string; cleared: number }> {
  const topPerformers = creatives.filter(c => c.performance_tier === 'top_performer' || c.performance_tier === 'good_performer');
  const underperformers = creatives.filter(c => c.performance_tier === 'underperformer');

  const topPatterns = topPerformers.flatMap(c => c.vision_analysis?.patterns ?? []).filter(Boolean);
  const badPatterns = underperformers.flatMap(c => c.vision_analysis?.patterns ?? []).filter(Boolean);
  const topDescriptions = topPerformers
    .map(c => c.vision_analysis?.description).filter(Boolean).slice(0, 6).join('\n');

  const prompt = `You are Aanya Mehta, Senior Creative Director for Indian real estate advertising.

Project: ${projectName}
Training creatives: ${creatives.length} total — ${topPerformers.length} top/good performers, ${underperformers.length} underperformers

TOP PERFORMER VISUAL PATTERNS (what works):
${topPatterns.length > 0 ? topPatterns.map(p => `- ${p}`).join('\n') : 'None tagged yet'}

TOP PERFORMER DESCRIPTIONS:
${topDescriptions || 'None available yet'}

UNDERPERFORMER PATTERNS (what to avoid):
${badPatterns.length > 0 ? badPatterns.map(p => `- ${p}`).join('\n') : 'None tagged yet'}

Based on this training data, synthesize the Design DNA for this project.

Return a JSON object:
{
  "dna_summary": "3-5 sentence paragraph describing the winning creative formula for this project — layout style, color approach, copy angle, typography, mood. Written as a briefing note Aanya would use when generating new creatives.",
  "best_performing_angles": ["angle1", "angle2", "angle3"],
  "best_performing_compositions": ["composition1", "composition2"],
  "best_performing_color_treatments": ["treatment1", "treatment2"],
  "best_performing_copy_angles": ["copyangle1", "copyangle2"],
  "underperforming_patterns": ["badpattern1", "badpattern2"],
  "confidence_level": "low|medium|high"
}

Return ONLY the JSON object.`;

  const result = await aiCall(
    prompt,
    'You are Aanya Mehta. Respond ONLY in valid JSON.',
    16000,
    { traceName: 'aanya-memory-synthesize-dna' }
  );

  if (result.error) return { success: false, summary: result.error as string, cleared: 0 };

  const parsed = result as {
    dna_summary?: string;
    best_performing_angles?: string[];
    best_performing_compositions?: string[];
    best_performing_color_treatments?: string[];
    best_performing_copy_angles?: string[];
    underperforming_patterns?: string[];
    confidence_level?: string;
  };

  const orgId = getOrgId();
  const { error } = await supabase.from('project_design_systems').upsert({
    project_id: projectId,
    org_id: orgId,
    dna_summary: parsed.dna_summary ?? '',
    best_performing_angles: (parsed.best_performing_angles ?? []).map(a => ({ angle: a, avg_cpl: 0, sample_size: 1 })),
    best_performing_compositions: (parsed.best_performing_compositions ?? []).map(c => ({ composition: c, avg_cpl: 0, sample_size: 1 })),
    best_performing_color_treatments: (parsed.best_performing_color_treatments ?? []).map(c => ({ color_treatment: c, avg_cpl: 0, sample_size: 1 })),
    best_performing_copy_angles: (parsed.best_performing_copy_angles ?? []).map(c => ({ copy_angle: c, avg_cpl: 0, sample_size: 1 })),
    underperforming_patterns: (parsed.underperforming_patterns ?? []).map(p => ({ pattern: p, sample_size: 1 })),
    confidence_level: parsed.confidence_level ?? 'low',
    total_creatives_analyzed: creatives.length,
    last_recomputed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id' });

  if (error) return { success: false, summary: `DB error: ${error.message}`, cleared: 0 };

  // ── Cleanup: delete source records and storage files after successful synthesis ──
  // Only the distilled DNA in project_design_systems is kept; raw training data is disposable.
  const storagePaths = creatives.map(c => c.storage_path).filter((p): p is string => Boolean(p));
  if (storagePaths.length > 0) {
    await supabase.storage.from('brand-assets').remove(storagePaths);
  }
  const ids = creatives.map(c => c.id);
  await supabase.from('aanya_training_creatives').delete().in('id', ids);

  return { success: true, summary: parsed.dna_summary ?? 'DNA synthesized.', cleared: creatives.length };
}

// ─── Upload card component ─────────────────────────────────────────────────────

interface UploadCardProps {
  projects: Project[];
  onUploaded: () => void;
}

function UploadCard({ projects, onUploaded }: UploadCardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [source, setSource] = useState<Source>('own_ad');
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [tier, setTier] = useState<PerformanceTier>('reference_only');
  const [cpl, setCpl] = useState('');
  const [ctr, setCtr] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const blobRef = useRef<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleFile = useCallback((f: File) => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    const url = URL.createObjectURL(f);
    blobRef.current = url;
    setFile(f);
    setPreview(url);
  }, []);

  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  };

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      // Force-refresh the session so the JWT sent to Postgres is always valid.
      // getSession() alone reads from localStorage and may be stale; refreshSession()
      // hits the Supabase auth server and returns a fresh access token.
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      const session = refreshData?.session;
      if (refreshErr || !session) throw new Error('Session expired — please sign out and sign back in.');

      // Read org_id from the live authenticated profile (not localStorage fallback)
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('org_id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profileErr) throw new Error(`Profile error: ${profileErr.message}`);
      if (!profile?.org_id) throw new Error('Could not load your organisation profile. Contact admin.');
      const orgId = profile.org_id;

      const ext = file.type.split('/')[1] ?? 'jpg';
      const path = `aanya-training/${orgId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: storErr } = await supabase.storage.from('brand-assets').upload(path, file, { contentType: file.type, upsert: false });
      if (storErr) {
        const msg = storErr.message ?? '';
        if (msg.toLowerCase().includes('bucket') || msg.toLowerCase().includes('not found')) {
          throw new Error('Storage: bucket "brand-assets" not found — create it in Supabase → Storage.');
        }
        if (msg.toLowerCase().includes('security') || msg.toLowerCase().includes('rls') || msg.toLowerCase().includes('policy') || msg.toLowerCase().includes('violates')) {
          throw new Error('Storage upload blocked by RLS — run storage policy SQL in Supabase SQL Editor (see docs/aanya-memory-schema.md).');
        }
        throw new Error(`Storage upload failed: ${msg}`);
      }

      const { data: urlData } = supabase.storage.from('brand-assets').getPublicUrl(path);
      const imageUrl = urlData.publicUrl;

      // Vision analysis in background
      const visionResult = await analyzeCreativeWithVision(imageUrl);

      const { error: dbErr } = await supabase.from('aanya_training_creatives').insert({
        org_id: orgId,
        project_id: projectId || null,
        image_url: imageUrl,
        storage_path: path,
        source,
        platform: platform || null,
        performance_tier: tier,
        cpl: cpl ? parseFloat(cpl) : null,
        ctr: ctr ? parseFloat(ctr) : null,
        notes: notes || null,
        vision_analysis: visionResult,
        extracted_patterns: visionResult ? { patterns: visionResult.patterns } : null,
      });

      if (dbErr) throw new Error(dbErr.message);

      // Reset form
      setFile(null);
      setPreview(null);
      setCpl(''); setCtr(''); setNotes('');
      setTier('reference_only');
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-text-primary flex items-center gap-2">
        <Upload className="w-4 h-4 text-accent" />
        Add Training Creative
      </h3>

      {/* Drop zone */}
      <div
        ref={dropRef}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => document.getElementById('atc-file-input')?.click()}
        className="border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent/60 hover:bg-surface-subtle/40 transition-colors min-h-[120px]"
      >
        {preview ? (
          <img src={preview} alt="preview" className="max-h-28 max-w-full object-contain rounded" />
        ) : (
          <>
            <ImageIcon className="w-8 h-8 text-text-muted" />
            <p className="text-sm text-text-secondary">Drag & drop or click to select image</p>
            <p className="text-xs text-text-muted">JPG, PNG, WebP</p>
          </>
        )}
      </div>
      <input
        id="atc-file-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Project</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Source</label>
          <select value={source} onChange={e => setSource(e.target.value as Source)} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
            {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Platform</label>
          <select value={platform ?? ''} onChange={e => setPlatform(e.target.value as Platform || null)} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
            <option value="">Any</option>
            {Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Performance Tier</label>
          <select value={tier} onChange={e => setTier(e.target.value as PerformanceTier)} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
            {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">CPL (₹, optional)</label>
          <input type="number" value={cpl} onChange={e => setCpl(e.target.value)} placeholder="e.g. 420" className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary" />
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">CTR (%, optional)</label>
          <input type="number" step="0.01" value={ctr} onChange={e => setCtr(e.target.value)} placeholder="e.g. 1.8" className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs text-text-secondary mb-1 block">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="What made this work / not work?"
          rows={2}
          className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary resize-none"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 leading-relaxed">
          {error}
        </div>
      )}

      {!file && (
        <p className="text-xs text-text-muted text-center">Select an image above to enable upload</p>
      )}

      <button
        onClick={upload}
        disabled={!file || uploading}
        style={{ backgroundColor: file ? '#18181B' : '#A1A1AA', color: '#ffffff', cursor: file ? 'pointer' : 'not-allowed' }}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading + Analysing...</> : <><Upload className="w-4 h-4" /> Upload & Analyse</>}
      </button>
    </div>
  );
}

// ─── Creative card component ───────────────────────────────────────────────────

interface CreativeCardProps {
  creative: TrainingCreative;
  onDelete: (id: string) => void;
}

function CreativeCard({ creative, onDelete }: CreativeCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden group">
      <div className="relative">
        <img src={creative.image_url} alt="training creative" className="w-full aspect-square object-cover" loading="lazy" />
        <button
          onClick={() => onDelete(creative.id)}
          className="absolute top-2 right-2 p-1.5 bg-danger text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <span className={`absolute bottom-2 left-2 text-xs font-medium px-2 py-0.5 rounded-full border ${TIER_COLORS[creative.performance_tier]}`}>
          {TIER_LABELS[creative.performance_tier]}
        </span>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <span className="text-xs text-text-muted">{SOURCE_LABELS[creative.source]}</span>
          {creative.platform && (
            <span className="text-xs bg-surface-subtle border border-border rounded px-1.5 py-0.5 text-text-secondary">
              {PLATFORM_LABELS[creative.platform]}
            </span>
          )}
        </div>

        {(creative.cpl || creative.ctr) && (
          <div className="flex gap-3 text-xs text-text-secondary">
            {creative.cpl && <span>CPL ₹{creative.cpl}</span>}
            {creative.ctr && <span>CTR {creative.ctr}%</span>}
          </div>
        )}

        {creative.vision_analysis && (
          <>
            <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80">
              <Eye className="w-3.5 h-3.5" />
              Aanya's Analysis
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {expanded && (
              <div className="text-xs text-text-secondary space-y-2 pt-1">
                {creative.vision_analysis.description && (
                  <p className="leading-relaxed">{creative.vision_analysis.description}</p>
                )}
                {creative.vision_analysis.patterns && creative.vision_analysis.patterns.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {creative.vision_analysis.patterns.map((p, i) => (
                      <span key={i} className="bg-surface-subtle border border-border rounded px-1.5 py-0.5 text-[11px]">{p}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── DNA Panel ────────────────────────────────────────────────────────────────

interface DNAPanelProps {
  projectId: string;
  projectName: string;
  creatives: TrainingCreative[];
  onSynthesized: () => void;
}

function DNAPanel({ projectId, projectName, creatives, onSynthesized }: DNAPanelProps) {
  const [dna, setDna] = useState<DesignDNA | null>(null);
  const [loading, setLoading] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    supabase.from('project_design_systems').select('dna_summary,confidence_level,last_recomputed_at,best_performing_angles,best_performing_compositions,best_performing_color_treatments').eq('project_id', projectId).maybeSingle()
      .then(({ data }) => setDna(data));
  }, [projectId]);

  async function handleSynthesize() {
    setSynthesizing(true);
    setResult(null);
    setLoading(true);
    const { success, summary, cleared } = await synthesizeDNA(creatives, projectId, projectName);
    if (success) {
      setResult({ ok: true, msg: `DNA synthesized from ${cleared} creative${cleared !== 1 ? 's' : ''} — training data cleared. Aanya will use this for all future generations.` });
      const { data } = await supabase.from('project_design_systems').select('dna_summary,confidence_level,last_recomputed_at,best_performing_angles,best_performing_compositions,best_performing_color_treatments').eq('project_id', projectId).maybeSingle();
      setDna(data);
      onSynthesized();
    } else {
      setResult({ ok: false, msg: summary });
    }
    setSynthesizing(false);
    setLoading(false);
  }

  const topAngles = (dna?.best_performing_angles as Array<{ angle?: string }> | null)?.map(a => a?.angle).filter(Boolean) ?? [];
  const topComps = (dna?.best_performing_compositions as Array<{ composition?: string }> | null)?.map(c => c?.composition).filter(Boolean) ?? [];
  const topColors = (dna?.best_performing_color_treatments as Array<{ color_treatment?: string }> | null)?.map(c => c?.color_treatment).filter(Boolean) ?? [];

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-500" />
          Design DNA
        </h3>
        <button
          onClick={handleSynthesize}
          disabled={synthesizing || creatives.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium disabled:opacity-50 hover:bg-purple-700 transition-colors"
        >
          {synthesizing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Synthesizing...</> : <><Sparkles className="w-3.5 h-3.5" />Synthesize DNA</>}
        </button>
      </div>

      {result && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-danger border border-red-200'}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          {result.msg}
        </div>
      )}

      {loading && !dna && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading DNA...
        </div>
      )}

      {dna?.dna_summary ? (
        <div className="space-y-3">
          <div className="bg-surface-subtle rounded-lg p-3">
            <p className="text-sm text-text-primary leading-relaxed">{dna.dna_summary}</p>
          </div>

          <div className="flex gap-2 flex-wrap text-xs text-text-secondary">
            <span className="bg-surface-subtle border border-border rounded px-2 py-0.5">
              Confidence: <strong className="text-text-primary">{dna.confidence_level ?? '—'}</strong>
            </span>
            {dna.last_recomputed_at && (
              <span className="bg-surface-subtle border border-border rounded px-2 py-0.5">
                Updated {new Date(dna.last_recomputed_at).toLocaleDateString('en-IN')}
              </span>
            )}
          </div>

          {topAngles.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-1">Top Angles</p>
              <div className="flex flex-wrap gap-1">
                {topAngles.map((a, i) => <span key={i} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5">{a}</span>)}
              </div>
            </div>
          )}

          {topComps.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-1">Compositions</p>
              <div className="flex flex-wrap gap-1">
                {topComps.map((c, i) => <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5">{c}</span>)}
              </div>
            </div>
          )}

          {topColors.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-1">Color Treatments</p>
              <div className="flex flex-wrap gap-1">
                {topColors.map((c, i) => <span key={i} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-0.5">{c}</span>)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          {creatives.length === 0
            ? 'Upload at least one training creative to synthesize DNA.'
            : 'Click "Synthesize DNA" to distil patterns from your training creatives.'}
        </p>
      )}
    </div>
  );
}

// ─── Crawl Parameters Panel ───────────────────────────────────────────────────

const PATTERN_CATEGORIES = ['Layout', 'Color', 'Typography', 'Copy angle', 'Composition', 'Mood'] as const;
type PatternCategory = typeof PATTERN_CATEGORIES[number];

const CATEGORY_COLORS: Record<PatternCategory, string> = {
  Layout:       'bg-blue-50 text-blue-700 border-blue-200',
  Color:        'bg-purple-50 text-purple-700 border-purple-200',
  Typography:   'bg-amber-50 text-amber-700 border-amber-200',
  'Copy angle': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Composition:  'bg-rose-50 text-rose-700 border-rose-200',
  Mood:         'bg-cyan-50 text-cyan-700 border-cyan-200',
};

function categorizePattern(p: string): PatternCategory {
  const lower = p.toLowerCase();
  for (const cat of PATTERN_CATEGORIES) {
    if (lower.startsWith(cat.toLowerCase() + ':')) return cat;
  }
  if (lower.includes('color') || lower.includes('palette') || lower.includes('hex') || lower.includes('bg ') || lower.includes('background')) return 'Color';
  if (lower.includes('font') || lower.includes('type') || lower.includes('sans') || lower.includes('serif') || lower.includes('headline') || lower.includes('bold')) return 'Typography';
  if (lower.includes('cta') || lower.includes('copy') || lower.includes('price') || lower.includes('urgency') || lower.includes('hook')) return 'Copy angle';
  if (lower.includes('shot') || lower.includes('hero') || lower.includes('card') || lower.includes('grid') || lower.includes('layout') || lower.includes('split')) return 'Composition';
  if (lower.includes('luxury') || lower.includes('aspirational') || lower.includes('minimal') || lower.includes('mood') || lower.includes('warm') || lower.includes('cool')) return 'Mood';
  return 'Layout';
}

function stripCategoryPrefix(p: string): string {
  return p.replace(/^[^:]+:\s*/i, '');
}

interface CrawlParametersPanelProps {
  creatives: TrainingCreative[];
  selectedProject: string;
  projects: Project[];
}

function CrawlParametersPanel({ creatives, selectedProject, projects }: CrawlParametersPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const topPerformers = creatives.filter(c => c.performance_tier === 'top_performer' || c.performance_tier === 'good_performer');
  const underperformers = creatives.filter(c => c.performance_tier === 'underperformer');

  // Aggregate patterns from top performers, deduplicated
  const topPatterns = Array.from(new Set(topPerformers.flatMap(c => c.vision_analysis?.patterns ?? [])));
  const avoidPatterns = Array.from(new Set(underperformers.flatMap(c => c.vision_analysis?.patterns ?? [])));

  // Group top patterns by category
  const grouped = PATTERN_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = topPatterns.filter(p => categorizePattern(p) === cat).map(stripCategoryPrefix);
    return acc;
  }, {} as Record<PatternCategory, string[]>);

  // Platform distribution (top performers only, fall back to all)
  const platformSource = topPerformers.length > 0 ? topPerformers : creatives;
  const platformCounts: Record<string, number> = {};
  platformSource.forEach(c => {
    if (c.platform) platformCounts[c.platform] = (platformCounts[c.platform] ?? 0) + 1;
  });
  const platformsSorted = Object.entries(platformCounts).sort(([, a], [, b]) => b - a);

  // Source distribution (all creatives)
  const sourceCounts: Record<string, number> = {};
  creatives.forEach(c => { sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1; });

  // CPL/CTR ranges from top performers
  const cpls = topPerformers.map(c => c.cpl).filter((v): v is number => v !== null);
  const ctrs = topPerformers.map(c => c.ctr).filter((v): v is number => v !== null);

  const descriptions = topPerformers.map(c => c.vision_analysis?.description).filter((d): d is string => Boolean(d));

  const projectName = selectedProject !== 'all'
    ? (projects.find(p => p.id === selectedProject)?.name ?? 'Selected Project')
    : 'All Projects';

  const agentJSON = {
    generated_at: new Date().toISOString(),
    scope: projectName,
    training_set: {
      total_creatives: creatives.length,
      top_good_performers: topPerformers.length,
      underperformers: underperformers.length,
      platforms: platformCounts,
      sources: sourceCounts,
      ...(cpls.length > 0 && { cpl_range_inr: { min: Math.min(...cpls), max: Math.max(...cpls), avg: Math.round(cpls.reduce((a, b) => a + b, 0) / cpls.length) } }),
      ...(ctrs.length > 0 && { ctr_range_pct: { min: Math.min(...ctrs), max: Math.max(...ctrs), avg: parseFloat((ctrs.reduce((a, b) => a + b, 0) / ctrs.length).toFixed(2)) } }),
    },
    crawl_targets: {
      platforms_to_prioritize: platformsSorted.map(([p]) => p),
      visual_patterns_to_replicate: grouped,
      sample_visual_descriptions: descriptions.slice(0, 5),
    },
    avoid: {
      patterns: avoidPatterns,
    },
  };

  const jsonString = JSON.stringify(agentJSON, null, 2);

  function copyJSON() {
    navigator.clipboard.writeText(jsonString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (creatives.length === 0) return null;

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-text-primary flex items-center gap-2">
            <Bot className="w-4 h-4 text-accent" />
            Crawl Parameters
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Aggregated parameters from {creatives.length} training creatives · feed directly to your crawling agents
          </p>
        </div>
        <button
          onClick={copyJSON}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ backgroundColor: '#18181B', color: '#ffffff' }}
        >
          {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy JSON</>}
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Creatives', value: creatives.length, color: 'text-text-primary' },
          { label: 'Top / Good Performers', value: topPerformers.length, color: 'text-emerald-600' },
          { label: 'Patterns Extracted', value: topPatterns.length, color: 'text-purple-600' },
          { label: 'Platforms Covered', value: Object.keys(platformCounts).length, color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="bg-surface-subtle rounded-lg px-3 py-2.5 text-center border border-border">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Pattern categories */}
      {topPatterns.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Top-Performer Visual Patterns</p>
          <div className="space-y-2.5">
            {PATTERN_CATEGORIES.filter(cat => grouped[cat].length > 0).map(cat => (
              <div key={cat} className="flex items-start gap-2">
                <span className="text-[11px] font-medium text-text-muted w-24 shrink-0 pt-0.5">{cat}</span>
                <div className="flex flex-wrap gap-1.5">
                  {grouped[cat].map((p, i) => (
                    <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[cat]}`}>{p}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Platform + Source side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {platformsSorted.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Platforms (top performers)</p>
            <div className="space-y-1.5">
              {platformsSorted.map(([platform, count]) => {
                const pct = Math.round((count / platformSource.length) * 100);
                return (
                  <div key={platform} className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary w-28 shrink-0">{PLATFORM_LABELS[platform as Platform] ?? platform}</span>
                    <div className="flex-1 bg-surface-subtle rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-text-muted w-6 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Source Breakdown</p>
          <div className="space-y-1.5">
            {Object.entries(sourceCounts).sort(([, a], [, b]) => b - a).map(([src, count]) => {
              const pct = Math.round((count / creatives.length) * 100);
              return (
                <div key={src} className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-28 shrink-0">{SOURCE_LABELS[src as Source] ?? src}</span>
                  <div className="flex-1 bg-surface-subtle rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-purple-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-text-muted w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* CPL / CTR ranges */}
      {(cpls.length > 0 || ctrs.length > 0) && (
        <div className="flex flex-wrap gap-3">
          {cpls.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">
              <span className="text-emerald-700 font-medium">CPL range (top performers): </span>
              <span className="text-emerald-800">₹{Math.min(...cpls)} – ₹{Math.max(...cpls)} · avg ₹{Math.round(cpls.reduce((a, b) => a + b, 0) / cpls.length)}</span>
            </div>
          )}
          {ctrs.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs">
              <span className="text-blue-700 font-medium">CTR range (top performers): </span>
              <span className="text-blue-800">{Math.min(...ctrs)}% – {Math.max(...ctrs)}% · avg {(ctrs.reduce((a, b) => a + b, 0) / ctrs.length).toFixed(2)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Avoid patterns */}
      {avoidPatterns.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Avoid (underperformer patterns)</p>
          <div className="flex flex-wrap gap-1.5">
            {avoidPatterns.map((p, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200">{stripCategoryPrefix(p)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Raw JSON toggle */}
      <div className="border-t border-border pt-3">
        <button
          onClick={() => setShowRaw(r => !r)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showRaw ? 'Hide' : 'Show'} raw JSON
        </button>
        {showRaw && (
          <pre className="mt-2 text-[11px] text-text-secondary bg-surface-subtle rounded-lg p-3 overflow-x-auto max-h-64 leading-relaxed">
            {jsonString}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AanyaMemory() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creatives, setCreatives] = useState<TrainingCreative[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [filterTier, setFilterTier] = useState<PerformanceTier | 'all'>('all');
  const [loadingCreatives, setLoadingCreatives] = useState(true);

  const orgId = getOrgId();

  async function fetchProjects() {
    const { data } = await supabase.from('projects').select('id, name').eq('org_id', orgId).order('name');
    setProjects(data ?? []);
  }

  async function fetchCreatives() {
    setLoadingCreatives(true);
    let q = supabase.from('aanya_training_creatives').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
    if (selectedProject !== 'all') q = q.eq('project_id', selectedProject);
    if (filterTier !== 'all') q = q.eq('performance_tier', filterTier);
    const { data } = await q;
    setCreatives((data ?? []) as TrainingCreative[]);
    setLoadingCreatives(false);
  }

  useEffect(() => { fetchProjects(); }, []);
  useEffect(() => { fetchCreatives(); }, [selectedProject, filterTier]);

  async function deleteCreative(id: string) {
    await supabase.from('aanya_training_creatives').delete().eq('id', id);
    setCreatives(prev => prev.filter(c => c.id !== id));
  }

  const projectForDNA = selectedProject !== 'all' ? projects.find(p => p.id === selectedProject) : null;
  const creativesForDNA = selectedProject !== 'all' ? creatives.filter(c => c.project_id === selectedProject) : creatives;

  const stats = {
    total: creatives.length,
    top: creatives.filter(c => c.performance_tier === 'top_performer').length,
    withAnalysis: creatives.filter(c => c.vision_analysis !== null).length,
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-500" />
            Aanya's Memory
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Train Aanya on real-world creatives. The more she learns, the better she generates.
          </p>
        </div>

        {/* Stats bar */}
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-text-primary">{stats.total}</p>
            <p className="text-xs text-text-muted">Creatives</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">{stats.top}</p>
            <p className="text-xs text-text-muted">Top Performers</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-600">{stats.withAnalysis}</p>
            <p className="text-xs text-text-muted">AI Analysed</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={selectedProject}
          onChange={e => setSelectedProject(e.target.value)}
          className="text-sm bg-surface-card border border-border rounded-lg px-3 py-2 text-text-primary"
        >
          <option value="all">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select
          value={filterTier}
          onChange={e => setFilterTier(e.target.value as PerformanceTier | 'all')}
          className="text-sm bg-surface-card border border-border rounded-lg px-3 py-2 text-text-primary"
        >
          <option value="all">All Tiers</option>
          {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* Crawl Parameters */}
      <CrawlParametersPanel creatives={creatives} selectedProject={selectedProject} projects={projects} />

      {/* 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_300px] gap-6">
        {/* Left: Upload + DNA */}
        <div className="space-y-4">
          <UploadCard projects={projects} onUploaded={fetchCreatives} />
          {(projectForDNA || selectedProject !== 'all') && projects.length > 0 && (
            <DNAPanel
              projectId={projectForDNA?.id ?? projects[0]?.id ?? ''}
              projectName={projectForDNA?.name ?? projects[0]?.name ?? 'All Projects'}
              creatives={creativesForDNA}
              onSynthesized={fetchCreatives}
            />
          )}
          {selectedProject === 'all' && projects.length > 0 && (
            <div className="bg-surface-card border border-border rounded-xl p-4 text-sm text-text-secondary flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              Select a project to synthesize its Design DNA.
            </div>
          )}
        </div>

        {/* Middle + Right: Gallery */}
        <div className="lg:col-span-2">
          {loadingCreatives ? (
            <div className="flex items-center justify-center py-16 text-text-muted gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading training creatives...
            </div>
          ) : creatives.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3 border-2 border-dashed border-border rounded-xl">
              <Brain className="w-10 h-10 text-text-muted" />
              <p className="text-text-secondary font-medium">No training creatives yet</p>
              <p className="text-sm text-text-muted max-w-xs">Upload your best-performing ads and reference images so Aanya can learn your brand's winning formula.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {creatives.map(c => (
                <CreativeCard key={c.id} creative={c} onDelete={deleteCreative} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

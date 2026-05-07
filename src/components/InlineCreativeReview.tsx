import { useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Eye, RefreshCw, Sparkles, Upload, X } from 'lucide-react';
import { aiCall, aiVision, isAiEnabled } from '../lib/ai-service';
import { supabase } from '../lib/supabase';
import { buildRevisedCreativeBrief } from '../lib/senior-designer-prompts';
import type { SeniorDesignerResult } from '../pages/strategy/types';
import AanyaCreativePromptCard from './AanyaCreativePromptCard';
import { Card } from './ui/Card';
import { CopyButton } from './ui/CopyButton';
import { Spinner } from './ui/Spinner';

export interface InlineReviewProject {
  name: string;
  locality?: string;
  city?: string;
  unit_types?: string;
  price_range_lacs?: string;
  units_remaining?: number | string;
  usps?: string;
  amenities?: string;
  rera_number?: string;
}

export interface InlineReviewContext {
  platform: string;        // creative platform e.g. "Nanobanana (Gemini)"
  objective?: string;
  headline?: string;
  idea?: string;
}

interface ReviewIssue {
  area: string;
  severity: string;
  issue: string;
  fix: string;
}

interface ReviewResult {
  overallScore?: number;
  verdict?: string;
  issues?: ReviewIssue[];
  followUpPrompt?: string;
  followUpPromptStory?: string;
}

async function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ data: result.split(',')[1], mimeType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function scoreColor(score: number) {
  if (score >= 8) return 'text-success-text';
  if (score >= 5) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBg(score: number) {
  if (score >= 8) return 'bg-success-subtle border-success-border';
  if (score >= 5) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

interface IterationRecord {
  iteration: number;
  score: number;
  verdict: string;
  issues: ReviewIssue[];
  followUpPrompt?: string;
  followUpPromptStory?: string;
}

interface Props {
  project: InlineReviewProject | null;
  context: InlineReviewContext;
  label?: string;
  creativeId?: string;
}

export function InlineCreativeReview({ project, context, label = 'Review Your Creative', creativeId }: Props) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState<IterationRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [revisionResult, setRevisionResult] = useState<SeniorDesignerResult | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  function handleFile(file: File) {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImage(file);
    setImageUrl(URL.createObjectURL(file));
    setError(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }

  function removeImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImage(null);
    setImageUrl(null);
    if (fileRef.current) fileRef.current.value = '';
    setError(null);
  }

  async function analyze() {
    if (!image || !isAiEnabled()) {
      setError(!image ? 'Upload an image first.' : 'Add Claude API key in Settings to enable AI.');
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const projDetails = project
        ? [
            `Name: ${project.name}`,
            `Location: ${project.locality || 'Not specified'}, ${project.city || 'Bhubaneswar'}`,
            `Unit Types: ${project.unit_types || 'Not specified'}`,
            `Price: ₹${project.price_range_lacs || 'Not specified'}L`,
            `Units Remaining: ${project.units_remaining ?? 'Not specified'}`,
            `USPs: ${project.usps || 'None listed'}`,
            `Amenities: ${project.amenities || 'None listed'}`,
            `RERA: ${project.rera_number || 'NOT AVAILABLE - do not mention'}`,
          ].join('\n')
        : 'Project details not available';

      const iterationNum = iterations.length + 1;
      const strategyCtx = [
        context.objective ? `Objective: ${context.objective}` : '',
        context.idea ? `Angle: ${context.idea}` : '',
        context.headline ? `Headline: ${context.headline}` : '',
      ].filter(Boolean).join(', ');

      const promptText = `You are a senior real estate ad creative director. Review this generated ad creative image.

This is Iteration ${iterationNum} of the creative review loop.
STRATEGY CONTEXT: ${strategyCtx || 'General real estate ad'}
CREATED WITH: ${context.platform}

PROJECT DETAILS (use ONLY these for revised prompts, do not invent):
${projDetails}

STRICT RULE: If RERA says 'NOT AVAILABLE', do NOT mention RERA in any revised prompt. Only use what is actually provided. Do NOT invent unit types, amenities, or features not listed.

Check if the generated image matches the strategy context. Score it and provide specific fixes.

Return ONLY valid JSON:
{"overallScore":7,"verdict":"one line summary","issues":[{"area":"Layout or Color or Typography or Content or CTA or Branding","severity":"Critical or Major or Minor","issue":"specific problem visible in image","fix":"exact fix with design values"}],"followUpPrompt":"COMPLETE revised ${context.platform} prompt that fixes ALL issues. MANDATORY PROJECT DETAILS: ${projDetails.replace(/\n/g, ' | ')}. Include: visual style, brand colors #1B4332 #2DD4A8, text overlay with actual headline, logo Neelachala Homes top-left 80x80px, 1080x1080 dimensions. Do NOT add RERA if not in project details.","followUpPromptStory":"Same for 1080x1920 story format with same project details."}`;

      const { data: b64, mimeType } = await fileToBase64(image);
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
            { type: 'text', text: promptText },
          ],
        },
      ];

      const res = await aiVision(messages, 'You are a senior real estate creative director. Respond ONLY in valid JSON.');

      if (res.error) {
        setError(String(res.error));
      } else {
        const data = res as ReviewResult;
        if (data.overallScore != null) {
          setIterations((prev) => [
            ...prev,
            {
              iteration: iterationNum,
              score: data.overallScore!,
              verdict: data.verdict || '',
              issues: data.issues || [],
              followUpPrompt: data.followUpPrompt,
              followUpPromptStory: data.followUpPromptStory,
            },
          ]);
        } else {
          setError('Could not parse review result. Try again.');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }

    setAnalyzing(false);
  }

  const latest = iterations[iterations.length - 1] ?? null;

  async function handleRegenerateWithAanya() {
    if (!creativeId || !latest || regenerating) return;
    setRegenerating(true);
    setRevisionError(null);

    try {
      console.log('🎨 [AANYA-REVISION] Looking up original brief for creative', creativeId);
      const { data: row, error: lookupError } = await supabase
        .from('creatives')
        .select('senior_designer_brief, languages, project_id, revised_briefs')
        .eq('id', creativeId)
        .maybeSingle();

      if (lookupError) throw new Error(lookupError.message);
      if (!row?.senior_designer_brief) {
        setRevisionError('Regenerate with Aanya not available — original brief not stored. Use the legacy follow-up prompt instead.');
        setRegenerating(false);
        return;
      }

      const issues = latest.issues ?? [];
      const identified_issues = issues.map((i) => `[${i.area} / ${i.severity}] ${i.issue}`);
      const fixes_to_apply = issues.map((i) => i.fix).filter(Boolean);

      console.log('🎨 [AANYA-REVISION] Building revised brief —', identified_issues.length, 'issues,', fixes_to_apply.length, 'fixes');

      const { systemPrompt, userPrompt } = await buildRevisedCreativeBrief({
        original_creative_brief: JSON.stringify(row.senior_designer_brief),
        identified_issues,
        fixes_to_apply,
        project_id: row.project_id ?? undefined,
        languages: (row.languages as string[]) ?? ['English'],
      });

      console.log('🎨 [AANYA-REVISION] System prompt length:', systemPrompt.length);
      const aanyaRes = await aiCall(userPrompt, systemPrompt, 16000);
      console.log('🎨 [AANYA-REVISION] Response keys:', Object.keys(aanyaRes));

      if (aanyaRes.error) throw new Error(String(aanyaRes.error));

      let parsed: SeniorDesignerResult;
      if (aanyaRes.raw) {
        const s = String(aanyaRes.raw);
        try { parsed = JSON.parse(s); }
        catch {
          try { parsed = JSON.parse(s.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); }
          catch {
            const st = s.indexOf('{'); const en = s.lastIndexOf('}');
            if (st !== -1 && en !== -1) { parsed = JSON.parse(s.substring(st, en + 1)); }
            else { throw new Error('Could not parse [AANYA-REVISION] response'); }
          }
        }
      } else {
        parsed = aanyaRes as SeniorDesignerResult;
      }

      console.log('✅ [AANYA-REVISION] parsed successfully');
      setRevisionResult(parsed);

      const existing = (row.revised_briefs as unknown[]) ?? [];
      const revisionEntry = {
        iteration: existing.length + 1,
        brief: parsed,
        issues_addressed: identified_issues,
        fixes_applied: fixes_to_apply,
        created_at: new Date().toISOString(),
      };
      const next = [...existing, revisionEntry];
      const { error: saveError } = await supabase
        .from('creatives')
        .update({ revised_briefs: next })
        .eq('id', creativeId);
      if (saveError) {
        console.warn('⚠️ [AANYA-REVISION] Save to revised_briefs failed (non-fatal):', saveError.message);
      } else {
        console.log(`✅ [AANYA-REVISION] Saved revision #${revisionEntry.iteration} to revised_briefs`);
      }
    } catch (err: unknown) {
      console.error('❌ [AANYA-REVISION] failed:', err);
      setRevisionError(err instanceof Error ? err.message : 'Unknown error');
    }

    setRegenerating(false);
  }

  return (
    <div className="mt-4 rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-sunken hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-brand" />
          <span className="text-sm font-medium text-text-primary">{label}</span>
          {iterations.length > 0 && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${scoreBg(latest!.score)} ${scoreColor(latest!.score)}`}>
              {latest!.score}/10
            </span>
          )}
          {iterations.length > 1 && (
            <span className="text-[10px] text-text-tertiary">{iterations.length} iterations</span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-text-tertiary" /> : <ChevronDown size={14} className="text-text-tertiary" />}
      </button>

      {open && (
        <div className="px-4 py-4 flex flex-col gap-4 border-t border-border">
          <p className="text-xs text-text-tertiary">
            Upload the image you generated from the prompt above to check if it matches the strategy.
          </p>

          {/* Upload area */}
          {!image ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 py-6 rounded-lg border-2 border-dashed border-border hover:border-brand-border hover:bg-brand-subtle transition-all cursor-pointer"
            >
              <Upload size={18} className="text-text-tertiary" />
              <span className="text-xs text-text-tertiary">Click or drag to upload generated image</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-surface-sunken border border-border rounded-lg p-3">
              <img src={imageUrl!} alt="Creative" className="w-14 h-14 object-cover rounded-lg flex-shrink-0" />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-xs text-text-primary truncate">{image.name}</span>
                <span className="text-[11px] text-text-tertiary">{(image.size / 1024).toFixed(0)} KB</span>
                <button onClick={removeImage} className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 w-fit">
                  <X size={11} /> Remove
                </button>
              </div>
            </div>
          )}

          <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

          <div className="flex items-center gap-3">
            <button
              onClick={analyze}
              disabled={!image || analyzing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-subtle border border-brand-border text-sm text-brand-text hover:bg-brand-subtle-hover disabled:opacity-40 transition-all"
            >
              {analyzing ? <Spinner size="sm" /> : <Eye size={13} />}
              {analyzing ? 'Analyzing…' : iterations.length > 0 ? `Analyze Again (Iteration ${iterations.length + 1})` : 'Analyze Creative'}
            </button>
            {iterations.length > 0 && (
              <span className="text-xs text-text-tertiary">
                Score progression: {iterations.map((r) => r.score).join(' → ')}
              </span>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Latest result */}
          {latest && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className={`text-3xl font-bold leading-none ${scoreColor(latest.score)}`}>{latest.score}</span>
                <div>
                  <span className="text-sm text-text-tertiary">/10 — Iteration {latest.iteration}</span>
                  {latest.verdict && <p className={`text-xs font-medium mt-0.5 ${scoreColor(latest.score)}`}>{latest.verdict}</p>}
                </div>
                {latest.score >= 8 && (
                  <div className="flex items-center gap-1 ml-auto text-success-text">
                    <Check size={14} />
                    <span className="text-xs font-semibold">Ready to use</span>
                  </div>
                )}
              </div>

              {latest.issues && latest.issues.length > 0 && (
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Issues Found ({latest.issues.length})</p>
                  </div>
                  <div className="px-4 py-1">
                    {latest.issues.map((issue, i) => (
                      <div key={i} className="py-3 border-b border-border last:border-0 flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                            issue.severity === 'Critical' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                            issue.severity === 'Major' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            'bg-surface-sunken text-text-tertiary border-border'
                          }`}>{issue.severity}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-brand-subtle text-brand-text border border-brand-border">{issue.area}</span>
                        </div>
                        <p className="text-xs text-text-primary">{issue.issue}</p>
                        <p className="text-xs text-brand">Fix: {issue.fix}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {!creativeId && latest.followUpPrompt && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Revised Prompt (1080×1080)</p>
                  <div className="rounded-lg border p-3 flex items-start gap-3" style={{ background: '#7c3aed10', borderColor: '#7c3aed30' }}>
                    <p className="text-xs text-text-primary leading-relaxed flex-1 font-mono">{latest.followUpPrompt}</p>
                    <CopyButton text={latest.followUpPrompt} />
                  </div>
                </div>
              )}

              {!creativeId && latest.followUpPromptStory && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Revised Story Prompt (1080×1920)</p>
                  <div className="rounded-lg border p-3 flex items-start gap-3" style={{ background: '#7c3aed10', borderColor: '#7c3aed30' }}>
                    <p className="text-xs text-text-primary leading-relaxed flex-1 font-mono">{latest.followUpPromptStory}</p>
                    <CopyButton text={latest.followUpPromptStory} />
                  </div>
                </div>
              )}

              {creativeId && latest.issues && latest.issues.length > 0 && (
                <div className="mt-2 pt-3 border-t border-border flex flex-col gap-3">
                  <button
                    onClick={handleRegenerateWithAanya}
                    disabled={regenerating}
                    className="flex items-center gap-2 self-start px-4 py-2 rounded-lg bg-brand/10 border border-brand/20 text-sm text-brand hover:bg-brand/15 disabled:opacity-50 transition-all"
                  >
                    {regenerating ? <Spinner size="sm" /> : <Sparkles size={13} />}
                    {regenerating ? 'Regenerating with Aanya…' : 'Regenerate with Aanya'}
                  </button>
                  {revisionError && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertCircle size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-300">{revisionError}</p>
                    </div>
                  )}
                  {revisionResult && (
                    <AanyaCreativePromptCard brief={revisionResult} sectionLabel="Aanya Revised Brief — Nanobanana (Gemini)" />
                  )}
                </div>
              )}

              {!creativeId && latest.score < 8 && (
                <p className="text-xs text-text-tertiary px-1">
                  Copy the revised prompt above, regenerate in {context.platform}, then upload the new image here.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

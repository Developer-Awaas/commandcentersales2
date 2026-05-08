import { useEffect, useRef, useState } from 'react';
import { CheckSquare, ChevronLeft, ChevronRight, Download, Square, Upload, Wand2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { aiCall, aiVision, isAiEnabled } from '../lib/ai-service';
import { buildVariantBriefs } from '../lib/senior-designer-prompts';
import type { SeniorDesignerResult } from './strategy/types';
import { AanyaDesignerNotes } from './strategy/StrategyResult';
import { logAiSession } from '../lib/session-logger';
import { buildContext } from '../lib/context-builder';
import { generateLeadGenPDF } from '../lib/pdf-generator';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { CopyButton } from '../components/ui/CopyButton';
import { useToast } from '../contexts/ToastContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  locality?: string | null;
  city?: string | null;
  price_range_lacs?: string | null;
  usps?: string | null;
  units_remaining?: number | null;
}

interface WizardData {
  sessionId: string | null;
  projectId: string;
  projectName: string;
  strategyResult: Record<string, unknown> | null;
  creativesResult: Record<string, unknown> | null;
  reviewResult: Record<string, unknown> | null;
  configResult: Record<string, unknown> | null;
  checklist: string[];
}

type StepNum = 1 | 2 | 3 | 4 | 5 | 6;

const STEPS: { id: StepNum; label: string }[] = [
  { id: 1, label: 'Strategy' },
  { id: 2, label: 'Creatives' },
  { id: 3, label: 'Ad Review' },
  { id: 4, label: 'Ad Config' },
  { id: 5, label: 'Checklist' },
  { id: 6, label: 'Final Plan' },
];

const OBJECTIVE_OPTIONS = [
  { value: 'Lead Generation', label: 'Lead Generation' },
  { value: 'Branding', label: 'Branding' },
  { value: 'Site Visit Drive', label: 'Site Visit Drive' },
  { value: 'Retargeting', label: 'Retargeting' },
];

const PLATFORM_OPTIONS = [
  { value: 'AiSensy', label: 'AiSensy' },
  { value: 'Meta Ads Manager', label: 'Meta Ads Manager' },
];

const CREATIVE_PLATFORM_OPTIONS = [
  { value: 'Nanobanana (Gemini)', label: 'Nanobanana (Gemini)' },
  { value: 'ChatGPT / DALL-E', label: 'ChatGPT / DALL-E' },
  { value: 'Midjourney', label: 'Midjourney' },
  { value: 'Canva', label: 'Canva' },
];

const FUNNEL_OPTIONS = [
  { value: 'BOFU', label: 'BOFU — Bottom of Funnel' },
  { value: 'MOFU', label: 'MOFU — Middle of Funnel' },
  { value: 'TOFU', label: 'TOFU — Top of Funnel' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAiJson(res: Record<string, unknown>): Record<string, unknown> | null {
  if (res.error) return null;
  if (res.raw) {
    const raw = String(res.raw);
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    try { return JSON.parse(m ? m[1] : raw); } catch { return { raw } as Record<string, unknown>; }
  }
  return res;
}

function ResultPreview({ data, label }: { data: Record<string, unknown>; label: string }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== '');
  return (
    <div className="rounded-lg border border-brand-border bg-brand-subtle p-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-brand uppercase tracking-wide">{label} generated</span>
        <button onClick={() => setOpen((v) => !v)} className="text-[10px] text-text-tertiary hover:text-text-primary transition-colors">{open ? 'collapse' : 'expand'}</button>
      </div>
      {open ? (
        <div className="flex flex-col gap-1.5 text-xs max-h-56 overflow-y-auto mt-2">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-text-tertiary min-w-[100px] flex-shrink-0 capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}:</span>
              <span className="text-text-primary break-words">{Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v).substring(0, 200)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-tertiary truncate">{entries.slice(0, 2).map(([k, v]) => `${k}: ${String(v).substring(0, 50)}`).join(' · ')}</p>
      )}
    </div>
  );
}

// ── Step 1: Strategy ──────────────────────────────────────────────────────────

function StepStrategy({ projects, data, onResult }: {
  projects: Project[];
  data: WizardData;
  onResult: (result: Record<string, unknown>, projectId: string, projectName: string) => void;
}) {
  const [projectId, setProjectId] = useState(data.projectId || projects[0]?.id || '');
  const [objective, setObjective] = useState('Lead Generation');
  const [platform, setPlatform] = useState('AiSensy');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const project = projects.find((p) => p.id === projectId);
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));

  async function generate() {
    if (!isAiEnabled()) { showToast('Add Claude API key in Settings.', 'info'); return; }
    if (!project) return;
    setLoading(true);
    const context = await buildContext({ projectId });
    const month = new Date().toLocaleString('en-IN', { month: 'short', year: '2-digit' });
    const prompt = [
      `Generate a ready-to-deploy real estate ad for ${project.name}, ${project.locality || ''} ${project.city || ''}. Price ₹${project.price_range_lacs || 'N/A'}L. USPs: ${project.usps || 'None'}. Units left: ${project.units_remaining ?? 'N/A'}.`,
      `OBJECTIVE: ${objective}. PLATFORM: ${platform}.`,
      notes ? `USER NOTES: ${notes}` : '',
      `Reply ONLY with JSON (no prose): { "idea": "...", "campaignName": "NH-${month.replace(' ', '').toUpperCase()}", "primaryText": "150-250 char ad copy with emojis", "primaryTextOdia": "...", "headline": "max 25 chars", "description": "30 chars", "callToAction": "Send WhatsApp Message", "locations": "...", "ageRange": "30 to 50", "interests": "...", "dailyBudget": "500", "duration": "7", "icebreakers": ["...","...","..."], "creativePrompt": "detailed image prompt 1080x1080", "creativePromptStory": "1080x1920 prompt", "launchChecklist": ["...","...","..."] }`,
    ].filter(Boolean).join('\n\n');
    const res = await aiCall(context ? prompt + '\n\nCONTEXT:\n' + context : prompt);
    const parsed = parseAiJson(res);
    if (!parsed) { showToast('Generation failed. Try again.', 'error'); setLoading(false); return; }
    logAiSession(supabase, { sessionType: 'quick_generate', projectIds: [projectId], inputSummary: `Wizard S1: ${project.name}`, inputData: { objective, platform }, outputData: parsed });
    onResult(parsed, projectId, project.name);
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Project" options={projectOptions} value={projectId} onChange={(e) => setProjectId(e.target.value)} />
        <Select label="Objective" options={OBJECTIVE_OPTIONS} value={objective} onChange={(e) => setObjective(e.target.value)} />
        <Select label="Ad Platform" options={PLATFORM_OPTIONS} value={platform} onChange={(e) => setPlatform(e.target.value)} />
      </div>
      <div>
        <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide block mb-1.5">Special notes (optional)</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Focus on scarcity — only 4 units left. Target NRI buyers."
          className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand transition-colors resize-none" />
      </div>
      <button onClick={generate} disabled={loading || !projectId}
        className="w-full py-3 rounded-lg bg-brand text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {loading ? <Spinner size="sm" /> : <Wand2 size={15} />}
        {loading ? 'Generating Strategy…' : 'Generate Ad Strategy'}
      </button>
      {data.strategyResult && <ResultPreview data={data.strategyResult} label="Strategy" />}
    </div>
  );
}

interface AiVariant {
  variant: string;
  angle: string;
  why?: string;
  format: string;
  primaryText: string;
  odiaText?: string;
  headline: string;
  description?: string;
  cta?: string;
  nanoPrompt: string;
  nanoStory?: string;
  hashtags?: string[];
  bestTime?: string;
  _aanyaBrief?: SeniorDesignerResult;
}

function VariantCard({ v }: { v: AiVariant }) {
  return (
    <div className="rounded-lg border border-border bg-surface-elevated p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] px-2 py-0.5 rounded bg-brand-subtle text-brand border border-brand-border font-bold">Variant {v.variant}</span>
        <span className="text-sm font-semibold text-text-primary">{v.angle}</span>
        <span className="text-[10px] text-text-tertiary ml-auto">{v.format}</span>
      </div>
      <div className="flex flex-col gap-2">
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-text-tertiary uppercase tracking-wide">Primary Text</span>
            <CopyButton text={v.primaryText} />
          </div>
          <p className="text-xs text-text-primary leading-relaxed">{v.primaryText}</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-text-tertiary uppercase tracking-wide">Headline</span>
            <CopyButton text={v.headline} />
          </div>
          <p className="text-xs text-text-primary font-medium">{v.headline}</p>
        </div>
        {v.nanoPrompt && (
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-text-tertiary uppercase tracking-wide">Creative Prompt</span>
              <CopyButton text={v.nanoPrompt} />
            </div>
            <p className="text-xs text-text-tertiary leading-relaxed italic bg-surface rounded p-2">{v.nanoPrompt}</p>
          </div>
        )}
      </div>
      {v._aanyaBrief && <AanyaDesignerNotes brief={v._aanyaBrief} />}
    </div>
  );
}

// ── Step 2: Creatives ─────────────────────────────────────────────────────────

function StepCreatives({ data, onResult }: { data: WizardData; onResult: (r: Record<string, unknown>) => void }) {
  const [platform, setPlatform] = useState('Nanobanana (Gemini)');
  const [funnel, setFunnel] = useState('BOFU');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  async function generate() {
    if (!isAiEnabled()) { showToast('Add Claude API key in Settings.', 'info'); return; }
    setLoading(true);

    const isNanobanana = platform.toLowerCase().includes('nanobanana');
    const s = data.strategyResult;

    if (isNanobanana) {
      // ── AANYA 3-VARIANT PATH (sequential, mirrors Flow 4) ──
      const userBrief = [
        `Generate a high-converting real estate ad creative for ${data.projectName}, ${funnel} funnel stage.`,
        s?.idea ? `Concept: ${String(s.idea)}.` : '',
        s?.headline ? `Headline direction: ${String(s.headline)}.` : '',
        s?.primaryText ? `Reference primary text: ${String(s.primaryText)}.` : '',
      ].filter(Boolean).join(' ');

      const languages = s?.primaryTextOdia ? ['English', 'Odia'] : ['English'];

      const briefs = await buildVariantBriefs({
        project_id: data.projectId,
        user_brief: userBrief,
        funnel_stage: funnel as 'TOFU' | 'MOFU' | 'BOFU',
        languages,
      });

      const angleLabels = [
        'Price-led with Urgency',
        'Lifestyle / Aspirational',
        'Trust & Legacy / Amenities',
      ] as const;

      console.log('🎨 [AANYA-WIZARD-VARIANTS] Generating 3 variants sequentially (avoids Anthropic API rate limits)...');
      const settled: PromiseSettledResult<SeniorDesignerResult>[] = [];
      for (let i = 0; i < briefs.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 500));
        const brief = briefs[i];
        const tag = `[AANYA-WIZARD-VARIANT-${String.fromCharCode(65 + i)}]`;
        try {
          console.log(`🎨 ${tag} system prompt length:`, brief.systemPrompt.length);
          console.log(`🎨 ${tag} user prompt brand check:`, {
            has_INVIOLABLE: brief.userPrompt.includes('INVIOLABLE') || brief.systemPrompt.includes('INVIOLABLE'),
          });

          const aanyaRes = await aiCall(brief.userPrompt, brief.systemPrompt, 16000);
          console.log(`🎨 ${tag} response keys:`, Object.keys(aanyaRes));
          if (aanyaRes.error) throw new Error(String(aanyaRes.error));

          let parsed: SeniorDesignerResult;
          if (aanyaRes.raw) {
            const ss = String(aanyaRes.raw);
            try { parsed = JSON.parse(ss); }
            catch {
              try { parsed = JSON.parse(ss.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); }
              catch {
                const st = ss.indexOf('{'); const en = ss.lastIndexOf('}');
                if (st !== -1 && en !== -1) { parsed = JSON.parse(ss.substring(st, en + 1)); }
                else { throw new Error(`Could not parse ${tag} response`); }
              }
            }
          } else {
            parsed = aanyaRes as SeniorDesignerResult;
          }

          console.log(`✅ ${tag} parsed successfully`);
          settled.push({ status: 'fulfilled', value: parsed });
        } catch (err) {
          settled.push({ status: 'rejected', reason: err });
        }
      }

      const aiVariants: AiVariant[] = settled.map((res, i) => {
        const label = String.fromCharCode(65 + i);
        const angle = angleLabels[i];
        if (res.status === 'rejected') {
          console.warn(`⚠️ [AANYA-WIZARD-VARIANT-${label}] failed:`, res.reason);
          return {
            variant: label, angle,
            why: `Variant ${label} generation failed — see console.`,
            format: 'Single Image',
            primaryText: '', headline: '', description: '', nanoPrompt: '',
            hashtags: [],
          };
        }
        const parsed = res.value;
        const adCopy = parsed.ad_copy ?? {};
        return {
          variant: label,
          angle,
          why: parsed.designer_rationale ?? parsed.creative_concept ?? '',
          format: 'Single Image',
          primaryText: String(adCopy.primary_text_english ?? ''),
          odiaText: adCopy.primary_text_odia ? String(adCopy.primary_text_odia) : undefined,
          headline: String(adCopy.headline_english ?? ''),
          description: String(adCopy.subhead_english ?? ''),
          cta: String(adCopy.cta ?? 'Send WhatsApp Message'),
          nanoPrompt: parsed.nanobanana_prompt_main ?? '',
          nanoStory: parsed.nanobanana_prompt_story,
          hashtags: [],
          _aanyaBrief: parsed,
        };
      });

      const successCount = settled.filter((r) => r.status === 'fulfilled').length;
      if (successCount === 0) {
        showToast('All 3 Aanya variants failed. See console.', 'error');
        setLoading(false);
        return;
      }

      const result = {
        strategy: successCount === 3
          ? 'Aanya generated all 3 variants — designed for Nanobanana (Gemini).'
          : `Aanya generated ${successCount}/3 variants. Failed variants are shown with empty fields — regenerate to retry.`,
        variants: aiVariants,
      };

      logAiSession(supabase, {
        sessionType: 'creative',
        projectIds: [data.projectId],
        inputSummary: `Wizard S2 (Aanya): ${data.projectName}`,
        inputData: { platform, funnel, source: 'aanya_3_variant', successCount },
        outputData: result as Record<string, unknown>,
      });

      onResult(result as Record<string, unknown>);
      setLoading(false);
      return;
    }

    // ── LEGACY PATH (non-Nanobanana — unchanged) ──
    const context = await buildContext({ projectId: data.projectId });
    const prompt = [
      `Generate 3 distinct creative ad variants for ${data.projectName}.`,
      s ? `STRATEGY: Primary text: "${s.primaryText}". Headline: "${s.headline}". Idea: "${s.idea}".` : '',
      `CREATIVE PLATFORM: ${platform}. FUNNEL STAGE: ${funnel}.`,
      `Reply ONLY with JSON: { "strategy": "...", "variants": [{ "variant": "A", "angle": "...", "why": "...", "format": "1080x1080", "primaryText": "...", "headline": "...", "description": "...", "nanoPrompt": "detailed image generation prompt", "hashtags": ["..."] }] }`,
    ].filter(Boolean).join('\n\n');
    const res = await aiCall(context ? prompt + '\n\nCONTEXT:\n' + context : prompt);
    const parsed = parseAiJson(res);
    if (!parsed) { showToast('Generation failed. Try again.', 'error'); setLoading(false); return; }
    logAiSession(supabase, { sessionType: 'creative', projectIds: [data.projectId], inputSummary: `Wizard S2: ${data.projectName}`, inputData: { platform, funnel }, outputData: parsed });
    onResult(parsed);
    setLoading(false);
  }

  const variants = (data.creativesResult?.variants as AiVariant[] | undefined) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-tertiary">Generating creatives for <span className="text-text-primary font-medium">{data.projectName || 'selected project'}</span></p>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Creative Platform" options={CREATIVE_PLATFORM_OPTIONS} value={platform} onChange={(e) => setPlatform(e.target.value)} />
        <Select label="Funnel Stage" options={FUNNEL_OPTIONS} value={funnel} onChange={(e) => setFunnel(e.target.value)} />
      </div>
      <button onClick={generate} disabled={loading}
        className="w-full py-3 rounded-lg bg-brand text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {loading ? <Spinner size="sm" /> : <Wand2 size={15} />}
        {loading ? 'Generating Variants…' : 'Generate 3 Creative Variants'}
      </button>
      {data.creativesResult && (
        <div className="flex flex-col gap-3">
          {data.creativesResult.strategy && (
            <p className="text-xs text-text-tertiary italic">{String(data.creativesResult.strategy)}</p>
          )}
          {variants.map((v, i) => <VariantCard key={i} v={v} />)}
        </div>
      )}
    </div>
  );
}

// ── Step 3: Ad Review (optional) ──────────────────────────────────────────────

function StepAdReview({ data, onResult, onImageChange }: {
  data: WizardData;
  onResult: (r: Record<string, unknown>) => void;
  onImageChange: (hasImage: boolean) => void;
}) {
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function setImageAndNotify(f: File | null) {
    setImage(f);
    onImageChange(f !== null);
  }

  async function analyze() {
    if (!image || !isAiEnabled()) { showToast('Upload an image first.', 'info'); return; }
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = (reader.result as string).split(',')[1];
      const prompt = `Analyze this real estate ad creative for ${data.projectName}. Reply ONLY with JSON: { "overallScore": 7, "verdict": "...", "issues": [{ "area": "...", "severity": "high", "issue": "...", "fix": "..." }], "strengths": ["..."], "revisedPrompt": "improved image generation prompt" }`;
      const res = await aiVision(prompt, b64, image.type);
      const parsed = parseAiJson(res);
      if (!parsed) { showToast('Analysis failed.', 'error'); setLoading(false); return; }
      onResult(parsed);
      setLoading(false);
    };
    reader.readAsDataURL(image);
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-tertiary">Optional — upload a generated creative for AI scoring. You can skip this step.</p>
      {image ? (
        <div className="flex items-center gap-4">
          <img src={URL.createObjectURL(image)} alt="" className="w-20 h-20 object-cover rounded-lg border border-border" />
          <div className="flex flex-col gap-2">
            <span className="text-sm text-text-primary">{image.name}</span>
            <button onClick={() => setImageAndNotify(null)} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"><X size={12} />Remove</button>
          </div>
        </div>
      ) : (
        <button onClick={() => fileRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-lg border border-dashed border-border hover:border-brand-border hover:bg-brand-subtle transition-all">
          <Upload size={20} className="text-text-tertiary" />
          <span className="text-sm text-text-tertiary">Click to upload creative image</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" onChange={(e) => setImageAndNotify(e.target.files?.[0] ?? null)} className="hidden" />
      {image && (
        <button onClick={analyze} disabled={loading}
          className="w-full py-3 rounded-lg bg-brand text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? <Spinner size="sm" /> : <Wand2 size={15} />}
          {loading ? 'Analyzing…' : 'Analyze Creative'}
        </button>
      )}
      {data.reviewResult && <ResultPreview data={data.reviewResult} label="Review" />}
    </div>
  );
}

// ── Step 4: Ad Config ─────────────────────────────────────────────────────────

function StepAdConfig({ data, onResult }: { data: WizardData; onResult: (r: Record<string, unknown>) => void }) {
  const [platform, setPlatform] = useState('AiSensy');
  const [funnel, setFunnel] = useState('BOFU');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  async function generate() {
    if (!isAiEnabled()) { showToast('Add Claude API key in Settings.', 'info'); return; }
    setLoading(true);
    const context = await buildContext({ projectId: data.projectId });
    const s = data.strategyResult;
    const prompt = [
      `Generate exact ${platform} campaign configuration for ${data.projectName}. Funnel stage: ${funnel}.`,
      s ? `STRATEGY CONTEXT: Objective: ${s.objective || 'Lead Gen'}, Locations: ${s.locations || 'N/A'}, Age: ${s.ageRange || '28-55'}, Interests: ${s.interests || 'N/A'}` : '',
      `Reply ONLY with JSON: { "campaignName": "...", "adType": "CTWA", "objective": "...", "locations": [...], "ageMin": 28, "ageMax": 55, "interests": [...], "occupations": [...], "behaviors": [...], "dailyBudget": 500, "days": 7, "bidStrategy": "Lowest cost", "icebreakers": [{"text":"...","purpose":"..."}], "checklist": ["...","...","...","..."] }`,
    ].filter(Boolean).join('\n\n');
    const res = await aiCall(context ? prompt + '\n\nCONTEXT:\n' + context : prompt);
    const parsed = parseAiJson(res);
    if (!parsed) { showToast('Generation failed.', 'error'); setLoading(false); return; }
    logAiSession(supabase, { sessionType: 'ad_config', projectIds: [data.projectId], inputSummary: `Wizard S4: ${data.projectName}`, inputData: { platform, funnel }, outputData: parsed });
    onResult(parsed);
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-tertiary">Configuring ads for <span className="text-text-primary font-medium">{data.projectName || 'selected project'}</span></p>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Ad Platform" options={PLATFORM_OPTIONS} value={platform} onChange={(e) => setPlatform(e.target.value)} />
        <Select label="Funnel Stage" options={FUNNEL_OPTIONS} value={funnel} onChange={(e) => setFunnel(e.target.value)} />
      </div>
      <button onClick={generate} disabled={loading}
        className="w-full py-3 rounded-lg bg-brand text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {loading ? <Spinner size="sm" /> : <Wand2 size={15} />}
        {loading ? 'Generating Config…' : 'Generate Ad Config'}
      </button>
      {data.configResult && <ResultPreview data={data.configResult} label="Ad Config" />}
    </div>
  );
}

// ── Step 5: Checklist ─────────────────────────────────────────────────────────

function StepChecklist({ data, onUpdate }: { data: WizardData; onUpdate: (items: string[]) => void }) {
  const allItems = [
    ...((data.strategyResult?.launchChecklist as string[]) ?? []),
    ...((data.configResult?.checklist as string[]) ?? []),
  ].filter(Boolean);
  const unique = [...new Set(allItems)];

  const [checked, setChecked] = useState<Set<number>>(new Set());

  useEffect(() => { onUpdate(unique); }, []);

  function toggle(i: number) {
    setChecked((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-tertiary">Launch checklist compiled from your strategy and ad config.</p>
      {unique.length === 0 ? (
        <p className="text-sm text-text-tertiary py-6 text-center">Complete steps 1 and 4 to generate checklist items.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {unique.map((item, i) => (
              <button key={i} onClick={() => toggle(i)}
                className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${checked.has(i) ? 'border-brand-border bg-brand-subtle' : 'border-border hover:border-brand-border'}`}>
                {checked.has(i) ? <CheckSquare size={15} className="text-brand flex-shrink-0 mt-0.5" /> : <Square size={15} className="text-text-tertiary flex-shrink-0 mt-0.5" />}
                <span className={`text-sm ${checked.has(i) ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{item}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-text-tertiary text-right">{checked.size}/{unique.length} checked</p>
        </>
      )}
    </div>
  );
}

// ── Step 6: Final Plan ────────────────────────────────────────────────────────

function StepFinalPlan({ data, onComplete }: { data: WizardData; onComplete: () => void }) {
  const sections = [
    { label: 'Strategy', done: !!data.strategyResult },
    { label: 'Creatives', done: !!data.creativesResult },
    { label: 'Ad Review', done: !!data.reviewResult },
    { label: 'Ad Config', done: !!data.configResult },
  ];

  function download() {
    generateLeadGenPDF({
      strategy: data.strategyResult ?? undefined,
      creatives: data.creativesResult ?? undefined,
      adReview: data.reviewResult ?? undefined,
      adConfig: data.configResult ?? undefined,
      projectName: data.projectName || 'Project',
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <p className="text-sm font-semibold text-text-primary mb-2">Campaign Plan Ready — {data.projectName}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {sections.map((s) => (
            <span key={s.label} className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold ${s.done ? 'bg-brand-subtle text-brand border-brand-border' : 'bg-surface-sunken text-text-tertiary border-border'}`}>
              {s.label} {s.done ? '✓' : '—'}
            </span>
          ))}
        </div>
      </Card>

      {data.strategyResult && <ResultPreview data={data.strategyResult} label="Strategy" />}
      {data.creativesResult && <ResultPreview data={data.creativesResult} label="Creatives" />}
      {data.reviewResult && <ResultPreview data={data.reviewResult} label="Ad Review" />}
      {data.configResult && <ResultPreview data={data.configResult} label="Ad Config" />}

      <button onClick={download}
        className="w-full py-4 rounded-xl bg-brand text-white font-bold text-base flex items-center justify-center gap-3 hover:bg-brand-hover transition-colors shadow-lg">
        <Download size={20} />
        Download Campaign Plan PDF
      </button>

      <button onClick={onComplete}
        className="w-full py-2.5 rounded-lg border border-brand-border text-sm text-brand hover:bg-brand-subtle transition-colors">
        Mark Complete & Start New Wizard
      </button>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export function CampaignWizard({ onWizardEnd, onWizardStart, wizardActive }: { onWizardEnd?: () => void; onWizardStart?: () => void; wizardActive?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [step, setStep] = useState<StepNum>(1);
  const [data, setData] = useState<WizardData>({
    sessionId: null, projectId: '', projectName: '',
    strategyResult: null, creativesResult: null, reviewResult: null, configResult: null, checklist: [],
  });
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [resumeBanner, setResumeBanner] = useState<{ id: string; step: number; stepData: Record<string, unknown> } | null>(null);
  const { showToast } = useToast();

  // Listen for sidebar "Exit Wizard" button
  useEffect(() => {
    function onExitRequest() { setCancelConfirm(true); }
    document.addEventListener('wizard-exit-requested', onExitRequest);
    return () => document.removeEventListener('wizard-exit-requested', onExitRequest);
  }, []);

  useEffect(() => {
    async function init() {
      const [{ data: projects }, { data: inProgress }] = await Promise.all([
        supabase.from('projects').select('id,name,locality,city,price_range_lacs,usps,units_remaining')
          .eq('is_active', true).eq('org_id', getOrgId()).order('priority', { ascending: true }),
        supabase.from('wizard_sessions').select('*').eq('org_id', getOrgId()).eq('status', 'in_progress')
          .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setProjects((projects ?? []) as Project[]);
      if (inProgress) setResumeBanner({ id: inProgress.id, step: inProgress.current_step, stepData: inProgress.step_data as Record<string, unknown> });
      setProjectsLoading(false);
    }
    init();
  }, []);

  function resume() {
    if (!resumeBanner) return;
    const d = resumeBanner.stepData;
    setData((prev) => ({
      ...prev,
      sessionId: resumeBanner.id,
      projectId: (d.projectId as string) || '',
      projectName: (d.projectName as string) || '',
      strategyResult: (d.strategyResult as Record<string, unknown>) ?? null,
      creativesResult: (d.creativesResult as Record<string, unknown>) ?? null,
      reviewResult: (d.reviewResult as Record<string, unknown>) ?? null,
      configResult: (d.configResult as Record<string, unknown>) ?? null,
      checklist: (d.checklist as string[]) ?? [],
    }));
    setStep(Math.min(resumeBanner.step, 6) as StepNum);
    setResumeBanner(null);
    onWizardStart?.();
  }

  async function persist(updatedData: WizardData, currentStep: StepNum, status: 'in_progress' | 'completed' | 'abandoned' = 'in_progress') {
    const payload = {
      current_step: currentStep,
      status,
      project_id: updatedData.projectId || null,
      project_name: updatedData.projectName || null,
      step_data: {
        projectId: updatedData.projectId,
        projectName: updatedData.projectName,
        strategyResult: updatedData.strategyResult,
        creativesResult: updatedData.creativesResult,
        reviewResult: updatedData.reviewResult,
        configResult: updatedData.configResult,
        checklist: updatedData.checklist,
      },
      updated_at: new Date().toISOString(),
    };

    if (updatedData.sessionId) {
      await supabase.from('wizard_sessions').update(payload).eq('id', updatedData.sessionId);
    } else {
      const { data: row } = await supabase.from('wizard_sessions')
        .insert({ ...payload, org_id: getOrgId() }).select('id').maybeSingle();
      if (row?.id) {
        setData((prev) => ({ ...prev, sessionId: row.id }));
        if (status === 'in_progress') onWizardStart?.();
      }
    }
  }

  const [step3SkipConfirm, setStep3SkipConfirm] = useState(false);
  const step3HasImageRef = useRef(false);

  async function goNext() {
    if (step >= 6) return;
    const next = (step + 1) as StepNum;
    await persist(data, next);
    setStep(next);
  }

  async function handleStep3Continue() {
    if (!step3HasImageRef.current && !data.reviewResult) {
      setStep3SkipConfirm(true);
    } else {
      await goNext();
    }
  }

  const EMPTY_DATA: WizardData = { sessionId: null, projectId: '', projectName: '', strategyResult: null, creativesResult: null, reviewResult: null, configResult: null, checklist: [] };

  async function handleCancel() {
    await persist(data, step, 'abandoned');
    showToast('Wizard cancelled.', 'info');
    setCancelConfirm(false);
    setData(EMPTY_DATA);
    setStep(1);
    onWizardEnd?.();
  }

  async function handleComplete() {
    await persist(data, 6, 'completed');
    showToast('Wizard completed!', 'success');
    setData(EMPTY_DATA);
    setStep(1);
    onWizardEnd?.();
  }

  const canProceed: Record<StepNum, boolean> = {
    1: data.strategyResult !== null,
    2: data.creativesResult !== null,
    3: true,
    4: data.configResult !== null,
    5: true,
    6: true,
  };

  if (projectsLoading) {
    return <div className="min-h-screen bg-surface flex items-center justify-center"><Spinner size="lg" /></div>;
  }

  return (
    <div className="p-8 min-h-screen bg-surface">
      {/* Resume banner */}
      {resumeBanner && (
        <div className="mb-6 p-4 rounded-xl border border-brand-border bg-brand-subtle flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">Resume previous wizard?</p>
            <p className="text-xs text-text-tertiary mt-0.5">In-progress session found at step {resumeBanner.step}.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={resume}>Yes, Resume</Button>
            <Button variant="ghost" size="sm" onClick={() => setResumeBanner(null)}>Start Fresh</Button>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-3">
          <Wand2 size={20} className="text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Campaign Wizard</h1>
            <p className="text-xs text-text-tertiary mt-0.5">Step-by-step guided campaign builder</p>
          </div>
        </div>
        <button onClick={() => setCancelConfirm(true)} className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-red-400 transition-colors">
          <X size={15} />Cancel
        </button>
      </div>

      {/* Cancel confirm */}
      {cancelConfirm && (
        <div className="mb-6 p-4 rounded-xl border border-red-800/40 bg-red-950/20 flex items-center justify-between">
          <p className="text-sm text-red-300">Cancel wizard? Your progress will be saved as abandoned.</p>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" onClick={handleCancel}>Yes, Cancel</Button>
            <Button variant="ghost" size="sm" onClick={() => setCancelConfirm(false)}>Keep Going</Button>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-start">
          {STEPS.map((s, i) => {
            const isActive = step === s.id;
            const isDone = step > s.id;
            return (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center gap-1.5 flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${isActive ? 'bg-brand text-white shadow-[0_0_0_4px_rgba(37,99,235,0.15)]' : isDone ? 'bg-brand-subtle text-brand-text border border-brand-border' : 'bg-surface-sunken text-text-tertiary'}`}>
                    {isDone ? '✓' : s.id}
                  </div>
                  <span className={`text-[10px] font-medium ${isActive ? 'text-brand' : isDone ? 'text-text-tertiary' : 'text-text-disabled'}`}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-px flex-1 mx-1 mb-5 ${step > s.id ? 'bg-brand-border' : 'bg-border'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step card */}
      <Card className="p-6 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-5">Step {step} — {STEPS[step - 1].label}</p>

        {step === 1 && <StepStrategy projects={projects} data={data} onResult={(r, pid, pname) => setData((prev) => ({ ...prev, strategyResult: r, projectId: pid, projectName: pname }))} />}
        {step === 2 && <StepCreatives data={data} onResult={(r) => setData((prev) => ({ ...prev, creativesResult: r }))} />}
        {step === 3 && <StepAdReview data={data} onResult={(r) => setData((prev) => ({ ...prev, reviewResult: r }))} onImageChange={(has) => { step3HasImageRef.current = has; }} />}
        {step === 4 && <StepAdConfig data={data} onResult={(r) => setData((prev) => ({ ...prev, configResult: r }))} />}
        {step === 5 && <StepChecklist data={data} onUpdate={(items) => setData((prev) => ({ ...prev, checklist: items }))} />}
        {step === 6 && <StepFinalPlan data={data} onComplete={handleComplete} />}
      </Card>

      {/* Step 3 skip confirmation */}
      {step3SkipConfirm && (
        <div className="mb-4 p-4 rounded-xl border border-amber-700/40 bg-amber-950/20 flex flex-col gap-3">
          <p className="text-sm text-amber-300">You haven't uploaded or analyzed a creative. Are you sure you want to skip this step?</p>
          <div className="flex gap-2">
            <button onClick={async () => { setStep3SkipConfirm(false); await goNext(); }}
              className="px-4 py-1.5 rounded-lg bg-amber-600 text-text-primary text-sm font-medium hover:bg-amber-500 transition-colors">
              Yes, Skip
            </button>
            <button onClick={() => setStep3SkipConfirm(false)}
              className="px-4 py-1.5 rounded-lg border border-border text-sm text-text-tertiary hover:text-text-primary transition-colors">
              Stay Here
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => (s > 1 ? (s - 1) as StepNum : s))} disabled={step === 1}>
          <ChevronLeft size={15} />Back
        </Button>

        <div className="flex items-center gap-2">
          {step === 3 && (
            <Button variant="ghost" onClick={goNext}>Skip</Button>
          )}
          {step < 6 && (
            <button onClick={step === 3 ? handleStep3Continue : goNext} disabled={!canProceed[step]}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand text-white font-semibold text-sm hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              Save & Continue <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

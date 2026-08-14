import { AD_PLATFORM_OPTIONS as PLATFORM_OPTIONS, DEFAULT_AD_PLATFORM, type AdPlatform } from '../lib/ad-platform';
import { useEffect, useRef, useState } from 'react';
import { CheckSquare, ChevronLeft, ChevronRight, Download, Square, Upload, Wand2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { generateAdConfig } from '../lib/ad-config-generator';
import { analyzeAdCreative, type AdReviewProjectInput } from '../lib/ad-review-analyzer';
import { saveToolOutput } from '../lib/history-service';
import { generateLeadGenPDF } from '../lib/pdf-generator';
import type { SeniorDesignerResult } from './strategy/types';
import { StrategyGenerator, type StrategyGeneratorResult } from '../components/generation/StrategyGenerator';
import { CreativeGenerator, type CreativeGeneratorResult } from '../components/generation/CreativeGenerator';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../contexts/ToastContext';
import { useGenerationLock } from '../hooks/useGenerationLock';

// ── Types ─────────────────────────────────────────────────────────────────────

// Full project shape needed across steps — a superset of what each
// individual generator function needs (AdConfigProjectInput/
// AdReviewProjectInput are both structurally satisfied by this).
interface Project {
  id: string;
  name: string;
  locality?: string | null;
  city?: string | null;
  status?: string;
  completion_pct?: number;
  expected_possession?: string;
  nearest_landmarks?: string;
  unit_types?: string;
  price_range_lacs?: string | null;
  usps?: string | null;
  units_remaining?: number | null;
  amenities?: string;
  rera_number?: string;
  notes?: string;
}

interface WizardData {
  sessionId: string | null;
  campaignId: string | null;
  projectId: string;
  projectName: string;
  funnelStage: 'TOFU' | 'MOFU' | 'BOFU' | null;
  strategyOutputId: string | null;
  savedCreativeId: string | null;
  strategyResult: Record<string, unknown> | null;
  creativesResult: Record<string, unknown> | null;
  reviewResult: Record<string, unknown> | null;
  configResult: Record<string, unknown> | null;
  checklist: string[];
}

const EMPTY_DATA: WizardData = {
  sessionId: null, campaignId: null, projectId: '', projectName: '', funnelStage: null,
  strategyOutputId: null, savedCreativeId: null,
  strategyResult: null, creativesResult: null, reviewResult: null, configResult: null, checklist: [],
};

type StepNum = 1 | 2 | 3 | 4 | 5 | 6;

const STEPS: { id: StepNum; label: string }[] = [
  { id: 1, label: 'Strategy' },
  { id: 2, label: 'Creatives' },
  { id: 3, label: 'Ad Review' },
  { id: 4, label: 'Ad Config' },
  { id: 5, label: 'Checklist' },
  { id: 6, label: 'Final Plan' },
];

// Kept for TODO(multi-platform) re-exposure — the picker UI using this was
// removed (see DEFAULT_CREATIVE_PLATFORM in lib/constants.ts). Exported so
// the unused-in-this-file array doesn't trip noUnusedLocals.
export const CREATIVE_PLATFORM_OPTIONS = [
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
// Composes the shared StrategyGenerator (form + generate + save) — the
// wizard's only job here is threading the result into WizardData and
// creating the real `campaigns` row a real campaign_id needs to exist
// (StrategyGenerator itself is domain-agnostic and doesn't know about
// campaigns; that's wizard-specific chrome, kept here).

function StepStrategy({ data, onResult }: { data: WizardData; onResult: (r: StrategyGeneratorResult) => void }) {
  return (
    <StrategyGenerator
      campaignId={data.campaignId}
      initialProjectId={data.projectId || undefined}
      onSaved={onResult}
    />
  );
}

// ── Step 2: Creatives ─────────────────────────────────────────────────────────

function StepCreatives({ data, onResult }: { data: WizardData; onResult: (r: CreativeGeneratorResult) => void }) {
  const seniorData = data.strategyResult as unknown as SeniorDesignerResult | null;
  if (!seniorData) {
    return <p className="text-sm text-text-tertiary py-6 text-center">Complete the Strategy step first.</p>;
  }
  return (
    <CreativeGenerator
      data={seniorData}
      campaignId={data.campaignId}
      strategyOutputId={data.strategyOutputId}
      projectId={data.projectId || undefined}
      funnelStage={data.funnelStage ?? undefined}
      savedCreativeId={data.savedCreativeId ?? undefined}
      onSaved={onResult}
    />
  );
}

// ── Step 3: Ad Review (optional) ──────────────────────────────────────────────
// Calls the exact same analyzeAdCreative() AdReview.tsx uses (RERA/
// configuration guardrails included) instead of the old generic prompt this
// step used to hand-roll — a correctness upgrade, not just de-dup.

function StepAdReview({ data, project, onResult, onImageChange }: {
  data: WizardData;
  project: Project | undefined;
  onResult: (r: Record<string, unknown>) => void;
  onImageChange: (hasImage: boolean) => void;
}) {
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const { start: startGeneration, stop: stopGeneration } = useGenerationLock();

  function setImageAndNotify(f: File | null) {
    setImage(f);
    onImageChange(f !== null);
  }

  async function analyze() {
    if (!image) { showToast('Upload an image first.', 'info'); return; }
    setLoading(true);
    startGeneration('Analyzing creative…');
    try {
      const analysis = await analyzeAdCreative({ image, project: project as AdReviewProjectInput | undefined, createdWith: 'Nanobanana (Gemini)' });
      if (analysis.status === 'error') { showToast(analysis.message, 'error'); return; }
      if (analysis.status === 'raw') { showToast('Analysis returned unstructured data — try again.', 'error'); return; }

      onResult(analysis.data as unknown as Record<string, unknown>);
      try {
        await saveToolOutput({
          orgId: getOrgId(),
          domain: 'ads',
          tool: 'ad_review',
          campaignId: data.campaignId,
          payload: analysis.data as unknown as Record<string, unknown>,
          status: 'saved',
        });
      } catch (err) {
        console.warn('[Wizard StepAdReview] tool_outputs save failed (non-fatal):', err);
      }
    } finally {
      setLoading(false);
      stopGeneration();
    }
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
// Calls the exact same generateAdConfig() AdConfig.tsx uses (including the
// verified-targeting-keywords lookup the old hand-rolled version lacked).

function StepAdConfig({ data, project, onResult }: {
  data: WizardData;
  project: Project | undefined;
  onResult: (r: Record<string, unknown>) => void;
}) {
  const [platform, setPlatform] = useState<AdPlatform>(DEFAULT_AD_PLATFORM);
  const inheritedFunnel = data.funnelStage;
  const [funnel, setFunnel] = useState<string>(inheritedFunnel || 'BOFU');
  const [pendingFunnel, setPendingFunnel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const { start: startGeneration, stop: stopGeneration } = useGenerationLock();

  function handleFunnelChange(newValue: string) {
    if (newValue === funnel) return;
    if (!inheritedFunnel || newValue === inheritedFunnel) {
      setFunnel(newValue);
      setPendingFunnel(null);
      return;
    }
    setPendingFunnel(newValue);
  }

  async function generate() {
    setLoading(true);
    startGeneration('Generating ad configuration…');
    try {
      const genResult = await generateAdConfig({ projectId: data.projectId, project, funnelStage: funnel, platform });
      if (genResult.status === 'error') { showToast(genResult.message, 'error'); return; }
      if (genResult.status === 'raw') { showToast('Config generation returned unstructured data — try again.', 'error'); return; }

      onResult(genResult.data as unknown as Record<string, unknown>);
      try {
        await saveToolOutput({
          orgId: getOrgId(),
          domain: 'ads',
          tool: 'ad_config',
          campaignId: data.campaignId,
          payload: genResult.data as unknown as Record<string, unknown>,
          status: 'saved',
          platform,
        });
      } catch (err) {
        console.warn('[Wizard StepAdConfig] tool_outputs save failed (non-fatal):', err);
      }
    } finally {
      setLoading(false);
      stopGeneration();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-tertiary">Configuring ads for <span className="text-text-primary font-medium">{data.projectName || 'selected project'}</span></p>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Ad Platform" options={PLATFORM_OPTIONS} value={platform} onChange={(e) => setPlatform(e.target.value as AdPlatform)} />
        <Select label="Funnel Stage" options={FUNNEL_OPTIONS} value={pendingFunnel ?? funnel} onChange={(e) => handleFunnelChange(e.target.value)} />
      </div>
      {pendingFunnel && (
        <div className="p-4 rounded-xl border border-warning-border bg-warning-subtle flex flex-col gap-3">
          <p className="text-sm text-warning-text">
            You picked <span className="font-semibold">{inheritedFunnel}</span> as the funnel in the Strategy step. Changing it to <span className="font-semibold">{pendingFunnel}</span> here may produce inconsistent ad output.
          </p>
          <div className="flex gap-2">
            <button onClick={() => { setFunnel(pendingFunnel); setPendingFunnel(null); }}
              className="px-4 py-1.5 rounded-lg bg-warning text-white text-sm font-medium hover:opacity-90 transition-colors">
              Yes, change to {pendingFunnel}
            </button>
            <button onClick={() => setPendingFunnel(null)}
              className="px-4 py-1.5 rounded-lg border border-border text-sm text-text-tertiary hover:text-text-primary transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
      <button onClick={generate} disabled={loading || pendingFunnel !== null}
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
  const strategyChecklist = (data.strategyResult as { post_production_notes?: string } | null)?.post_production_notes;
  const configChecklist = (data.configResult as { checklist?: string[] } | null)?.checklist ?? [];
  const allItems = [...(strategyChecklist ? [strategyChecklist] : []), ...configChecklist].filter(Boolean);
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

export function CampaignWizard({ onWizardEnd, onWizardStart }: { onWizardEnd?: () => void; onWizardStart?: () => void; wizardActive?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [step, setStep] = useState<StepNum>(1);
  const [data, setData] = useState<WizardData>(EMPTY_DATA);
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
      const [{ data: projectRows }, { data: inProgress }] = await Promise.all([
        supabase.from('projects')
          .select('id,name,locality,city,status,completion_pct,expected_possession,nearest_landmarks,unit_types,price_range_lacs,usps,units_remaining,amenities,rera_number,notes')
          .eq('is_active', true).eq('org_id', getOrgId()).order('priority', { ascending: true }),
        supabase.from('wizard_sessions').select('*').eq('org_id', getOrgId()).eq('status', 'in_progress')
          .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setProjects((projectRows ?? []) as Project[]);
      if (inProgress) setResumeBanner({ id: inProgress.id, step: inProgress.current_step, stepData: inProgress.step_data as Record<string, unknown> });
      setProjectsLoading(false);
    }
    init();
  }, []);

  const currentProject = projects.find((p) => p.id === data.projectId);

  function resume() {
    if (!resumeBanner) return;
    const d = resumeBanner.stepData;
    setData((prev) => ({
      ...prev,
      sessionId: resumeBanner.id,
      campaignId: (d.campaignId as string) ?? null,
      projectId: (d.projectId as string) || '',
      projectName: (d.projectName as string) || '',
      funnelStage: (d.funnelStage as WizardData['funnelStage']) ?? null,
      strategyOutputId: (d.strategyOutputId as string) ?? null,
      savedCreativeId: (d.savedCreativeId as string) ?? null,
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
      step_data: {
        campaignId: updatedData.campaignId,
        projectId: updatedData.projectId,
        projectName: updatedData.projectName,
        funnelStage: updatedData.funnelStage,
        strategyOutputId: updatedData.strategyOutputId,
        savedCreativeId: updatedData.savedCreativeId,
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

  // Strategy step's onSaved: creates the real `campaigns` row now that a
  // strategy exists to attach it to (StrategyGenerator itself stays
  // domain-agnostic and doesn't know about campaigns), then attaches its
  // id back onto the tool_output that was just saved with campaign_id=null,
  // so every later step's saveToolOutput call already has a real
  // campaign_id and the journey stitches together.
  async function handleStrategyResult(result: StrategyGeneratorResult) {
    const { data: campaign, error } = await supabase.from('campaigns').insert({
      org_id: getOrgId(),
      project_id: result.projectId ?? null,
      name: `${result.projectName} — ${new Date().toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      status: 'active',
      budget: {},
    }).select('id').single();

    if (error) {
      console.error('[Wizard] campaign creation failed (journey will not stitch across steps):', error.message);
    }
    const campaignId = campaign?.id ?? null;
    if (campaignId) {
      await supabase.from('tool_outputs').update({ campaign_id: campaignId }).eq('id', result.outputId);
    }

    setData((prev) => ({
      ...prev,
      campaignId,
      strategyOutputId: result.outputId,
      strategyResult: result.data as unknown as Record<string, unknown>,
      projectId: result.projectId ?? prev.projectId,
      projectName: result.projectName,
      funnelStage: result.funnelStage,
      savedCreativeId: result.savedCreativeId ?? null,
    }));
  }

  function handleCreativesResult(result: CreativeGeneratorResult) {
    setData((prev) => ({ ...prev, creativesResult: { outputId: result.outputId, imageCount: result.assetIds.length } }));
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

        {step === 1 && <StepStrategy data={data} onResult={handleStrategyResult} />}
        {step === 2 && <StepCreatives data={data} onResult={handleCreativesResult} />}
        {step === 3 && <StepAdReview data={data} project={currentProject} onResult={(r) => setData((prev) => ({ ...prev, reviewResult: r }))} onImageChange={(has) => { step3HasImageRef.current = has; }} />}
        {step === 4 && <StepAdConfig data={data} project={currentProject} onResult={(r) => setData((prev) => ({ ...prev, configResult: r as unknown as Record<string, unknown> }))} />}
        {step === 5 && <StepChecklist data={data} onUpdate={(items) => setData((prev) => ({ ...prev, checklist: items }))} />}
        {step === 6 && <StepFinalPlan data={data} onComplete={handleComplete} />}
      </Card>

      {/* Step 3 skip confirmation */}
      {step3SkipConfirm && (
        <div className="mb-4 p-4 rounded-xl border border-warning-border bg-warning-subtle flex flex-col gap-3">
          <p className="text-sm text-warning-text">You haven't uploaded or analyzed a creative. Are you sure you want to skip this step?</p>
          <div className="flex gap-2">
            <button onClick={async () => { setStep3SkipConfirm(false); await goNext(); }}
              className="px-4 py-1.5 rounded-lg bg-warning text-white text-sm font-medium hover:opacity-90 transition-colors">
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

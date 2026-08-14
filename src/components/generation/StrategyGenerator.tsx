import { DEFAULT_AD_PLATFORM } from '../../lib/ad-platform';
import { useEffect, useState } from 'react';
import { Wand2, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOrgId } from '../../lib/constants';
import { aiCall, describeImageForFlux, isAiEnabled } from '../../lib/ai-service';
import { buildQuickGenerateBrief } from '../../lib/senior-designer-prompts';
import { logAiSession, logActivity } from '../../lib/session-logger';
import { ReviewPopup } from '../ReviewPopup';
import { strategyReviewSections } from '../../lib/review-sections';
import { saveToolOutput } from '../../lib/history-service';
import { useGenerationLock } from '../../hooks/useGenerationLock';
import { useToast } from '../../contexts/ToastContext';
import { QuickGenerateForm } from '../../pages/strategy/QuickGenerateForm';
import { AanyaDesignerNotes } from '../../pages/strategy/StrategyResult';
import type { QuickGenerateInputs, SeniorDesignerResult, StrategyProject } from '../../pages/strategy/types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

const DEFAULT_INPUTS: QuickGenerateInputs = {
  prompt: '',
  projectId: '',
  customProject: { name: '', locality: '', city: '', price: '', unitsLeft: '', type: '', usps: '' },
  objective: 'Lead Generation',
  creativePlatform: 'Nanobanana (Gemini)',
  adPlatform: DEFAULT_AD_PLATFORM,
  competitorAnalysis: '',
  includePerSqft: false,
  perSqftRate: '',
  campaignGoal: 'lead_generation',
  languages: ['English'],
  quickRefs: [],
  // review-build hero/media-picker feature fields (required by QuickGenerateInputs).
  // StrategyGenerator doesn't expose those pickers, so it supplies empty defaults.
  projectMediaIds: [],
  heroRefKey: null,
};

function funnelStageFromGoal(goal: string): 'TOFU' | 'MOFU' | 'BOFU' {
  if (goal === 'awareness' || goal === 'branding') return 'TOFU';
  if (goal === 'engagement') return 'MOFU';
  return 'BOFU';
}

export interface StrategyGeneratorResult {
  outputId: string;
  data: SeniorDesignerResult;
  projectId?: string;
  projectName: string;
  funnelStage: 'TOFU' | 'MOFU' | 'BOFU';
  savedCreativeId?: string;
}

export interface StrategyGeneratorProps {
  campaignId?: string | null;
  initialProjectId?: string;
  onSaved: (result: StrategyGeneratorResult) => void;
}

// New reusable strategy-generation component, built from Strategy.tsx's
// handleQuickSubmit (the working senior-designer reference implementation)
// but with different, one-shot UX: no regenerate once a result exists
// (the form collapses to a summary strip and the generate button stays
// disabled), and an explicit "Save Strategy" action instead of Strategy.tsx's
// own image-focused "Save Creative" bar. Used by CampaignWizard's Strategy
// step; Strategy.tsx itself is intentionally left untouched (see CC-P3 PR
// description for why).
export function StrategyGenerator({ campaignId, initialProjectId, onSaved }: StrategyGeneratorProps) {
  const [projects, setProjects] = useState<StrategyProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [inputs, setInputs] = useState<QuickGenerateInputs>(() => ({ ...DEFAULT_INPUTS, projectId: initialProjectId ?? '' }));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ data: SeniorDesignerResult; savedCreativeId?: string; funnelStage: 'TOFU' | 'MOFU' | 'BOFU'; projectName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savingStrategy, setSavingStrategy] = useState(false);
  // PART D — review popup fires only after a SUCCESSFUL save, and carries the
  // saved row's id so the review points at a real tool_output.
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const { start: startGeneration, stop: stopGeneration } = useGenerationLock();
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      const { data } = await supabase
        .from('projects')
        .select('id,name,locality,city,units_remaining,price_range_lacs,usps,status,priority')
        .eq('is_active', true)
        .eq('org_id', getOrgId())
        .order('priority', { ascending: true });
      if (!cancelled) {
        setProjects((data ?? []) as StrategyProject[]);
        setProjectsLoading(false);
      }
    }
    loadProjects();
    return () => { cancelled = true; };
  }, []);

  async function handleGenerate() {
    if (!isAiEnabled()) {
      showToast('AI features are currently unavailable.', 'info');
      return;
    }
    const selectedProject = projects.find((p) => p.id === inputs.projectId);
    const projectName = inputs.projectId === 'custom' ? (inputs.customProject.name || 'Custom Project') : (selectedProject?.name ?? 'Unknown Project');
    const funnelStage = funnelStageFromGoal(inputs.campaignGoal);

    setSubmitting(true);
    startGeneration('Generating strategy…');
    setError(null);
    try {
      const enrichedRefs = inputs.quickRefs.length > 0
        ? await Promise.all(inputs.quickRefs.map(async (ref) => {
            const desc = await describeImageForFlux({ base64: ref.base64, mimeType: ref.mimeType });
            return desc ? { ...ref, visual_description: desc } : ref;
          }))
        : inputs.quickRefs;

      const { systemPrompt, userPrompt } = await buildQuickGenerateBrief({
        user_brief: inputs.prompt,
        project_id: inputs.projectId !== 'custom' ? inputs.projectId : undefined,
        project_data: inputs.projectId === 'custom'
          ? {
              name: inputs.customProject.name,
              locality: inputs.customProject.locality,
              city: inputs.customProject.city,
              price_range: inputs.customProject.price,
              units_remaining: parseInt(inputs.customProject.unitsLeft) || null,
              usps: inputs.customProject.usps,
              unit_types: inputs.customProject.type,
            } as unknown as import('../../lib/senior-designer-prompts').ProjectData
          : undefined,
        campaign_goal: inputs.campaignGoal as Parameters<typeof buildQuickGenerateBrief>[0]['campaign_goal'],
        funnel_stage: funnelStage,
        placement: 'feed_square',
        languages: inputs.languages,
        quick_references: enrichedRefs,
        ad_platform: inputs.adPlatform,
      });

      const rawResponse = await aiCall(userPrompt, systemPrompt, 16000, { traceName: 'strategy-generator-generate' });

      if (rawResponse.error) {
        setError(String(rawResponse.error));
        showToast(String(rawResponse.error), 'error');
        return;
      }

      let parsed: SeniorDesignerResult;
      if (rawResponse.raw) {
        const rawStr = String(rawResponse.raw);
        try {
          parsed = JSON.parse(rawStr);
        } catch {
          try {
            parsed = JSON.parse(rawStr.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim());
          } catch {
            const s = rawStr.indexOf('{');
            const e = rawStr.lastIndexOf('}');
            if (s !== -1 && e !== -1) parsed = JSON.parse(rawStr.substring(s, e + 1));
            else throw new Error('Could not parse AI response as JSON');
          }
        }
      } else {
        parsed = rawResponse as SeniorDesignerResult;
      }

      // Same `creatives` save Strategy.tsx does — creative_assets rows
      // uploaded by CreativeGenerator later reference this via creative_id.
      const primaryLang = (inputs.languages[0] ?? 'English').toLowerCase();
      const { data: savedCreative, error: saveError } = await supabase.from('creatives').insert({
        org_id: getOrgId(),
        project_id: inputs.projectId !== 'custom' ? inputs.projectId : null,
        headline: parsed.ad_copy?.[`headline_${primaryLang}`] ?? '',
        primary_text: parsed.ad_copy?.[`primary_text_${primaryLang}`] ?? '',
        cta: parsed.ad_copy?.cta ?? 'Send WhatsApp Message',
        nano_prompt: parsed.nanobanana_prompt_main ?? '',
        senior_designer_brief: parsed,
        reference_image_manifest: parsed.reference_image_manifest ?? [],
        design_dna_tags: parsed.design_dna_tags ?? {},
        languages: inputs.languages,
        angle: parsed.creative_concept ?? '',
        platform_used: 'Nanobanana (Gemini)',
        status: 'draft',
      }).select('id').maybeSingle();
      if (saveError) console.error('[StrategyGenerator] creatives save failed (non-fatal, image gen still works):', saveError.message);

      logAiSession(supabase, {
        sessionType: 'quick_generate_senior',
        projectIds: inputs.projectId && inputs.projectId !== 'custom' ? [inputs.projectId] : [],
        inputSummary: inputs.prompt || `Senior designer brief for ${projectName}`,
        inputData: { brief: inputs.prompt, goal: inputs.campaignGoal, languages: inputs.languages },
        outputData: parsed as Record<string, unknown>,
        claudeInputTokens: (rawResponse._inputTokens as number) ?? 0,
        claudeOutputTokens: (rawResponse._outputTokens as number) ?? 0,
      });
      logActivity(supabase, { action: 'generated_strategy', entityType: 'ai_session', details: { source: 'StrategyGenerator', project: projectName } });

      setResult({ data: parsed, savedCreativeId: savedCreative?.id, funnelStage, projectName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setError(msg);
      showToast('Generation failed. Check console.', 'error');
      console.error('[StrategyGenerator]', err);
    } finally {
      setSubmitting(false);
      stopGeneration();
    }
  }

  async function handleSaveStrategy() {
    if (!result) return;
    setSavingStrategy(true);
    try {
      const output = await saveToolOutput({
        orgId: getOrgId(),
        domain: 'ads',
        tool: 'strategy',
        campaignId: campaignId ?? null,
        payload: result.data as unknown as Record<string, unknown>,
        status: 'saved',
        // The platform the copy limits were written against — without it a
        // saved strategy is indistinguishable from one written for the other.
        platform: inputs.adPlatform,
      });
      setSaved(true);
      onSaved({
        outputId: output.id,
        data: result.data,
        projectId: inputs.projectId !== 'custom' ? inputs.projectId : undefined,
        projectName: result.projectName,
        funnelStage: result.funnelStage,
        savedCreativeId: result.savedCreativeId,
      });
      setReviewFor(output.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSavingStrategy(false);
    }
  }

  if (!result) {
    return (
      <div className="flex flex-col gap-5">
        <QuickGenerateForm
          projects={projects}
          projectsLoading={projectsLoading}
          inputs={inputs}
          onChange={setInputs}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={submitting || !inputs.projectId}
          className="w-full py-3 rounded-lg bg-brand text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? <Spinner size="sm" /> : <Wand2 size={15} />}
          {submitting ? 'Generating Strategy…' : 'Generate Strategy'}
        </button>
      </div>
    );
  }

  // Post-generation: form collapses to a summary strip, generate button
  // stays disabled (no regenerate in this one-shot component), full result
  // shown expanded.
  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">{result.projectName}</p>
          <p className="text-xs text-text-tertiary mt-0.5">{inputs.campaignGoal} · {result.funnelStage} · {inputs.languages.join(', ')}</p>
        </div>
        <button disabled className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold opacity-40 cursor-not-allowed flex items-center gap-2">
          <Wand2 size={14} />Generated
        </button>
      </Card>

      <Card className="p-5 flex flex-col gap-4">
        {result.data.creative_concept && <p className="text-sm font-medium text-text-primary">{result.data.creative_concept}</p>}
        <AanyaDesignerNotes brief={result.data} />
        {result.data.ad_copy && (
          <div className="flex flex-col gap-2 text-sm">
            {Object.entries(result.data.ad_copy).map(([k, v]) => (
              <div key={k}><span className="text-text-tertiary text-xs uppercase tracking-wide">{k.replace(/_/g, ' ')}: </span><span className="text-text-primary">{v}</span></div>
            ))}
          </div>
        )}
      </Card>

      <Button onClick={handleSaveStrategy} disabled={saved || savingStrategy} className="w-full">
        {saved ? <><Check size={15} />Strategy Saved</> : savingStrategy ? <Spinner size="sm" /> : 'Save Strategy'}
      </Button>

      {/* Sections are derived from what this run actually produced, so the
          reviewer is never asked to score something that wasn't generated. */}
      <ReviewPopup
        open={!!reviewFor}
        subjectType="strategy"
        subjectId={reviewFor}
        projectId={inputs.projectId !== 'custom' ? inputs.projectId : null}
        strategyType={inputs.campaignGoal}
        platform={inputs.adPlatform}
        projectName={result.projectName}
        sections={strategyReviewSections(result.data as unknown as Record<string, unknown>)}
        onClose={() => setReviewFor(null)}
      />
    </div>
  );
}

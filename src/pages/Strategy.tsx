import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Database, FolderKanban, Loader2, Zap } from 'lucide-react';
import { useChatbot } from '../contexts/ChatbotContext';
import { supabase } from '../lib/supabase';
import { getOrgId, getUserId, DEFAULT_CREATIVE_PLATFORM } from '../lib/constants';
import { getBrandProvider } from '../lib/providers';
import { useToast } from '../contexts/ToastContext';
import { aiCall, isAiEnabled, describeImageForFlux } from '../lib/ai-service';
import { logAiSession, logActivity } from '../lib/session-logger';
import { buildContext } from '../lib/context-builder';
import { useNavigation } from '../contexts/NavigationContext';
import { buildQuickGenerateBrief, runTwoStageQuickGenerate } from '../lib/senior-designer-prompts';
import { aspectFromBase64, type RefAspect } from '../lib/reference-edit';
import { projectAssetRoleHint } from '../components/ProjectMediaPicker';
import { useGenerationLock } from '../hooks/useGenerationLock';
import { QuickGenerateForm } from './strategy/QuickGenerateForm';
import { FullStrategyForm } from './strategy/FullStrategyForm';
import { StrategyResultPanel } from './strategy/StrategyResult';
import { Card } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { Spinner } from '../components/ui/Spinner';
import {
  type StrategyMode,
  type StrategyProject,
  type QuickGenerateInputs,
  type FullStrategyInputs,
  type StrategyResult,
  type QuickAiResult,
  type FullAiResult,
  type SeniorDesignerResult,
} from './strategy/types';
import {
  type ProjectConfiguration,
  type PriceHistoryEntry,
  autoCreateConfigFromProject,
} from './projects/types';


interface SelectedConfig {
  config: ProjectConfiguration;
  checked: boolean;
  currentPrice: string;
}

interface FullProject {
  id: string;
  name: string;
  locality: string | null;
  city: string | null;
  status: string | null;
  completion_pct: number | null;
  expected_possession: string | null;
  nearest_landmarks: string | null;
  usps: string | null;
  amenities: string | null;
  rera_number: string | null;
  units_remaining: number | null;
  price_range_lacs: string | null;
  unit_types: string | null;
  carpet_area_range: string | null;
  total_units: number | null;
  configurations: ProjectConfiguration[] | null;
  price_history: PriceHistoryEntry[] | null;
}

const DEFAULT_QUICK: QuickGenerateInputs = {
  prompt: '',
  projectId: '',
  customProject: {
    name: '',
    locality: '',
    city: 'Bhubaneswar',
    price: '',
    unitsLeft: '',
    type: '3BHK',
    usps: '',
  },
  objective: 'Lead Generation',
  creativePlatform: 'Nanobanana (Gemini)',
  adPlatform: 'AiSensy',
  competitorAnalysis: '',
  includePerSqft: false,
  perSqftRate: '',
  campaignGoal: 'lead_generation',
  languages: ['English'],
  quickRefs: [],
  projectMediaIds: [],
  heroRefKey: null,
};

const DEFAULT_FULL: FullStrategyInputs = {
  monthlyBudget: 18000,
  leadsPerMonth: 100,
  svsPerMonth: 20,
  bookingsPerMonth: 2,
  scale: '2-5 bookings/month',
  enableOdia: true,
  selectedProjectIds: [],
  includePerSqft: false,
  perSqftRate: '',
};

export function Strategy() {
  const { navigate, setGeneratingPage, setGenerationProgress } = useNavigation();
  const { start: startGeneration, stop: stopGeneration } = useGenerationLock();
  const { setCurrentData } = useChatbot();
  const [mode, setMode] = useState<StrategyMode>('quick');
  const [projects, setProjects] = useState<StrategyProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Full project data for the selected quick project
  const [fullProject, setFullProject] = useState<FullProject | null>(null);
  const [fullProjectLoading, setFullProjectLoading] = useState(false);

  // Config selection state for quick generate
  const [selectedConfigs, setSelectedConfigs] = useState<SelectedConfig[]>([]);
  const [updatePricesInDb, setUpdatePricesInDb] = useState(true);

  const [quickInputs, setQuickInputs] = useState<QuickGenerateInputs>(DEFAULT_QUICK);
  const [fullInputs, setFullInputs] = useState<FullStrategyInputs>(DEFAULT_FULL);

  const [submitting, setSubmitting] = useState(false);
  const [geminiActive, setGeminiActive] = useState(false);
  const [result, setResult] = useState<StrategyResult>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (submitting) {
      setGeneratingPage('strategy');
      setGenerationProgress(30);
      startGeneration('Generating strategy…');
    } else if (geminiActive) {
      setGeneratingPage('strategy');
      setGenerationProgress(65);
      startGeneration('Generating images…');
    } else {
      setGeneratingPage(null);
      setGenerationProgress(null);
      stopGeneration();
    }
    return () => {
      setGeneratingPage(null);
      setGenerationProgress(null);
      stopGeneration();
    };
  }, [submitting, geminiActive, setGeneratingPage, setGenerationProgress, startGeneration, stopGeneration]);

  useEffect(() => {
    if (result) {
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [result]);
  const [brandKit, setBrandKit] = useState<{ default_languages?: string[] } | null>(null);

  useEffect(() => {
    getBrandProvider().getBrandKit(getOrgId())
      .then((kit) => { if (kit) setBrandKit({ default_languages: kit.default_languages as string[] | undefined }); });
  }, []);

  useEffect(() => {
    async function loadProjects() {
      setProjectsLoading(true);
      const { data } = await supabase
        .from('projects')
        .select('id,name,locality,city,units_remaining,price_range_lacs,usps,status,priority')
        .eq('is_active', true)
        .eq('org_id', getOrgId())
        .order('priority', { ascending: true })
        .order('name');
      const rows = (data ?? []) as StrategyProject[];
      setProjects(rows);
      // Skip the default-select when a Canva-return resume is pending below —
      // that effect sets the real originating project; this would otherwise
      // race it and could win with the wrong (first-in-list) project.
      if (rows.length > 0 && !sessionStorage.getItem('canva_resume_creative_id')) {
        setQuickInputs((prev) => ({ ...prev, projectId: rows[0].id }));
      }
      setProjectsLoading(false);
    }
    loadProjects();
  }, []);

  // A cold-start OAuth connect is a full top-level browser navigation to
  // Canva.com and back, wiping all of this component's React state, but the
  // underlying data isn't actually lost (handleQuickSubmit already persists
  // the full AI result + images before the user ever reaches the edit
  // step) — this reloads both instead of leaving an empty "create a
  // strategy" form. (The Return Navigation flow — bug #55 — doesn't need
  // this at all: it never navigates this tab away in the first place.)
  async function restoreCreativeFromAssetId(resumeId: string): Promise<boolean> {
    const { data: asset } = await supabase
      .from('creative_assets')
      .select('id, creative_id, session_id')
      .eq('id', resumeId)
      .maybeSingle();
    if (!asset?.creative_id) return false;

    const { data: creative } = await supabase
      .from('creatives')
      .select('id, project_id, languages, senior_designer_brief')
      .eq('id', asset.creative_id)
      .maybeSingle();
    const aiData = creative?.senior_designer_brief as SeniorDesignerResult | undefined;
    if (!creative || !aiData) return false;

    const { data: siblingRows } = await supabase
      .from('creative_assets')
      .select('id, image_url, storage_path, status')
      .eq('creative_id', asset.creative_id)
      .eq('session_id', asset.session_id ?? '')
      .order('created_at', { ascending: true });

    const resumedGalleryImages = (siblingRows ?? [])
      .filter((row) => !!row.image_url)
      .map((row) => {
        const suffix = (row.storage_path as string | null)?.match(/-(feed|portrait|story)\.[a-z0-9]+$/i)?.[1]?.toLowerCase();
        const label = suffix === 'portrait' ? 'Portrait Feed (1080×1350)' : suffix === 'story' ? 'Story (1080×1920)' : 'Feed (1080×1080)';
        const promptUsed = suffix === 'portrait' ? aiData.nanobanana_prompt_portrait : suffix === 'story' ? aiData.nanobanana_prompt_story : aiData.nanobanana_prompt_main;
        return {
          id: row.id as string,
          url: row.image_url as string,
          label,
          storagePath: (row.storage_path as string | null) ?? undefined,
          promptUsed: promptUsed ?? undefined,
          adCopy: { headline: aiData.ad_copy?.headline_english, cta: aiData.ad_copy?.cta },
          approved: row.status === 'approved',
        };
      });
    if (resumedGalleryImages.length === 0) return false;

    const restoredProjectId = (creative.project_id as string | null) ?? 'custom';
    const restoredLanguages = (creative.languages as string[] | null) ?? DEFAULT_QUICK.languages;
    setQuickInputs((prev) => ({ ...prev, projectId: restoredProjectId, languages: restoredLanguages }));

    let projectName = 'Restored Project';
    if (restoredProjectId !== 'custom') {
      const { data: proj } = await supabase.from('projects').select('name').eq('id', restoredProjectId).maybeSingle();
      projectName = proj?.name ?? projectName;
    }

    setResult({
      type: 'quick_senior',
      inputs: { ...DEFAULT_QUICK, projectId: restoredProjectId, languages: restoredLanguages },
      projectName,
      aiData,
      savedId: creative.id as string,
      resumedGalleryImages,
    });
    return true;
  }

  useEffect(() => {
    const resumeId = sessionStorage.getItem('canva_resume_creative_id');
    if (!resumeId) return;
    restoreCreativeFromAssetId(resumeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load full project data when projectId changes
  useEffect(() => {
    if (!quickInputs.projectId || quickInputs.projectId === 'custom') {
      setFullProject(null);
      setSelectedConfigs([]);
      return;
    }
    async function loadFull() {
      setFullProjectLoading(true);
      const { data } = await supabase
        .from('projects')
        .select('id,name,locality,city,status,completion_pct,expected_possession,nearest_landmarks,usps,amenities,rera_number,units_remaining,price_range_lacs,unit_types,carpet_area_range,total_units,configurations,price_history')
        .eq('id', quickInputs.projectId)
        .maybeSingle();
      if (data) {
        const fp = data as FullProject;
        setFullProject(fp);
        // Build config selection state
        const configs = autoCreateConfigFromProject({ ...fp, is_active: true, created_at: '', updated_at: '', id: fp.id, org_id: null, code: null, per_sqft_rate: null, target_buyer: null, priority: null, budget_segment: null, landing_page_url: null, brochure_url: null, whatsapp_flow: null, notes: null, meta_ad_account_id: null });
        setSelectedConfigs(
          configs.map((cfg) => ({
            config: cfg,
            checked: cfg.available,
            currentPrice: cfg.price_lacs,
          }))
        );
      }
      setFullProjectLoading(false);
    }
    loadFull();
  }, [quickInputs.projectId]);

  function switchMode(m: StrategyMode) {
    setMode(m);
    setResult(null);
  }

  function toggleConfig(idx: number) {
    if (!selectedConfigs[idx].config.available) return;
    setSelectedConfigs((prev) =>
      prev.map((sc, i) => (i === idx ? { ...sc, checked: !sc.checked } : sc))
    );
  }

  function updateConfigPrice(idx: number, price: string) {
    setSelectedConfigs((prev) =>
      prev.map((sc, i) => (i === idx ? { ...sc, currentPrice: price } : sc))
    );
  }

  async function loadVerifiedKeywords(platform: string): Promise<{ available: string[]; notFound: string[] }> {
    const { data } = await supabase
      .from('targeting_keywords')
      .select('keyword, status')
      .eq('platform', platform)
      .in('status', ['available', 'not_found']);
    const rows = (data ?? []) as { keyword: string; status: string }[];
    return {
      available: rows.filter((r) => r.status === 'available').map((r) => r.keyword),
      notFound: rows.filter((r) => r.status === 'not_found').map((r) => r.keyword),
    };
  }

  async function savePriceUpdates() {
    if (!fullProject || quickInputs.projectId === 'custom') return;
    const changed = selectedConfigs.filter(
      (sc) => sc.checked && sc.currentPrice !== sc.config.price_lacs && sc.currentPrice.trim() !== ''
    );
    if (changed.length === 0) return;

    // Build updated configs array
    const updatedConfigs = (autoCreateConfigFromProject({ ...fullProject, is_active: true, created_at: '', updated_at: '', id: fullProject.id, org_id: null, code: null, per_sqft_rate: null, target_buyer: null, priority: null, budget_segment: null, landing_page_url: null, brochure_url: null, whatsapp_flow: null, notes: null, meta_ad_account_id: null })).map((cfg) => {
      const match = changed.find((sc) => sc.config.type === cfg.type);
      return match ? { ...cfg, price_lacs: match.currentPrice } : cfg;
    });

    const newHistoryEntries: PriceHistoryEntry[] = changed.map((sc) => ({
      date: new Date().toISOString(),
      type: sc.config.type,
      old_price: sc.config.price_lacs,
      new_price: sc.currentPrice,
      source: 'strategy_quick_generate',
    }));

    const existingHistory = fullProject.price_history ?? [];
    await supabase
      .from('projects')
      .update({
        configurations: updatedConfigs,
        price_history: [...existingHistory, ...newHistoryEntries],
        updated_at: new Date().toISOString(),
      })
      .eq('id', fullProject.id);

    const types = changed.map((sc) => sc.config.type).join(', ');
    showToast(`Prices updated in database for ${types}`, 'success');
  }

  async function handleQuickSubmit() {
    const selectedProject = projects.find((p) => p.id === quickInputs.projectId);
    const projectName =
      quickInputs.projectId === 'custom'
        ? quickInputs.customProject.name || 'Custom Project'
        : selectedProject?.name ?? 'Unknown Project';

    if (!isAiEnabled()) {
      showToast('AI features are currently unavailable.', 'info');
      setResult({
        type: 'quick',
        inputs: quickInputs,
        projectName,
        error: 'AI generation is currently unavailable.',
      });
      return;
    }

    // ── Senior Designer path (always) ────────────────────────────────────────
    setSubmitting(true);
    try {
        const funnel =
          quickInputs.campaignGoal === 'awareness' || quickInputs.campaignGoal === 'branding'
            ? 'TOFU'
            : quickInputs.campaignGoal === 'engagement'
            ? 'MOFU'
            : 'BOFU';

        // Enrich uploaded reference images with Claude Vision descriptions so
        // FLUX gets rich visual context instead of a bare URL text hint.
        const enrichedRefs = quickInputs.quickRefs.length > 0
          ? await Promise.all(
              quickInputs.quickRefs.map(async (ref) => {
                const desc = await describeImageForFlux({ base64: ref.base64, mimeType: ref.mimeType });
                return desc ? { ...ref, visual_description: desc } : ref;
              })
            )
          : quickInputs.quickRefs;

        // Project media the user ticked in ProjectMediaPicker — same vision-enrichment
        // treatment as ad-hoc quick refs, so a bare asset_url is never sent to a
        // text-to-image model with no description of what's actually in the photo.
        let projectMediaRefs: typeof enrichedRefs = [];
        if (quickInputs.projectMediaIds.length > 0) {
          const { data: pickedAssets, error: pickedAssetsErr } = await supabase
            .from('project_assets')
            .select('id, asset_type, asset_url, title, description')
            .eq('org_id', getOrgId())
            .in('id', quickInputs.projectMediaIds);

          if (pickedAssetsErr) {
            console.error('Failed to load selected project media — generating without it:', pickedAssetsErr);
            showToast('Could not load the selected project photos — generating without them.', 'error');
          }

          if (pickedAssets && pickedAssets.length > 0) {
            projectMediaRefs = await Promise.all(
              pickedAssets.map(async (asset) => {
                const desc = await describeImageForFlux(asset.asset_url as string);
                return {
                  id: asset.id as string,
                  preview_url: asset.asset_url as string,
                  base64: '',
                  mimeType: '',
                  user_intent: (asset.description as string) || (asset.title as string) || `Project ${(asset.asset_type as string).replace(/_/g, ' ')} reference`,
                  role_hint: projectAssetRoleHint(asset.asset_type as string),
                  filename: (asset.title as string) || undefined,
                  visual_description: desc ?? undefined,
                };
              })
            );
          }
        }

        const allRefs = [...enrichedRefs, ...projectMediaRefs];

        // Hero reference image feature: resolve the marked hero + any
        // amenity-role supporting refs into the shape generate-image expects.
        // Refs with real base64 (quick uploads) go through as bytes; project-
        // asset-sourced refs (base64 === '') go through as a URL — the
        // generate-image edge function fetches those server-side.
        let heroImages: import('../lib/gemini-service').HeroImageRef[] | undefined;
        if (quickInputs.heroRefKey) {
          const heroEntry = allRefs.find((r) => r.id === quickInputs.heroRefKey);
          if (heroEntry) {
            const supportingEntries = allRefs.filter(
              (r) => r.id !== quickInputs.heroRefKey && r.role_hint === 'amenity'
            );
            const toHeroRef = (r: typeof heroEntry): import('../lib/gemini-service').HeroImageRef =>
              r.base64 ? { base64: r.base64, mimeType: r.mimeType } : { url: r.preview_url };
            heroImages = [toHeroRef(heroEntry), ...supportingEntries.map(toHeroRef)];
          }
        }

        // Replicate-an-ad-creative mode: an uploaded quick-ref marked with the
        // 'replicate_creative' role becomes the LAYOUT to copy, with the
        // project's hero_exterior photo as the building subject. Reuses the
        // exact hero-image wire (heroImage=reference creative, supportingImages
        // =[project hero]); only the prompt wrapper + single-aspect output
        // differ (handled in StrategyResult). Overrides any hero selection.
        let replicateAspect: RefAspect | undefined;
        const replicateRef = quickInputs.quickRefs.find((r) => r.role_hint === 'replicate_creative');
        if (replicateRef && quickInputs.projectId && quickInputs.projectId !== 'custom') {
          const { data: heroRow } = await supabase
            .from('project_assets')
            .select('asset_url')
            .eq('project_id', quickInputs.projectId)
            .eq('asset_type', 'hero_exterior')
            .order('is_primary', { ascending: false })
            .limit(1)
            .maybeSingle();
          const heroUrl = (heroRow as { asset_url?: string } | null)?.asset_url;
          if (heroUrl) {
            replicateAspect = await aspectFromBase64(replicateRef.base64, replicateRef.mimeType);
            heroImages = [
              { base64: replicateRef.base64, mimeType: replicateRef.mimeType },
              { url: heroUrl },
            ];
          } else {
            showToast('No hero image on this project — generating normally. Add a hero image in Projects → Media to replicate the uploaded creative.', 'info');
          }
        }

        console.log('🎨 [AANYA] Starting two-stage generation (concept+copy, then 3 parallel layout prompts)...');

        const rawResponse = await runTwoStageQuickGenerate({
          user_brief: quickInputs.prompt,
          project_id: quickInputs.projectId !== 'custom' ? quickInputs.projectId : undefined,
          project_data:
            quickInputs.projectId === 'custom'
              ? {
                  name: quickInputs.customProject.name,
                  locality: quickInputs.customProject.locality,
                  city: quickInputs.customProject.city,
                  price_range: quickInputs.customProject.price,
                  units_remaining: parseInt(quickInputs.customProject.unitsLeft) || null,
                  usps: quickInputs.customProject.usps,
                  unit_types: quickInputs.customProject.type,
                } as unknown as import('../lib/senior-designer-prompts').ProjectData
              : undefined,
          campaign_goal: quickInputs.campaignGoal as Parameters<typeof buildQuickGenerateBrief>[0]['campaign_goal'],
          funnel_stage: funnel,
          placement: 'feed_square',
          languages: quickInputs.languages,
          quick_references: allRefs,
          ad_platform: quickInputs.adPlatform as 'AiSensy' | 'Meta Ads Manager',
        }, replicateAspect
          // Rung 1 hard branch: in replicate mode the 9-section assembly (Stage 2)
          // MUST NOT run — `layouts: []` runs Stage 1 (concept + ad_copy) only and
          // skips every Stage 2 layout call, so no `nanobanana_prompt_main` is
          // produced to contaminate the edit directive. The replicate prompt is
          // built from ad_copy alone in StrategyResult (buildReplicatePrompt).
          ? { traceNamePrefix: 'strategy-quick-generate', layouts: [] }
          : { traceNamePrefix: 'strategy-quick-generate' });

        console.log('🎨 [DIAGNOSTIC] AI raw response type:', typeof rawResponse);
        console.log('🎨 [DIAGNOSTIC] AI response keys:', Object.keys(rawResponse));
        if (rawResponse.raw) {
          const rawStr = String(rawResponse.raw);
          console.log('🎨 [DIAGNOSTIC] AI raw string length:', rawStr.length);
          console.log('🎨 [DIAGNOSTIC] AI response first 500 chars:', rawStr.substring(0, 500));
        }

        if (rawResponse.error) {
          showToast(String(rawResponse.error), 'error');
          setResult({ type: 'quick_senior', inputs: quickInputs, projectName, error: String(rawResponse.error) });
          setSubmitting(false);
          return;
        }

        // Parse JSON robustly — aiCall returns pre-parsed object or { raw: string }
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
              if (s !== -1 && e !== -1) {
                parsed = JSON.parse(rawStr.substring(s, e + 1));
              } else {
                throw new Error('Could not parse AI response as JSON');
              }
            }
          }
        } else {
          parsed = rawResponse as SeniorDesignerResult;
        }

        // Save to creatives table
        const primaryLang = (quickInputs.languages[0] ?? 'English').toLowerCase();
        const savePayload = {
          org_id: getOrgId(),
          project_id: quickInputs.projectId !== 'custom' ? quickInputs.projectId : null,
          headline: parsed.ad_copy?.[`headline_${primaryLang}`] ?? '',
          primary_text: parsed.ad_copy?.[`primary_text_${primaryLang}`] ?? '',
          cta: parsed.ad_copy?.cta ?? 'Send WhatsApp Message',
          nano_prompt: parsed.nanobanana_prompt_main ?? '',
          senior_designer_brief: parsed,
          reference_image_manifest: parsed.reference_image_manifest ?? [],
          design_dna_tags: parsed.design_dna_tags ?? {},
          languages: quickInputs.languages,
          angle: parsed.creative_concept ?? '',
          platform_used: DEFAULT_CREATIVE_PLATFORM,
          status: 'draft',
        };
        console.log('🎨 [DIAGNOSTIC] About to save creative with payload keys:', Object.keys(savePayload));
        console.log('🎨 [DIAGNOSTIC] org_id:', savePayload.org_id, '| project_id:', savePayload.project_id, '| has_headline:', !!savePayload.headline, '| has_nano_prompt:', !!savePayload.nano_prompt);
        const { data: saved, error: saveError } = await supabase.from('creatives').insert(savePayload).select('id').maybeSingle();
        if (saveError) {
          console.error('❌ [SAVE FAILED]', {
            message: saveError.message,
            details: saveError.details,
            hint: saveError.hint,
            code: saveError.code,
          });
          showToast(`Save failed: ${saveError.message}`, 'error');
        } else {
          console.log('✅ [SAVE SUCCESS] Creative ID:', saved?.id ?? '(null — RLS may have filtered return)');
        }

        logAiSession(supabase, {
          sessionType: 'quick_generate_senior',
          projectIds: quickInputs.projectId && quickInputs.projectId !== 'custom' ? [quickInputs.projectId] : [],
          inputSummary: quickInputs.prompt || `Senior designer brief for ${projectName}`,
          inputData: { brief: quickInputs.prompt, goal: quickInputs.campaignGoal, languages: quickInputs.languages },
          outputData: parsed as Record<string, unknown>,
          claudeInputTokens: (rawResponse._inputTokens as number) ?? 0,
          claudeOutputTokens: (rawResponse._outputTokens as number) ?? 0,
        });
        logActivity(supabase, {
          action: 'generated_strategy',
          entityType: 'ai_session',
          details: { mode: 'quick_senior', project: projectName },
        });

        if (updatePricesInDb) await savePriceUpdates();

        setResult({ type: 'quick_senior', inputs: quickInputs, projectName, aiData: parsed, savedId: saved?.id, heroImages, replicateAspect });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      showToast('Generation failed. Check console.', 'error');
      console.error('[Senior Designer]', err);
      setResult({ type: 'quick_senior', inputs: quickInputs, projectName, error: msg });
    }
    setSubmitting(false);
  }
  async function handleFullSubmit() {
    if (!isAiEnabled()) {
      setResult({
        type: 'full',
        inputs: fullInputs,
        projects,
        error: 'AI generation is currently unavailable.',
      });
      return;
    }

    setSubmitting(true);

    const [context, verifiedKw] = await Promise.all([
      buildContext(),
      loadVerifiedKeywords('Meta Ads Manager'),
    ]);
    const selected = projects.filter((p) => fullInputs.selectedProjectIds.includes(p.id));
    const month = new Date().toLocaleString('en-IN', { month: 'short', year: '2-digit' });

    const verifiedSection = [
      verifiedKw.available.length > 0 ? `VERIFIED TARGETING (confirmed available in Meta): ${verifiedKw.available.join(', ')}` : '',
      verifiedKw.notFound.length > 0 ? `NOT AVAILABLE (do NOT suggest these): ${verifiedKw.notFound.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const prompt = [
      'CRITICAL: Use ONLY the project details provided below. Do NOT invent or assume any information not explicitly provided. If RERA is not listed for a project, do NOT include it anywhere in the output.',
      'Generate a complete Meta Ads campaign strategy for an Indian real estate developer. Write REAL content.',
      `MONTHLY BUDGET: ₹${fullInputs.monthlyBudget}`,
      `TARGETS: ${fullInputs.leadsPerMonth} leads/mo, ${fullInputs.svsPerMonth} site visits/mo, ${fullInputs.bookingsPerMonth} bookings/mo`,
      `SCALE: ${fullInputs.scale}`,
      `VERNACULAR: ${fullInputs.enableOdia ? 'Include Odia ads' : 'English only'}`,
      `PROJECTS (${selected.length}) — use ONLY these details for each project:`,
      ...selected.map(
        (p, i) =>
          `  ${i + 1}. Name: ${p.name} | Location: ${p.locality ?? 'Not specified'}, ${p.city ?? 'Bhubaneswar'} | Price: ₹${p.price_range_lacs ?? 'Not specified'}L | Units Remaining: ${p.units_remaining ?? 'Not specified'} | USPs: ${p.usps ?? 'None listed'}`
      ),
      `PERIOD: ${month}`,
      verifiedSection || '',
      fullInputs.includePerSqft && fullInputs.perSqftRate
        ? `INCLUDE PRICE PER SQ.FT in ad copy and creatives: ₹${fullInputs.perSqftRate}/sqft. Mention in headlines or primary text where relevant.`
        : 'DO NOT mention per sqft rate anywhere.',
      'For each project, create a campaign with TOFU, MOFU, and BOFU stages. Use ONLY the exact project name, location, price, and USPs listed above.',
      'Respond ONLY in this exact JSON:',
      JSON.stringify({
        overview: 'Strategic overview paragraph',
        budgetAdvice: 'Budget allocation advice',
        campaigns: [
          {
            project: 'Project Name',
            funnelStage: 'TOFU/MOFU/BOFU',
            objective: 'Campaign objective',
            audience: 'Target audience description',
            placements: 'Placements',
            budget: '₹X/day',
            creativeFormat: 'Format',
            primaryText: 'Actual ad copy',
            headline: 'Actual headline',
            ageRange: '28 to 50',
            locations: 'cities',
            interests: 'comma-separated interest keywords',
            demographics: 'REAL job titles and life events from Meta targeting',
            occupations: 'specific job titles available in Meta',
            educationLevel: 'College Graduate, Postgraduate',
            lifeEvents: 'Recently married, Recently moved',
            behaviors: 'targeting behaviors',
          },
        ],
      }),
    ].filter(Boolean).join('\n\n');

    const fullPrompt = context ? prompt + '\n\n' + context : prompt;

    try {
      const res = await aiCall(fullPrompt, undefined, 16000, { traceName: 'strategy-full-strategy' });
      if (res.error) {
        setResult({ type: 'full', inputs: fullInputs, projects, error: String(res.error) });
      } else if (res.raw) {
        setResult({ type: 'full', inputs: fullInputs, projects, rawText: String(res.raw) });
      } else {
        const fullParsed = res as FullAiResult;

        let aanyaInputTokens = 0;
        let aanyaOutputTokens = 0;

        // ── Aanya senior designer creative upgrade (mirrors Meta-path lines 537-605) ──
        try {
          console.log('🎨 [AANYA-FULL] Calling Aanya for creative prompt upgrade...');

          const languages = fullInputs.enableOdia ? ['English', 'Odia'] : ['English'];
          const primaryProjectId = fullInputs.selectedProjectIds[0];

          const briefSummary = [
            `Generate a high-converting Meta ad creative for a real estate campaign at scale "${fullInputs.scale}".`,
            `Monthly budget ₹${fullInputs.monthlyBudget}.`,
            `Targets: ${fullInputs.leadsPerMonth} leads, ${fullInputs.svsPerMonth} site visits, ${fullInputs.bookingsPerMonth} bookings per month.`,
            fullInputs.includePerSqft && fullInputs.perSqftRate
              ? `Highlight price per sq.ft: ₹${fullInputs.perSqftRate}/sqft.`
              : '',
          ].filter(Boolean).join(' ');

          const { systemPrompt: aanyaSystem, userPrompt: aanyaUser } = await buildQuickGenerateBrief({
            user_brief: briefSummary,
            project_id: primaryProjectId,
            campaign_goal: 'lead_generation',
            funnel_stage: 'BOFU',
            placement: 'feed_square',
            languages,
            ad_platform: 'Meta Ads Manager',
          });

          console.log('🎨 [AANYA-FULL] System prompt length:', aanyaSystem.length);
          console.log('🎨 [AANYA-FULL] Languages:', languages, '| Primary project:', primaryProjectId);

          const aanyaRes = await aiCall(aanyaUser, aanyaSystem, 16000, { traceName: 'strategy-full-aanya-creative' });
          aanyaInputTokens = (aanyaRes._inputTokens as number) ?? 0;
          aanyaOutputTokens = (aanyaRes._outputTokens as number) ?? 0;
          console.log('🎨 [AANYA-FULL] Response keys:', Object.keys(aanyaRes));

          let aanyaParsed: SeniorDesignerResult;
          if (aanyaRes.raw) {
            const s = String(aanyaRes.raw);
            try { aanyaParsed = JSON.parse(s); }
            catch {
              try { aanyaParsed = JSON.parse(s.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); }
              catch {
                const st = s.indexOf('{'); const en = s.lastIndexOf('}');
                if (st !== -1 && en !== -1) { aanyaParsed = JSON.parse(s.substring(st, en + 1)); }
                else { throw new Error('Could not parse Aanya response'); }
              }
            }
          } else if (aanyaRes.error) {
            throw new Error(String(aanyaRes.error));
          } else {
            aanyaParsed = aanyaRes as SeniorDesignerResult;
          }

          if (aanyaParsed.nanobanana_prompt_main) {
            fullParsed.creativePrompt = aanyaParsed.nanobanana_prompt_main;
          }
          if (aanyaParsed.nanobanana_prompt_story) {
            fullParsed.creativePromptStory = aanyaParsed.nanobanana_prompt_story;
          }
          fullParsed._aanyaBrief = aanyaParsed;

          console.log('✅ [AANYA-FULL] Creative prompts upgraded by Aanya');
        } catch (aanyaErr) {
          console.warn('⚠️ [AANYA-FULL] Aanya call failed, keeping Full Strategy output as-is:', aanyaErr);
        }

        setResult({ type: 'full', inputs: fullInputs, projects, aiData: fullParsed });
        logAiSession(supabase, {
          sessionType: 'full_strategy',
          projectIds: fullInputs.selectedProjectIds,
          inputSummary: `Full strategy: ₹${fullInputs.monthlyBudget}/mo, ${fullInputs.leadsPerMonth} leads, ${selected.length} projects`,
          inputData: { monthlyBudget: fullInputs.monthlyBudget, leadsPerMonth: fullInputs.leadsPerMonth, scale: fullInputs.scale },
          outputData: fullParsed as Record<string, unknown>,
          claudeInputTokens: ((res._inputTokens as number) ?? 0) + aanyaInputTokens,
          claudeOutputTokens: ((res._outputTokens as number) ?? 0) + aanyaOutputTokens,
        });
        logActivity(supabase, {
          action: 'generated_strategy',
          entityType: 'ai_session',
          details: { mode: 'full', projectCount: selected.length },
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      setResult({ type: 'full', inputs: fullInputs, projects, error: msg });
    }

    setSubmitting(false);
  }

  async function saveQuickCampaign(data: QuickAiResult) {
    const projectId = quickInputs.projectId !== 'custom' ? quickInputs.projectId : null;
    const row = {
      org_id: getOrgId(),
      project_id: projectId,
      campaign_name: data.campaignName || `Quick Ad — ${new Date().toLocaleDateString('en-IN')}`,
      funnel_stage: 'BOFU',
      platform: quickInputs.adPlatform,
      ad_type: data.adType || 'CTWA',
      objective: data.objective || 'Messages',
      targeting: { locations: data.locations, ageRange: data.ageRange, gender: data.gender, interests: data.interests, behaviors: data.behaviors },
      placements: { placements: data.placements },
      budget: { daily: data.dailyBudget, duration: data.duration, total: '', bid_strategy: data.bidStrategy },
      creative_config: { primaryText: data.primaryText, primaryTextOdia: data.primaryTextOdia, headline: data.headline, description: data.description, cta: data.callToAction },
      icebreakers: data.icebreakers || [],
      whatsapp_flow: data.whatsappFlow || '',
      status: 'draft',
      source: 'quick_generate',
      created_by: getUserId(),
    };
    supabase.from('campaigns').insert(row).then(({ error }) => {
      if (error) showToast('Failed to save campaign', 'error');
      else {
        showToast('Campaign saved as draft!', 'success');
        logActivity(supabase, { action: 'created_campaign', entityType: 'campaign', details: { name: row.campaign_name, source: 'quick_generate' } });
      }
    });
  }

  async function saveFullCampaigns(data: FullAiResult) {
    const campaigns = data.campaigns ?? [];
    if (campaigns.length === 0) return;
    const rows = campaigns.map((c) => ({
      org_id: getOrgId(), project_id: null,
      campaign_name: String(c.project ?? 'Campaign'),
      funnel_stage: String(c.funnelStage ?? 'BOFU'),
      platform: 'Meta', ad_type: 'CTWA',
      objective: String(c.objective ?? 'Messages'),
      targeting: { audience: c.audience, ageRange: c.ageRange, locations: c.locations },
      placements: { placements: c.placements },
      budget: { daily: c.budget, total: '' },
      creative_config: { primaryText: c.primaryText, headline: c.headline, format: c.creativeFormat },
      icebreakers: [], status: 'draft', source: 'full_strategy', created_by: getUserId(),
    }));
    supabase.from('campaigns').insert(rows).then(({ error }) => {
      if (error) showToast('Failed to save campaigns', 'error');
      else {
        showToast(`${rows.length} campaign${rows.length !== 1 ? 's' : ''} saved as drafts!`, 'success');
        logActivity(supabase, { action: 'created_campaign', entityType: 'campaign', details: { count: rows.length, source: 'full_strategy' } });
      }
    });
  }

  useEffect(() => {
    setCurrentData({ page: 'strategy', mode, result, projectName: projects.find((p) => p.id === quickInputs.projectId)?.name });
  }, [result, mode]);

  const priceChanged = selectedConfigs.some(
    (sc) => sc.checked && sc.currentPrice !== sc.config.price_lacs && sc.currentPrice.trim() !== ''
  );

  const quickProjectForReview = (() => {
    if (quickInputs.projectId === 'custom') {
      return {
        name: quickInputs.customProject.name,
        locality: quickInputs.customProject.locality,
        city: quickInputs.customProject.city,
        price_range_lacs: quickInputs.customProject.price,
        units_remaining: quickInputs.customProject.unitsLeft,
        usps: quickInputs.customProject.usps,
      };
    }
    return fullProject
      ? {
          name: fullProject.name,
          locality: fullProject.locality ?? undefined,
          city: fullProject.city ?? undefined,
          price_range_lacs: fullProject.price_range_lacs ?? undefined,
          units_remaining: fullProject.units_remaining ?? undefined,
          usps: fullProject.usps ?? undefined,
          amenities: fullProject.amenities ?? undefined,
          rera_number: fullProject.rera_number ?? undefined,
        }
      : null;
  })();

  return (
    <div className="p-8 min-h-screen bg-surface">
      {/* Page header */}
      <div className="flex items-start justify-between mb-8 pb-6 border-b border-border">
        <div className="flex items-start gap-4">
          <div className="bg-brand-subtle p-3 rounded-xl">
            <Zap size={22} className="text-brand" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Strategy</h1>
            <p className="text-sm text-text-tertiary mt-1">
              Generate AI-powered campaign strategies and single ads
            </p>
          </div>
        </div>
        <Tabs
          options={[
            { value: 'quick', label: 'Quick Generate' },
            { value: 'full', label: 'Full Strategy' },
          ]}
          value={mode}
          onChange={(v) => switchMode(v as StrategyMode)}
          variant="pills"
        />
      </div>

      {!projectsLoading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-14 rounded-xl border-2 border-dashed border-border mb-6 text-center gap-3">
          <FolderKanban size={32} className="text-border-strong" />
          <p className="text-sm text-text-secondary">Add a project first to generate strategies.</p>
          <button
            onClick={() => navigate('projects')}
            className="px-4 py-2 rounded-lg bg-brand-subtle border border-brand-border text-sm text-brand-text hover:bg-brand-subtle-hover transition-all"
          >
            Go to Projects
          </button>
        </div>
      )}

      {mode === 'quick' && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-6">
          <QuickGenerateForm
            projects={projects}
            projectsLoading={projectsLoading}
            inputs={quickInputs}
            onChange={setQuickInputs}
            brandKitDefaultLanguages={brandKit?.default_languages}
          />
        </div>
      )}

      {/* Configuration selector — same blue form zone */}
      {mode === 'quick' && quickInputs.projectId && quickInputs.projectId !== 'custom' && (
        <Card className="p-5 mt-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-text-primary">Which configurations to advertise?</p>
              <p className="text-xs text-text-tertiary mt-0.5">Select configs and enter current market prices</p>
            </div>
            {fullProjectLoading && <Spinner size="sm" />}
          </div>

          {!fullProjectLoading && selectedConfigs.length === 0 && (
            <p className="text-xs text-text-tertiary">No configurations found. Edit the project to add them.</p>
          )}

          {!fullProjectLoading && selectedConfigs.length > 0 && (
            <div className="flex flex-col gap-3">
              {selectedConfigs.map((sc, idx) => (
                <div
                  key={idx}
                  className={[
                    'flex items-center gap-4 p-3 rounded-lg border transition-all',
                    sc.config.available
                      ? sc.checked
                        ? 'border-brand/30 bg-brand-subtle'
                        : 'border-border bg-surface'
                      : 'border-border bg-surface opacity-50',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => toggleConfig(idx)}
                    disabled={!sc.config.available}
                    className={[
                      'w-4 h-4 rounded border flex-shrink-0 transition-all',
                      sc.checked ? 'bg-brand border-brand' : 'border-border-strong bg-transparent',
                      !sc.config.available ? 'cursor-not-allowed' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    {sc.checked && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-sm" />
                      </div>
                    )}
                  </button>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span
                      className={`text-sm font-semibold ${sc.config.available ? 'text-text-primary' : 'text-text-disabled line-through'}`}
                    >
                      {sc.config.type}
                    </span>
                    {sc.config.carpet && (
                      <span className="text-xs text-text-tertiary">{sc.config.carpet}</span>
                    )}
                    {!sc.config.available && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger-subtle text-danger-text border border-danger-border">
                        Sold Out
                      </span>
                    )}
                    {sc.config.notes && (
                      <span className="text-xs text-warning-text italic">{sc.config.notes}</span>
                    )}
                  </div>
                  {sc.config.available && sc.checked && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <label className="text-xs text-text-tertiary">₹ Lacs</label>
                      <input
                        type="text"
                        value={sc.currentPrice}
                        onChange={(e) => updateConfigPrice(idx, e.target.value)}
                        className="w-20 bg-surface-elevated border border-border rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-brand transition-colors"
                        placeholder="62"
                      />
                      {sc.currentPrice !== sc.config.price_lacs && sc.currentPrice.trim() !== '' && (
                        <span className="text-[10px] text-warning-text flex items-center gap-1">
                          <AlertCircle size={10} /> was ₹{sc.config.price_lacs}L
                        </span>
                      )}
                    </div>
                  )}
                  {sc.config.available && !sc.checked && (
                    <span className="text-xs text-text-tertiary flex-shrink-0">₹{sc.config.price_lacs}L</span>
                  )}
                </div>
              ))}

              {priceChanged && (
                <div className="flex items-center gap-3 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setUpdatePricesInDb((v) => !v)}
                    className={`flex items-center gap-2 text-xs transition-all ${updatePricesInDb ? 'text-brand' : 'text-text-tertiary'}`}
                  >
                    <Database size={12} />
                    <span
                      className={[
                        'w-8 h-4 rounded-full border transition-all relative',
                        updatePricesInDb ? 'bg-brand/20 border-brand/40' : 'bg-border border-border',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute top-0.5 w-3 h-3 rounded-full transition-all',
                          updatePricesInDb ? 'left-4 bg-brand' : 'left-0.5 bg-border-strong',
                        ].join(' ')}
                      />
                    </span>
                    Update database with new prices after generation
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Per sqft toggle */}
      {mode === 'quick' && quickInputs.projectId && (
        <Card className="p-4 mt-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuickInputs((p) => ({ ...p, includePerSqft: !p.includePerSqft }))}
              className={`flex items-center gap-2 text-sm transition-all ${quickInputs.includePerSqft ? 'text-brand' : 'text-text-secondary'}`}
            >
              <span
                className={[
                  'w-8 h-4 rounded-full border transition-all relative flex-shrink-0',
                  quickInputs.includePerSqft ? 'bg-brand/20 border-brand/40' : 'bg-border border-border',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 w-3 h-3 rounded-full transition-all',
                    quickInputs.includePerSqft ? 'left-4 bg-brand' : 'left-0.5 bg-border-strong',
                  ].join(' ')}
                />
              </span>
              Include price per sq.ft in ad
            </button>
            {quickInputs.includePerSqft && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-tertiary">₹/sqft</label>
                <input
                  type="text"
                  value={quickInputs.perSqftRate}
                  onChange={(e) => setQuickInputs((p) => ({ ...p, perSqftRate: e.target.value }))}
                  className="w-24 bg-surface-elevated border border-border rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-brand transition-colors"
                  placeholder="e.g. 4800"
                />
              </div>
            )}
          </div>
        </Card>
      )}

      {mode === 'quick' && (
        <button
          onClick={handleQuickSubmit}
          disabled={submitting || geminiActive}
          className="mt-4 w-full py-3 rounded-lg bg-brand text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
          {submitting ? 'Crafting strategy…' : geminiActive ? 'Generating images…' : 'Quick Generate Ad'}
        </button>
      )}

      {/* Two-phase generation progress indicator */}
      {(submitting || geminiActive) && mode === 'quick' && (
        <div className="mt-3 bg-surface-elevated border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border ${submitting ? 'border-brand/40 bg-brand/10' : 'border-emerald-500/40 bg-emerald-500/10'}`}>
              {submitting
                ? <Loader2 size={12} className="animate-spin text-brand" />
                : <CheckCircle2 size={12} className="text-emerald-400" />}
            </div>
            <div>
              <p className={`text-xs font-medium ${submitting ? 'text-text-primary' : 'text-text-tertiary'}`}>
                {submitting ? 'Aanya is crafting your campaign strategy…' : 'Strategy ready'}
              </p>
              {submitting && <p className="text-[11px] text-text-tertiary mt-0.5">Writing headlines, ad copy, and image brief (10–20 s)</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border ${geminiActive ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-surface-sunken'}`}>
              {geminiActive
                ? <Loader2 size={12} className="animate-spin text-amber-400" />
                : <div className="w-2 h-2 rounded-full bg-border" />}
            </div>
            <p className={`text-xs font-medium ${geminiActive ? 'text-text-primary' : 'text-text-tertiary'}`}>
              {geminiActive ? 'Generating Feed + Story images with FLUX…' : 'Image generation — starts after strategy'}
            </p>
          </div>
        </div>
      )}

      {mode === 'full' && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-6">
          <FullStrategyForm
            projects={projects}
            projectsLoading={projectsLoading}
            inputs={fullInputs}
            onChange={setFullInputs}
            onSubmit={handleFullSubmit}
            submitting={submitting}
          />
        </div>
      )}

      {result && (
        <div ref={resultRef} className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-6">
          <StrategyResultPanel
            result={result}
            onRetry={mode === 'quick' ? handleQuickSubmit : handleFullSubmit}
            onSaveQuick={saveQuickCampaign}
            onSaveFull={saveFullCampaigns}
            quickProject={quickProjectForReview}
            onGeminiStateChange={setGeminiActive}
          />
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { AlertCircle, Database, FolderKanban, Zap } from 'lucide-react';
import { useChatbot } from '../contexts/ChatbotContext';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import { aiCall, isAiEnabled } from '../lib/ai-service';
import { logAiSession, logActivity } from '../lib/session-logger';
import { buildContext } from '../lib/context-builder';
import { useNavigation } from '../contexts/NavigationContext';
import { buildMetaQuickGeneratePrompt } from '../lib/meta-prompts';
import { buildQuickGenerateBrief } from '../lib/senior-designer-prompts';
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

function mapCampaignGoalFromInputs(
  inputs: QuickGenerateInputs
): 'lead_generation' | 'branding' | 'awareness' | 'festive_event' | 'engagement' | 'milestone' | 'educational' {
  const obj = (inputs.objective || '').toLowerCase();
  if (obj.includes('lead')) return 'lead_generation';
  if (obj.includes('brand')) return 'branding';
  if (obj.includes('aware')) return 'awareness';
  if (obj.includes('festiv') || obj.includes('event')) return 'festive_event';
  if (obj.includes('engag')) return 'engagement';
  if (obj.includes('milest')) return 'milestone';
  if (obj.includes('educ')) return 'educational';
  return 'lead_generation';
}

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
  referenceImage: null,
  competitorAnalysis: '',
  includePerSqft: false,
  perSqftRate: '',
  campaignGoal: 'lead_generation',
  languages: ['English'],
  quickRefs: [],
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
  const { navigate } = useNavigation();
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
  const [result, setResult] = useState<StrategyResult>(null);
  const { showToast } = useToast();
  const [brandKit, setBrandKit] = useState<{ default_languages?: string[] } | null>(null);

  useEffect(() => {
    supabase.from('brand_kits').select('default_languages').limit(1).maybeSingle()
      .then(({ data }) => { if (data) setBrandKit(data); });
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
      if (rows.length > 0) {
        setQuickInputs((prev) => ({ ...prev, projectId: rows[0].id }));
      }
      setProjectsLoading(false);
    }
    loadProjects();
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
        const configs = autoCreateConfigFromProject({ ...fp, is_active: true, created_at: '', updated_at: '', id: fp.id, org_id: null, code: null, per_sqft_rate: null, target_buyer: null, priority: null, budget_segment: null, landing_page_url: null, brochure_url: null, whatsapp_flow: null, notes: null });
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
    const updatedConfigs = (autoCreateConfigFromProject({ ...fullProject, is_active: true, created_at: '', updated_at: '', id: fullProject.id, org_id: null, code: null, per_sqft_rate: null, target_buyer: null, priority: null, budget_segment: null, landing_page_url: null, brochure_url: null, whatsapp_flow: null, notes: null })).map((cfg) => {
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
      showToast('Add Claude API key in Settings to enable AI.', 'info');
      setResult({
        type: 'quick',
        inputs: quickInputs,
        projectName,
        error: 'Add your Claude API key in Settings to enable AI generation.',
      });
      return;
    }

    const isMeta = quickInputs.adPlatform.toLowerCase().includes('meta');
    const isNanobanana = quickInputs.creativePlatform.toLowerCase().includes('nanobanana');

    // ── Senior Designer path (Nanobanana, non-Meta) ──────────────────────────
    if (isNanobanana && !isMeta) {
      setSubmitting(true);
      try {
        const funnel =
          quickInputs.campaignGoal === 'awareness' || quickInputs.campaignGoal === 'branding'
            ? 'TOFU'
            : quickInputs.campaignGoal === 'engagement'
            ? 'MOFU'
            : 'BOFU';

        const { systemPrompt, userPrompt } = await buildQuickGenerateBrief({
          user_brief: quickInputs.prompt,
          project_id: quickInputs.projectId !== 'custom' ? quickInputs.projectId : undefined,
          project_data:
            quickInputs.projectId === 'custom'
              ? {
                  name: quickInputs.customProject.name,
                  locality: quickInputs.customProject.locality,
                  city: quickInputs.customProject.city,
                  price_range_lacs: quickInputs.customProject.price,
                  units_remaining: parseInt(quickInputs.customProject.unitsLeft) || null,
                  usps: quickInputs.customProject.usps,
                  unit_types: quickInputs.customProject.type,
                }
              : undefined,
          campaign_goal: quickInputs.campaignGoal as Parameters<typeof buildQuickGenerateBrief>[0]['campaign_goal'],
          funnel_stage: funnel,
          placement: 'feed_square',
          languages: quickInputs.languages,
          quick_references: quickInputs.quickRefs,
          ad_platform: quickInputs.adPlatform as 'AiSensy' | 'Meta Ads Manager',
        });

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎨 AANYA DIAGNOSTIC — STARTING GENERATION');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎨 SYSTEM PROMPT (full):');
        console.log(systemPrompt);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎨 USER PROMPT (full):');
        console.log(userPrompt);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎨 BRAND KIT CHECK:');
        console.log('  - User prompt contains #1A3A5C (navy):', userPrompt.includes('#1A3A5C'));
        console.log('  - User prompt contains #C9A961 (gold):', userPrompt.includes('#C9A961'));
        console.log('  - User prompt contains #D4A574 (bronze):', userPrompt.includes('#D4A574'));
        console.log('  - User prompt contains "INVIOLABLE":', userPrompt.includes('INVIOLABLE') || systemPrompt.includes('INVIOLABLE'));
        console.log('  - User prompt contains "SECTION 1: SCENE NARRATIVE":', userPrompt.includes('SECTION 1: SCENE NARRATIVE'));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        const rawResponse = await aiCall(userPrompt, systemPrompt, 16000);

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
          platform_used: 'Nanobanana (Gemini)',
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
        });
        logActivity(supabase, {
          action: 'generated_strategy',
          entityType: 'ai_session',
          details: { mode: 'quick_senior', project: projectName },
        });

        if (updatePricesInDb) await savePriceUpdates();

        setResult({ type: 'quick_senior', inputs: quickInputs, projectName, aiData: parsed, savedId: saved?.id });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unexpected error';
        showToast('Generation failed. Check console.', 'error');
        console.error('[Senior Designer]', err);
        setResult({ type: 'quick_senior', inputs: quickInputs, projectName, error: msg });
      }
      setSubmitting(false);
      return;
    }

    // ── Legacy path (Meta, or non-Nanobanana platforms) ──────────────────────
    setSubmitting(true);

    const [context, verifiedKw] = await Promise.all([
      buildContext({ projectId: quickInputs.projectId !== 'custom' ? quickInputs.projectId : undefined }),
      loadVerifiedKeywords(quickInputs.adPlatform),
    ]);

    const verifiedSection = [
      verifiedKw.available.length > 0 ? `VERIFIED TARGETING (confirmed available in ${quickInputs.adPlatform}): ${verifiedKw.available.join(', ')}` : '',
      verifiedKw.notFound.length > 0 ? `NOT AVAILABLE (do NOT suggest these): ${verifiedKw.notFound.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    // Build project detail block
    let projBlock: string;
    let configsForPrompt: SelectedConfig[] = [];

    if (quickInputs.projectId === 'custom') {
      const cp = quickInputs.customProject;
      projBlock = [
        `Name: ${cp.name}`,
        `Location: ${cp.locality ? cp.locality + ', ' : ''}${cp.city}`,
        `Status: Not specified`,
        `CONFIGURATIONS BEING ADVERTISED:`,
        `  - Type: ${cp.type}, Price: ₹${cp.price}L, Units Available: ${cp.unitsLeft}`,
        `USPs: ${cp.usps || 'None listed'}`,
        `RERA: NOT AVAILABLE — DO NOT MENTION RERA IN ANY OUTPUT`,
      ].join('\n');
    } else {
      const fp = fullProject;
      const checkedConfigs = selectedConfigs.filter((sc) => sc.checked);
      configsForPrompt = checkedConfigs;

      const configLines = checkedConfigs.length > 0
        ? checkedConfigs.map((sc) => [
            `  - Type: ${sc.config.type}`,
            sc.config.carpet ? `    Carpet Area: ${sc.config.carpet}` : '',
            `    Current Price: ₹${sc.currentPrice || sc.config.price_lacs}L`,
            sc.config.remaining_units != null ? `    Units Available: ${sc.config.remaining_units}` : '',
            sc.config.notes ? `    Notes: ${sc.config.notes}` : '',
          ].filter(Boolean).join('\n')).join('\n')
        : `  - Type: ${fp?.unit_types || 'Not specified'}, Price: ₹${fp?.price_range_lacs || 'Not specified'}L`;

      projBlock = [
        `Name: ${fp?.name ?? projectName}`,
        `Location: ${fp?.locality ?? ''}, ${fp?.city ?? 'Bhubaneswar'}`,
        `Status: ${fp?.status ?? 'Not specified'}`,
        fp?.completion_pct != null ? `Completion: ${fp.completion_pct}%` : '',
        fp?.expected_possession ? `Possession: ${fp.expected_possession}` : '',
        fp?.nearest_landmarks ? `Landmarks: ${fp.nearest_landmarks}` : '',
        '',
        `CONFIGURATIONS BEING ADVERTISED (use ONLY these — do NOT mention any other types):`,
        configLines,
        '',
        `USPs: ${fp?.usps || 'None listed'}`,
        fp?.amenities ? `Amenities: ${fp.amenities}` : '',
        `RERA: ${fp?.rera_number || 'NOT AVAILABLE — DO NOT MENTION RERA IN ANY OUTPUT'}`,
      ].filter((l) => l !== undefined).join('\n');
    }

    const reraNote = fullProject?.rera_number || quickInputs.projectId === 'custom' ? '' : 'NOT AVAILABLE';
    const creativeConfigNote = configsForPrompt.length > 0
      ? configsForPrompt.map((sc) => `${sc.config.type} at ₹${sc.currentPrice || sc.config.price_lacs}L`).join(', ')
      : 'as specified above';

    let quickPrompt: string;

    if (isMeta) {
      const checkedConfigsForMeta = selectedConfigs
        .filter((sc) => sc.checked)
        .map((sc) => ({
          type: sc.config.type,
          price_lacs: sc.config.price_lacs,
          userPrice: sc.currentPrice,
          remaining_units: sc.config.remaining_units,
          notes: sc.config.notes,
          carpet: sc.config.carpet,
        }));

      const metaPrompt = buildMetaQuickGeneratePrompt({
        project: fullProject,
        configs: checkedConfigsForMeta.length > 0 ? checkedConfigsForMeta : [{ type: quickInputs.customProject.type, price_lacs: quickInputs.customProject.price, userPrice: quickInputs.customProject.price, remaining_units: quickInputs.customProject.unitsLeft }],
        perSqftEnabled: quickInputs.includePerSqft,
        perSqftValue: quickInputs.perSqftRate,
        description: quickInputs.prompt || 'Generate a high-converting lead gen ad.',
        objective: quickInputs.objective,
        competitorAnalysis: quickInputs.competitorAnalysis,
        verifiedTargeting: verifiedKw,
      });
      const metaFinalPrompt = context ? metaPrompt + '\n\n' + context : metaPrompt;

      // CALL 1 — Meta strategy/targeting (unchanged)
      const metaRes = await aiCall(metaFinalPrompt);
      if (metaRes.error) {
        showToast(String(metaRes.error), 'error');
        setResult({ type: 'quick', inputs: quickInputs, projectName, error: String(metaRes.error), isMeta });
        setSubmitting(false);
        return;
      }

      const metaParsed = (metaRes.raw ? (() => {
        const s = String(metaRes.raw);
        try { return JSON.parse(s); } catch { /* fallthrough */ }
        try { return JSON.parse(s.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); } catch { /* fallthrough */ }
        const st = s.indexOf('{'); const en = s.lastIndexOf('}');
        if (st !== -1 && en !== -1) return JSON.parse(s.substring(st, en + 1));
        return metaRes;
      })() : metaRes) as MetaAiResult;

      // CALL 2 — Aanya senior designer creative upgrade
      try {
        console.log('🎨 [AANYA-META] Calling Aanya for creative prompt upgrade...');

        const { systemPrompt: aanyaSystem, userPrompt: aanyaUser } = await buildQuickGenerateBrief({
          user_brief: quickInputs.prompt,
          project_id: quickInputs.projectId !== 'custom' ? quickInputs.projectId : undefined,
          project_data:
            quickInputs.projectId === 'custom'
              ? {
                  name: quickInputs.customProject.name,
                  locality: quickInputs.customProject.locality,
                  city: quickInputs.customProject.city,
                  price_range_lacs: quickInputs.customProject.price,
                  units_remaining: parseInt(quickInputs.customProject.unitsLeft) || null,
                  usps: quickInputs.customProject.usps,
                  unit_types: quickInputs.customProject.type,
                }
              : undefined,
          campaign_goal: mapCampaignGoalFromInputs(quickInputs),
          funnel_stage: 'BOFU',
          placement: 'feed_square',
          languages: quickInputs.languages,
          quick_references: quickInputs.quickRefs,
          ad_platform: 'Meta Ads Manager',
        });

        console.log('🎨 [AANYA-META] System prompt length:', aanyaSystem.length);
        console.log('🎨 [AANYA-META] User prompt brand check:', {
          has_1B4332: aanyaUser.includes('#1B4332'),
          has_2DD4A8: aanyaUser.includes('#2DD4A8'),
          has_INVIOLABLE: aanyaUser.includes('INVIOLABLE') || aanyaSystem.includes('INVIOLABLE'),
          has_SECTION_1: aanyaUser.includes('SECTION 1: SCENE NARRATIVE'),
        });

        const aanyaRes = await aiCall(aanyaUser, aanyaSystem, 16000);
        console.log('🎨 [AANYA-META] Response keys:', Object.keys(aanyaRes));

        let aanyaParsed: SeniorDesignerResult;
        if (aanyaRes.raw) {
          const s = String(aanyaRes.raw);
          console.log('🎨 [AANYA-META] Raw response first 500 chars:', s.substring(0, 500));
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
          metaParsed.creativePrompt = aanyaParsed.nanobanana_prompt_main;
        }
        if (aanyaParsed.nanobanana_prompt_story) {
          metaParsed.creativePromptStory = aanyaParsed.nanobanana_prompt_story;
        }
        metaParsed._aanyaBrief = aanyaParsed;

        console.log('✅ [AANYA-META] Creative prompts upgraded by Aanya');
      } catch (aanyaErr) {
        console.warn('⚠️ [AANYA-META] Aanya call failed, keeping Meta-generated prompts:', aanyaErr);
      }

      setResult({ type: 'quick', inputs: quickInputs, projectName, aiData: metaParsed, isMeta: true });
      logAiSession(supabase, {
        sessionType: 'quick_generate',
        projectIds: quickInputs.projectId && quickInputs.projectId !== 'custom' ? [quickInputs.projectId] : [],
        inputSummary: quickInputs.prompt || `Meta quick generate for ${projectName}`,
        inputData: { prompt: quickInputs.prompt, objective: quickInputs.objective, platform: quickInputs.adPlatform },
        outputData: metaParsed as Record<string, unknown>,
      });
      logActivity(supabase, {
        action: 'generated_strategy',
        entityType: 'ai_session',
        details: { mode: 'quick_meta', project: projectName },
      });
      if (updatePricesInDb) await savePriceUpdates();
      setSubmitting(false);
      return;
    } else {
      const creativePromptBase = `COMPLETE DETAILED prompt for ${quickInputs.creativePlatform} to generate 1080x1080 ad image. MANDATORY: Use ONLY the exact project data from the prompt — Project: ${fullProject?.name ?? quickInputs.customProject.name}, Location: ${fullProject?.locality ?? quickInputs.customProject.locality}, Configurations: ${creativeConfigNote}. Do NOT add RERA${reraNote ? ' (not provided)' : ''}. Do NOT invent unit types or amenities not listed. Include: visual style, color palette (#1B4332, #2DD4A8), text overlay with headline text, logo 'Neelachala Homes' top-left 80x80px, mood matching ${quickInputs.objective}, 1080x1080 dimensions.`;

      const creativePromptStoryBase = `COMPLETE DETAILED prompt for ${quickInputs.creativePlatform} to generate 1080x1920 story ad image. Same project data as above. Vertical composition, brand colors #1B4332 #2DD4A8, logo 'Neelachala Homes' top-left, CTA at bottom, 1080x1920 dimensions.`;

      const prompt = [
        'CRITICAL RULES — READ BEFORE GENERATING:',
        '1. Use ONLY the configurations listed below. If only 2BHK is listed, do NOT mention 3BHK or any other type.',
        '2. Use the exact prices given. Do NOT round or modify.',
        '3. If RERA says "NOT AVAILABLE", do NOT include RERA in any text or creative.',
        '4. If amenities are not listed, do NOT invent amenities.',
        '5. All ad copy, headlines, descriptions, and creative prompts must reflect ONLY this project data.',
        '',
        'Generate a SINGLE ready-to-deploy real estate ad. Write REAL content, not placeholders.',
        `USER REQUEST: ${quickInputs.prompt || 'Generate a high-converting ad.'}`,
        '',
        `PROJECT DETAILS — USE ONLY THESE EXACT VALUES:\n${projBlock}`,
        '',
        `OBJECTIVE: ${quickInputs.objective}`,
        `CREATIVE PLATFORM: ${quickInputs.creativePlatform}`,
        `AD PLATFORM: ${quickInputs.adPlatform}`,
        verifiedSection || '',
        quickInputs.competitorAnalysis ? `COMPETITOR INTELLIGENCE: ${quickInputs.competitorAnalysis}. Differentiate the ad.` : '',
        quickInputs.referenceImage ? 'REFERENCE IMAGE: User uploaded a reference image. Incorporate its style.' : '',
        quickInputs.includePerSqft && quickInputs.perSqftRate
          ? `INCLUDE PRICE PER SQ.FT in ad copy and creative: ₹${quickInputs.perSqftRate}/sqft. Mention in headline or primary text where relevant.`
          : 'DO NOT mention per sqft rate anywhere.',
        'CRITICAL: primaryText = actual 150-250 char ad copy with emojis. headline = actual max 25 chars.',
        `Respond in this EXACT JSON format:`,
        JSON.stringify({
          idea: 'concept in 1 sentence',
          campaignName: `NH-PROJ-BOFU-${new Date().toLocaleString('en-IN', { month: 'short', year: '2-digit' }).replace(' ', '').toUpperCase()}`,
          objective: quickInputs.objective,
          adType: 'CTWA',
          primaryText: 'ACTUAL AD COPY 150-250 chars with emojis',
          primaryTextOdia: 'Odia translation of primaryText',
          headline: 'ACTUAL HEADLINE max 25 chars',
          description: 'ACTUAL description 30 chars',
          callToAction: 'Send WhatsApp Message',
          locations: 'cities to target',
          ageRange: '30 to 50',
          gender: 'All',
          interests: 'comma-separated interest keywords',
          demographics: 'REAL Meta demographics: Job Titles, Education Level, Life Events',
          occupations: 'specific job titles: Software Engineer, Doctor, Business Owner',
          behaviors: 'targeting behaviors',
          placements: 'placements string',
          instagramPlacements: ['Feed', 'Stories', 'Reels'],
          facebookPlacements: ['Feed', 'Reels', 'Stories'],
          audienceExpansion: 'ON or OFF with reason',
          dailyBudget: '500',
          duration: '7',
          bidStrategy: 'Lowest cost',
          icebreakers: ['real icebreaker 1', 'real icebreaker 2', 'real icebreaker 3'],
          creativePrompt: creativePromptBase,
          creativePromptStory: creativePromptStoryBase,
          hashtags: ['15 real hashtags'],
          whatsappFlow: 'recommendation for WhatsApp flow',
          launchChecklist: ['step1', 'step2', 'step3'],
        }),
      ]
        .filter(Boolean)
        .join('\n\n');

      quickPrompt = context ? prompt + '\n\n' + context : prompt;
    }

    try {
      const res = await aiCall(quickPrompt);
      if (res.error) {
        showToast(String(res.error), 'error');
        setResult({ type: 'quick', inputs: quickInputs, projectName, error: String(res.error), isMeta });
      } else if (res.raw) {
        setResult({ type: 'quick', inputs: quickInputs, projectName, rawText: String(res.raw), isMeta });
      } else {
        setResult({ type: 'quick', inputs: quickInputs, projectName, aiData: res as QuickAiResult, isMeta });
        // Save price updates to DB if enabled
        if (updatePricesInDb) {
          await savePriceUpdates();
        }
        logAiSession(supabase, {
          sessionType: 'quick_generate',
          projectIds: quickInputs.projectId && quickInputs.projectId !== 'custom' ? [quickInputs.projectId] : [],
          inputSummary: quickInputs.prompt || `Quick generate for ${projectName}`,
          inputData: { prompt: quickInputs.prompt, objective: quickInputs.objective, platform: quickInputs.adPlatform },
          outputData: res,
        });
        logActivity(supabase, {
          action: 'generated_strategy',
          entityType: 'ai_session',
          details: { mode: 'quick', project: projectName },
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      showToast(msg, 'error');
      setResult({ type: 'quick', inputs: quickInputs, projectName, error: msg, isMeta });
    }

    setSubmitting(false);
  }

  async function handleFullSubmit() {
    if (!isAiEnabled()) {
      setResult({
        type: 'full',
        inputs: fullInputs,
        projects,
        error: 'Add your Claude API key in Settings to enable AI generation.',
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
      const res = await aiCall(fullPrompt);
      if (res.error) {
        setResult({ type: 'full', inputs: fullInputs, projects, error: String(res.error) });
      } else if (res.raw) {
        setResult({ type: 'full', inputs: fullInputs, projects, rawText: String(res.raw) });
      } else {
        setResult({ type: 'full', inputs: fullInputs, projects, aiData: res as FullAiResult });
        logAiSession(supabase, {
          sessionType: 'full_strategy',
          projectIds: fullInputs.selectedProjectIds,
          inputSummary: `Full strategy: ₹${fullInputs.monthlyBudget}/mo, ${fullInputs.leadsPerMonth} leads, ${selected.length} projects`,
          inputData: { monthlyBudget: fullInputs.monthlyBudget, leadsPerMonth: fullInputs.leadsPerMonth, scale: fullInputs.scale },
          outputData: res,
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
      created_by: 'dev-user-001',
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
      icebreakers: [], status: 'draft', source: 'full_strategy', created_by: 'dev-user-001',
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
        <QuickGenerateForm
          projects={projects}
          projectsLoading={projectsLoading}
          inputs={quickInputs}
          onChange={setQuickInputs}
          orgId={getOrgId()}
          brandKitDefaultLanguages={brandKit?.default_languages}
        />
      )}

      {/* Configuration selector */}
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
          disabled={submitting}
          className="mt-4 w-full py-3 rounded-lg bg-brand text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {submitting ? <Spinner size="sm" /> : <Zap size={15} />}
          {submitting ? 'Generating…' : 'Quick Generate Ad'}
        </button>
      )}

      {mode === 'full' && (
        <FullStrategyForm
          projects={projects}
          projectsLoading={projectsLoading}
          inputs={fullInputs}
          onChange={setFullInputs}
          onSubmit={handleFullSubmit}
          submitting={submitting}
        />
      )}

      <StrategyResultPanel
        result={result}
        onRetry={mode === 'quick' ? handleQuickSubmit : handleFullSubmit}
        onSaveQuick={saveQuickCampaign}
        onSaveFull={saveFullCampaigns}
        quickProject={quickProjectForReview}
      />
    </div>
  );
}

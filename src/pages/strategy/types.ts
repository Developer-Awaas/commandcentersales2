import type { GalleryImage } from '../../components/ImageGalleryViewer';

export interface StrategyProject {
  id: string;
  name: string;
  locality: string | null;
  city: string | null;
  units_remaining: number | null;
  price_range_lacs: string | null;
  usps: string | null;
  status: string | null;
  priority: string | null;
}

export interface QuickGenerateInputs {
  prompt: string;
  projectId: string;
  customProject: {
    name: string;
    locality: string;
    city: string;
    price: string;
    unitsLeft: string;
    type: string;
    usps: string;
  };
  objective: string;
  creativePlatform: string;
  adPlatform: string;
  competitorAnalysis: string;
  includePerSqft: boolean;
  perSqftRate: string;
  // Senior designer fields
  campaignGoal: string;
  languages: string[];
  quickRefs: { id: string; preview_url: string; base64: string; mimeType: string; user_intent: string; role_hint?: string; filename?: string; visual_description?: string }[];
  // IDs of project_assets rows the user ticked to ground this specific generation in —
  // see ProjectMediaPicker. Resolved to vision-described references at submit time.
  projectMediaIds: string[];
  // Hero reference image feature: matches a project_assets id (from
  // projectMediaIds) or a quickRefs[].id. When set, that photo's real pixels
  // are edited in-place (composition preserved) instead of only described in
  // text — see buildHeroEditPrompt() in senior-designer-prompts.ts.
  heroRefKey: string | null;
  // Replicate text-overlay mode (beta, opt-in): when true AND a replicate_creative
  // ref is set, the model renders a clean template (buildReplicateLayoutPrompt) and
  // the app composites legible copy per vision-located zones (RB-P0 STEP 3), instead
  // of the model baking (often garbled) text. Parallel to the default baked path.
  textOverlayMode?: boolean;
}

export interface FullStrategyInputs {
  monthlyBudget: number;
  leadsPerMonth: number;
  svsPerMonth: number;
  bookingsPerMonth: number;
  scale: string;
  enableOdia: boolean;
  selectedProjectIds: string[];
  includePerSqft: boolean;
  perSqftRate: string;
}

export type StrategyMode = 'quick' | 'full';

export interface QuickAiResult {
  idea?: string;
  campaignName?: string;
  objective?: string;
  adType?: string;
  primaryText?: string;
  primaryTextOdia?: string;
  headline?: string;
  description?: string;
  callToAction?: string;
  locations?: string;
  ageRange?: string;
  gender?: string;
  interests?: string;
  demographics?: string;
  occupations?: string;
  behaviors?: string;
  placements?: string;
  instagramPlacements?: string[];
  facebookPlacements?: string[];
  audienceExpansion?: string;
  dailyBudget?: string;
  duration?: string;
  bidStrategy?: string;
  icebreakers?: string[];
  creativePrompt?: string;
  creativePromptStory?: string;
  hashtags?: string[];
  whatsappFlow?: string;
  launchChecklist?: string[];
  _aanyaBrief?: SeniorDesignerResult;
}

export interface FullAiCampaign {
  project?: string;
  funnelStage?: string;
  objective?: string;
  audience?: string;
  placements?: string;
  budget?: string;
  creativeFormat?: string;
  interests?: string;
  demographics?: string;
  occupations?: string;
  educationLevel?: string;
  lifeEvents?: string;
  behaviors?: string;
  [key: string]: unknown;
}

export interface FullAiResult {
  overview?: string;
  budgetAdvice?: string;
  campaigns?: FullAiCampaign[];
  creativePrompt?: string;
  creativePromptStory?: string;
  _aanyaBrief?: SeniorDesignerResult;
}

export interface MetaAdvantageRec {
  recommendation: string;
  reasoning: string;
}

export interface MetaAiResult {
  idea?: string;
  campaign?: {
    objective?: string;
    advantagePlusCampaign?: MetaAdvantageRec;
    campaignName?: string;
    specialAdCategory?: string;
    budgetStrategy?: string;
    dailyBudget?: string;
    bidStrategy?: string;
    campaignSpendingLimit?: string;
    abTest?: string;
  };
  adSet?: {
    conversionLocation?: string;
    facebookPage?: string;
    performanceGoal?: string;
    costPerResultGoal?: string;
    dynamicCreative?: string;
    schedule?: { startDate?: string; endDate?: string; customSchedule?: string };
    advantagePlusAudience?: MetaAdvantageRec;
    audience?: {
      locations?: string;
      ageRange?: string;
      gender?: string;
      languages?: string;
      detailedTargeting?: {
        interests?: string[];
        demographics?: string[];
        behaviors?: string[];
      };
      customAudiences?: string;
      audienceExpansion?: string;
    };
    policyRequirements?: string;
    advantagePlusPlacements?: MetaAdvantageRec;
    manualPlacementsIfDisabled?: {
      facebook?: string[];
      instagram?: string[];
      excludedPlatforms?: string[];
    };
  };
  ad?: {
    identity?: { facebookPage?: string; instagramAccount?: string };
    partnershipAd?: string;
    format?: string;
    multiAdvertiserAds?: string;
    destination?: string;
    instantFormStrategy?: string;
    primaryText?: string;
    headline?: string;
    description?: string;
    qualityFilters?: { smsVerification?: string; workEmail?: string };
    automatedLeadDelivery?: string;
    trackingPixelEvents?: string;
    utmParameters?: string;
  };
  creativePrompt?: string;
  creativePromptStory?: string;
  icebreakers?: string[];
  advantagePlusSummary?: string;
  launchChecklist?: string[];
  _aanyaBrief?: SeniorDesignerResult;
}

export interface SeniorDesignerResult {
  creative_concept?: string;
  designer_rationale?: string;
  nanobanana_prompt_main?: string;        // GRAPHIC_DESIGN_FRAME — 1:1 feed
  nanobanana_prompt_portrait?: string;    // PHOTOREALISTIC_SCENE — 4:5 portrait feed
  nanobanana_prompt_story?: string;       // TYPOGRAPHY_FORWARD — 9:16 story/reel
  reference_image_manifest?: { role: string; instruction: string; [key: string]: unknown }[];
  ad_copy?: Record<string, string>;
  post_production_notes?: string;
  design_dna_tags?: Record<string, unknown>;
  [key: string]: unknown;
}

export type StrategyResult =
  | {
      type: 'quick';
      inputs: QuickGenerateInputs;
      projectName: string;
      isMeta?: boolean;
      aiData?: QuickAiResult | MetaAiResult | null;
      rawText?: string;
      error?: string;
    }
  | {
      type: 'quick_senior';
      inputs: QuickGenerateInputs;
      projectName: string;
      aiData?: SeniorDesignerResult | null;
      savedId?: string;
      error?: string;
      // Populated only when this result was reconstructed from the DB after
      // a Canva OAuth cold-start's full-page round-trip wiped React state —
      // see the resume effect in Strategy.tsx. Lets SeniorDesignerResultPanel
      // skip its normal auto-generate-on-mount and show what already exists.
      resumedGalleryImages?: GalleryImage[];
      // Hero reference image feature: resolved at submit time in
      // handleQuickSubmit (first entry = hero, rest = supporting amenity
      // photos). Present only when inputs.heroRefKey was set. Consumed by
      // StrategyResult.tsx's handleGenerateWithGemini to switch all 3 image
      // slots to edit-mode instead of from-scratch generation.
      heroImages?: import('../../lib/gemini-service').HeroImageRef[];
      // Replicate-an-ad-creative mode: set when a quick-ref was marked
      // 'replicate_creative' and the project has a hero. StrategyResult then
      // generates ONE image at this aspect (the reference creative's own
      // aspect) using buildReplicatePrompt + the hero-image edit wire.
      replicateAspect?: '1:1' | '4:5' | '9:16';
      // Replicate text-overlay mode (RB-P0 STEP 3): when set, StrategyResult
      // generates a clean template and composites copy per these vision-located
      // zones instead of baking text into the image.
      textOverlayMode?: boolean;
      zones?: import('../../lib/reference-style').ReferenceZone[];
    }
  | {
      type: 'full';
      inputs: FullStrategyInputs;
      projects: StrategyProject[];
      aiData?: FullAiResult | null;
      rawText?: string;
      error?: string;
    }
  | null;

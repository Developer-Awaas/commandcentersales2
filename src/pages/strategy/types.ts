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
  referenceImage: File | null;
  competitorAnalysis: string;
  includePerSqft: boolean;
  perSqftRate: string;
  // Senior designer fields
  campaignGoal: string;
  languages: string[];
  quickRefs: { url: string; user_intent: string; role_hint?: string; filename?: string }[];
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
  nanobanana_prompt_main?: string;
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

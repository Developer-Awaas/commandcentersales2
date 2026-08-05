// Canned AI fixtures for VITE_MOCK_AI=true (see feature-flags.ts). Every
// field name here mirrors a real field some consumer actually reads —
// verified against Strategy.tsx, CampaignWizard.tsx (StepStrategy/
// StepCreatives), and SMMCreatives.tsx before writing this file. One
// superset object is returned for every mocked aiCall regardless of which
// stage/traceName triggered it: simpler than replicating each multi-stage
// contract exactly, and every consumer already falls back gracefully
// (`??`/`?.`) on fields it doesn't recognize, so extra keys are harmless.

// ─── Strategy / Campaign Wizard (legacy single-call + Aanya senior-designer
// fields combined into one object) ──────────────────────────────────────────
export const MOCK_STRATEGY_JSON = {
  // Legacy single-call shape (CampaignWizard StepStrategy, Strategy full-strategy)
  idea: 'Mock: price-anchored launch offer for a 2BHK project',
  campaignName: 'MOCK-CAMPAIGN-2026',
  primaryText: '[MOCK] Your dream 2BHK starts at ₹49L. Limited launch-price units — book your site visit today. 📍 Prime location | ✅ RERA registered',
  primaryTextOdia: '[MOCK ଓଡ଼ିଆ] ୨ବିଏଚକେ ଆରମ୍ଭ ₹୪୯ଲକ୍ଷରୁ।',
  headline: '[MOCK] 2BHK from ₹49L',
  description: '[MOCK] Launch price, limited units',
  callToAction: 'Get Price Breakup',
  locations: 'Bhubaneswar, Cuttack, Puri',
  ageRange: '28 to 50',
  interests: 'Real estate, Home ownership, Family living',
  dailyBudget: '500',
  duration: '14',
  icebreakers: ['[MOCK] Tell me more about pricing', '[MOCK] Is a site visit available this weekend?'],
  launchChecklist: ['[MOCK] Confirm RERA number', '[MOCK] Verify floor plan PDF', '[MOCK] Set daily budget cap'],

  // Aanya senior-designer / SeniorDesignerResult shape (CampaignWizard
  // StepCreatives per-variant call, Strategy's full-strategy Aanya sub-stage)
  creative_concept: '[MOCK] Price-led urgency creative for launch-phase 2BHK buyers',
  designer_rationale: '[MOCK] Price anchoring resonates with affordability-first, comparison-shopping buyers at this funnel stage.',
  ad_copy: {
    headline_english: '[MOCK] 2BHK Starts at ₹49L',
    headline_odia: '[MOCK ଓଡ଼ିଆ] ୨ବିଏଚକେ',
    primary_text_english: '[MOCK] Your dream home in Bhubaneswar is closer than you think. New 2BHK apartments starting at ₹49 Lakhs.',
    primary_text_odia: '[MOCK ଓଡ଼ିଆ] ଆପଣଙ୍କ ସ୍ୱପ୍ନର ଘର।',
    subhead_english: '[MOCK] Limited units at launch price',
    cta: 'Get Price Breakup',
  },
  nanobanana_prompt_main: '[MOCK PROMPT] A modern 2BHK apartment exterior at golden hour, warm lighting, navy and gold color palette, professional real estate photography style. 1080x1080.',
  nanobanana_prompt_portrait: '[MOCK PROMPT] Same scene, 4:5 portrait crop, feature callouts in lower third.',
  nanobanana_prompt_story: '[MOCK PROMPT] Vertical 9:16 story format, typography-forward, price anchor headline top third.',
  reference_image_manifest: [] as Array<{ role: string; instruction: string }>,
  platform_used: 'Nanobanana (Gemini)',

  // A small "visual_anchor" so any downstream stage-2-style prompt builder
  // that reads it (Strategy's two-stage flow) gets a stable, real string.
  visual_anchor: '[MOCK] A single-tower mid-rise apartment building, cream stucco facade with navy accent bands, rooftop garden visible, landscaped entrance with a water feature.',
};

// ─── Ad Creatives (1 real placeholder image) ────────────────────────────────
// A 1x1 gray PNG — real image bytes, small on purpose. The point of this
// fixture is to exercise the REAL upload/DB-insert/display/edit path with an
// actual Storage object, not to look good. Callers that need a specific
// aspect ratio just get this same 1x1 back; downstream <img> rendering
// stretches it, which is fine for a mock.
export const MOCK_CREATIVE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
export const MOCK_CREATIVE_IMAGE_MIME_TYPE = 'image/png';

// ─── SMM Creatives (buildSMMCreativePrompt's expected shape, smm-prompts.ts) ─
export const MOCK_SMM_CREATIVE_JSON = {
  concept: '[MOCK] Launch-week awareness post',
  captionEn: '[MOCK] ✨ New 2BHK homes launching this week in Bhubaneswar! Starting ₹49L. DM us for a site visit. #RealEstate #Bhubaneswar',
  captionOd: '[MOCK ଓଡ଼ିଆ] ✨ ଏହି ସପ୍ତାହରେ ନୂଆ ୨ବିଏଚକେ ଘର!',
  hashtags: ['#Bhubaneswar', '#RealEstate', '#2BHK', '#NewLaunch', '#HomeBuying'],
  bestTime: '7:00 PM IST',
  bestPlatform: 'instagram',
  postType: 'static',
  nanoPrompt: '[MOCK PROMPT] Social post 1080x1080, modern apartment exterior, brand colors #1B4332 #2DD4A8, headline overlay "New Launch — 2BHK from ₹49L", logo bottom-left.',
  nanoPromptStory: '[MOCK PROMPT] Same concept, 1080x1920 story crop, headline top third.',
  carouselSlides: ['[MOCK] Slide 1: Exterior', '[MOCK] Slide 2: Floor plan', '[MOCK] Slide 3: Amenities'],
  reelScript: '[MOCK] 0-3s: Drone shot of exterior. 3-8s: Interior walkthrough. 8-12s: Price + CTA card.',
};

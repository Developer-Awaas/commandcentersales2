// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMetaQuickGeneratePrompt(data: any): string {
  const { project, configs, perSqftEnabled, perSqftValue, description, objective, competitorAnalysis, verifiedTargeting } = data;

  const configsBeingAdvertised = configs.map((c: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
    `${c.type} (₹${c.userPrice || c.price_lacs}L, ${c.remaining_units || '?'} units${c.notes ? ', ' + c.notes : ''})`
  ).join(', ');

  return `Generate Meta Ads Manager campaign for Indian real estate. STRICT: use ONLY provided project data, never invent.

PROJECT: ${project?.name || 'Custom'}
LOCATION: ${project?.locality || project?.city || 'Bhubaneswar'}, ${project?.city || 'Bhubaneswar'}
STATUS: ${project?.status || 'Active'}, ${project?.completion_pct || '?'}% complete
POSSESSION: ${project?.expected_possession || 'Not specified'}
LANDMARKS: ${project?.nearest_landmarks || 'None'}

CONFIGURATIONS BEING ADVERTISED (use ONLY these): ${configsBeingAdvertised}
${perSqftEnabled && perSqftValue ? `PRICE PER SQFT: ₹${perSqftValue}/sqft - INCLUDE in headline/copy` : 'DO NOT mention price per sqft'}

USPS: ${project?.usps || 'None'}
AMENITIES: ${project?.amenities || 'None'}
RERA: ${project?.rera_number || 'NOT AVAILABLE - DO NOT MENTION RERA'}
TARGET BUYER: ${project?.target_buyer || 'End-user'}
BUDGET SEGMENT: ${project?.budget_segment || 'Mid'}

USER REQUEST: ${description}
OBJECTIVE: ${objective}
${competitorAnalysis ? `COMPETITORS: ${competitorAnalysis}` : ''}

${verifiedTargeting?.available?.length ? `VERIFIED AVAILABLE on Meta: ${verifiedTargeting.available.join(', ')}` : ''}
${verifiedTargeting?.notFound?.length ? `NOT AVAILABLE (do NOT suggest): ${verifiedTargeting.notFound.join(', ')}` : ''}

ADVANTAGE+ LOGIC FOR REAL ESTATE (Indian market):
- Campaign-level Advantage+: ON only if 2+ projects in one campaign or budget > ₹500/day. OFF for single project / small budget.
- Audience-level Advantage+: OFF for real estate. Geographic precision and lead quality matter more than reach. Indian real estate buyers are location-locked.
- Placements-level Advantage+: ON, BUT exclude Audience Network (junk leads from third-party apps).

Return JSON in EXACTLY this structure for Meta Ads Manager 3-level hierarchy:

{
  "idea": "one-line ad concept",
  "campaign": {
    "objective": "Leads",
    "advantagePlusCampaign": {"recommendation": "ON or OFF", "reasoning": "why for THIS specific campaign"},
    "campaignName": "NH-PROJECT-OBJECTIVE-MMMYY format",
    "specialAdCategory": "Housing (India compliance for real estate)",
    "budgetStrategy": "Campaign Budget (Advantage+) or Ad Set Budget",
    "dailyBudget": "₹X (recommended based on objective + market)",
    "bidStrategy": "Highest Volume (recommended for new) or Cost Per Result Goal",
    "campaignSpendingLimit": "₹X or None",
    "abTest": "OFF (recommended for first run)"
  },
  "adSet": {
    "conversionLocation": "Instant Forms (recommended for CTWA-style direct lead capture) or Website or Messenger",
    "facebookPage": "Neelachala Homes & Commercials Pvt Ltd",
    "performanceGoal": "Maximise number of leads",
    "costPerResultGoal": "None for first run",
    "dynamicCreative": "OFF",
    "schedule": {"startDate": "today", "endDate": "today + 14 days", "customSchedule": "OFF"},
    "advantagePlusAudience": {"recommendation": "OFF", "reasoning": "Real estate needs geographic precision + lead quality > reach"},
    "audience": {
      "locations": "Bhubaneswar (25km radius) + Cuttack — exact cities for THIS project",
      "ageRange": "30 to 50",
      "gender": "ALL",
      "languages": "English, Hindi, Odia",
      "detailedTargeting": {
        "interests": ["5-7 REAL Meta interests verified for Indian real estate"],
        "demographics": ["job titles, education, life events for THIS budget segment"],
        "behaviors": ["Engaged Shoppers, etc."]
      },
      "customAudiences": "None for first run",
      "audienceExpansion": "OFF"
    },
    "policyRequirements": "Tick 'This ad set includes ads related to housing' if applicable - REQUIRED for Indian housing ads",
    "advantagePlusPlacements": {"recommendation": "ON with Audience Network excluded", "reasoning": "FB/IG quality good, Audience Network = junk for real estate"},
    "manualPlacementsIfDisabled": {
      "facebook": ["Feed", "Reels", "Stories"],
      "instagram": ["Feed", "Stories", "Reels"],
      "excludedPlatforms": ["Audience Network", "Messenger"]
    }
  },
  "ad": {
    "identity": {"facebookPage": "Neelachala Homes & Commercials Pvt Ltd", "instagramAccount": "@_neelachalahomes_"},
    "partnershipAd": "OFF",
    "format": "Single image (recommended) or Carousel for multiple configs",
    "multiAdvertiserAds": "ON (default)",
    "destination": "Instant form or Website or WhatsApp",
    "instantFormStrategy": "Create new form: NH-FORM-PROJECTNAME-DATE OR use existing relevant form",
    "primaryText": "150-180 char ad copy with hook, project benefits, CTA. Indian English, mix of emojis. Use ONLY actual project data.",
    "headline": "max 27 chars catchy headline using actual project + price",
    "description": "max 27 chars supporting text",
    "qualityFilters": {"smsVerification": "ON (recommended for serious leads)", "workEmail": "OFF"},
    "automatedLeadDelivery": "Google Sheets recommended for first run, CRM later",
    "trackingPixelEvents": "ON (Lead, ViewContent, Contact)",
    "utmParameters": "utm_source=meta&utm_medium=cpc&utm_campaign=PROJECTNAME-MMMYY"
  },
  "creativePrompt": "Detailed Nanobanana/AI prompt for 1080x1080. Use ONLY actual project data: ${project?.name}, ${project?.locality}, configs being advertised. Brand colors #1B4332 #2DD4A8. Logo Neelachala Homes top-left 80px. Do NOT mention RERA if not provided. Do NOT add unstated amenities.",
  "creativePromptStory": "Same for 1080x1920 story format",
  "icebreakers": ["3-4 short user reply suggestions IF using WhatsApp destination, otherwise empty array"],
  "advantagePlusSummary": "2-3 sentence explanation of WHY these Advantage+ recommendations for THIS campaign specifically — campaign vs audience vs placements",
  "launchChecklist": ["8-10 step launch checklist specific to Meta Ads Manager"]
}`;
}

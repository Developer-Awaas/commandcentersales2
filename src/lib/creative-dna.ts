// src/lib/creative-dna.ts
// PURPOSE: Extracts full visual DNA from any creative image via Vision API.
// Stores design_dna in creatives table. Generates pattern reports for admin.

import { getOrgId, getUserId } from './constants';

// ============================================================
// CREATIVE DNA EXTRACTION PROMPT
// Used every time a creative is analyzed in Ad Review
// ============================================================
export function buildCreativeDNAPrompt(projectDetails: string, platform: string) {
  return `Analyze this ad creative image in extreme detail. Extract EVERY visual design element.

PROJECT CONTEXT: ${projectDetails}
PLATFORM: ${platform}

Return JSON with this EXACT structure — fill every field with real values from the image:
{
  "designDNA": {
    "typography": {
      "style": "serif or sans-serif or script or display or mixed",
      "weight": "light or regular or bold or extra-bold",
      "sizeHierarchy": "describe: headline Xpx approx, subtext Xpx, body Xpx",
      "textColors": ["#hex1", "#hex2"],
      "textPosition": "top or center or bottom or overlay or scattered",
      "textAlignment": "left or center or right",
      "readabilityScore": 7,
      "fontCount": 2,
      "hasTextShadow": false,
      "hasTextBackground": false
    },
    "colors": {
      "primary": "#hex",
      "secondary": "#hex",
      "accent": "#hex",
      "allColors": ["#hex1", "#hex2", "#hex3", "#hex4"],
      "bgType": "solid or gradient or image or pattern or blurred-image",
      "bgColor": "#hex or description",
      "gradientDirection": "top-to-bottom or left-to-right or radial or none",
      "contrastRatio": "high or medium or low",
      "mood": "warm or cool or neutral or vibrant or muted or dark or pastel",
      "saturation": "high or medium or low",
      "dominantTone": "description like dark green with gold accents"
    },
    "layout": {
      "orientation": "portrait or landscape or square",
      "aspectRatio": "1:1 or 4:5 or 9:16 or 16:9",
      "gridStructure": "single-focus or split-vertical or split-horizontal or thirds or quadrant or asymmetric",
      "visualHierarchy": "image-first or text-first or balanced or cta-first",
      "whiteSpaceRatio": "percentage estimate like 25%",
      "elementCount": 6,
      "hasVisualLayers": true,
      "depthEffect": "flat or layered or 3d or shadow-depth",
      "borderOrFrame": "none or thin-border or thick-border or decorative-frame or rounded",
      "logoPosition": "top-left or top-right or bottom-left or bottom-right or center or none",
      "logoSize": "percentage like 8%"
    },
    "contentElements": {
      "hasPropertyImage": true,
      "propertyImageType": "exterior or interior or aerial or floor-plan or render or none",
      "hasHumanImage": false,
      "humanImageType": "family or individual or couple or lifestyle or none",
      "hasIllustration": false,
      "hasIcon": false,
      "hasPriceDisplay": true,
      "priceFormat": "₹XX Lacs or ₹XX onwards or EMI ₹XX or none",
      "hasCtaButton": true,
      "ctaButtonColor": "#hex or none",
      "ctaButtonText": "text or none",
      "hasRera": false,
      "hasContact": true,
      "contactType": "phone or whatsapp-icon or website or qr-code",
      "hasProjectName": true,
      "projectNameProminence": "large-headline or medium or small-subtitle",
      "hasLocation": true,
      "hasOfferBadge": false,
      "offerType": "discount or limited-time or free-upgrade or none",
      "hasCompanyLogo": true,
      "hasWatermark": false,
      "hasSocialHandles": false,
      "totalTextElements": 5,
      "totalImageElements": 2
    },
    "aesthetics": {
      "style": "minimal or information-dense or luxury or corporate or playful or traditional or modern or premium",
      "mood": "premium or urgent or trustworthy or aspirational or festive or calm or bold or professional",
      "imageQuality": "low or medium or high or professional or stock-photo",
      "overallPolish": 8,
      "visualComplexity": "simple or moderate or complex",
      "brandConsistency": "strong or moderate or weak or no-brand",
      "platformFit": "feed-optimized or story-optimized or both or neither",
      "thumbnailReadability": "good or moderate or poor",
      "mobileReadability": "good or moderate or poor"
    },
    "messaging": {
      "angle": "price or lifestyle or scarcity or investment or trust or location or amenities or possession or EMI or comparison",
      "emotionalTrigger": "FOMO or aspiration or security or status or family or achievement or belonging or urgency",
      "ctaType": "direct or soft or question or offer or urgency",
      "ctaStrength": "strong or medium or weak or absent",
      "language": "english or odia or hindi or bilingual or trilingual",
      "infoDensity": "low or medium or high",
      "keyMessage": "the single main message this ad communicates",
      "uniqueSellingPoint": "what makes this ad different from generic real estate ads"
    }
  },
  "overallScore": 7,
  "verdict": "one line summary",
  "strengths": ["specific strength with design reference"],
  "issues": [{"area": "Typography or Color or Layout or Content or CTA or Branding or Compliance", "severity": "Critical or Major or Minor", "issue": "specific problem referencing design elements", "fix": "exact fix with specific design values"}],
  "layoutReview": {"score": 7, "fixes": ["specific fix"]},
  "colorReview": {"score": 7, "fixes": ["specific fix"]},
  "typographyReview": {"score": 7, "fixes": ["specific fix"]},
  "contentReview": {"score": 7, "fixes": ["specific fix"]},
  "ctaReview": {"score": 7, "fixes": ["specific fix"]},
  "complianceCheck": {"reraVisible": true, "logoVisible": true, "pricingClear": true, "issues": ["issue"]},
  "platformFit": {"ig_feed": "Good or Needs work", "ig_story": "Good or Needs work", "fb_feed": "Good or Needs work", "notes": "analysis"},
  "audienceMatch": "analysis of whether design matches target audience",
  "followUpPrompt": "COMPLETE revised prompt incorporating ALL fixes for 1080x1080",
  "followUpPromptStory": "Same for 1080x1920"
}`;
}

// ============================================================
// SAVE CREATIVE DNA TO DATABASE
// ============================================================
export async function saveCreativeDNA(supabase: any, creativeId: string, dnaData: any) {
  if (!creativeId || !dnaData?.designDNA) return;

  const { error } = await supabase
    .from('creatives')
    .update({
      design_dna: dnaData.designDNA,
      review_score: dnaData.overallScore || null,
      review_data: dnaData,
    })
    .eq('id', creativeId);

  if (error) console.error('Failed to save creative DNA:', error);
}

// ============================================================
// SAVE NEW CREATIVE WITH DNA (when uploaded for review without existing record)
// ============================================================
export async function createCreativeWithDNA(supabase: any, data: {
  projectId?: string;
  platformUsed?: string;
  dnaData: any;
}) {
  const { data: inserted, error } = await supabase
    .from('creatives')
    .insert({
      org_id: getOrgId(),
      project_id: data.projectId || null,
      platform_used: data.platformUsed || 'unknown',
      design_dna: data.dnaData.designDNA || {},
      review_score: data.dnaData.overallScore || null,
      review_data: data.dnaData,
      follow_up_prompt: data.dnaData.followUpPrompt || '',
      status: 'draft',
      created_by: getUserId(),
    })
    .select('id')
    .single();

  if (error) console.error('Failed to create creative with DNA:', error);
  return inserted;
}

// ============================================================
// GENERATE PATTERN REPORT (Admin only)
// Analyzes all creatives with DNA for a project/segment and finds patterns
// ============================================================
export function buildPatternAnalysisPrompt(creativesData: any[]) {
  const summary = creativesData.map((c, i) => {
    const dna = c.design_dna || {};
    const perf = c.performance_data || {};
    return `Creative ${i + 1}: Score ${c.review_score || '?'}/10, CTR ${perf.ctr || c.ctr || '?'}%, CPL Rs ${perf.cpl || c.cpl || '?'}. ` +
      `Style: ${dna.aesthetics?.style || '?'}, Mood: ${dna.aesthetics?.mood || '?'}, ` +
      `Colors: ${dna.colors?.mood || '?'} (${dna.colors?.primary || '?'}), ` +
      `Font: ${dna.typography?.style || '?'} ${dna.typography?.weight || '?'}, ` +
      `Layout: ${dna.layout?.gridStructure || '?'}, Angle: ${dna.messaging?.angle || '?'}, ` +
      `Trigger: ${dna.messaging?.emotionalTrigger || '?'}, ` +
      `Elements: property=${dna.contentElements?.hasPropertyImage}, lifestyle=${dna.contentElements?.hasHumanImage}, price=${dna.contentElements?.hasPriceDisplay}`;
  }).join('\n');

  return `Analyze these ${creativesData.length} ad creatives and find performance patterns. Identify which design DNA attributes correlate with better CTR and lower CPL.

CREATIVE DATA:
${summary}

Return JSON:
{
  "sampleSize": ${creativesData.length},
  "topPerformingDNA": {
    "typography": "what font styles work best",
    "colors": "what color moods work best", 
    "layout": "what layouts work best",
    "contentElements": "what elements must be present",
    "aesthetics": "what style works best",
    "messaging": "what angles and triggers work best"
  },
  "worstPerformingDNA": {
    "typography": "what to avoid",
    "colors": "what to avoid",
    "layout": "what to avoid",
    "contentElements": "what doesn't work",
    "aesthetics": "what style to avoid",
    "messaging": "what angles fail"
  },
  "correlations": [
    {"attribute": "specific DNA attribute like colors.mood=warm", "metric": "ctr or cpl", "impact": "+1.8x or -22%", "confidence": "high or medium or low", "explanation": "why this works"}
  ],
  "recommendations": [
    "Specific actionable recommendation for future creatives"
  ],
  "idealCreativeBrief": "A complete description of the ideal creative for this segment based on all patterns found. Include specific colors (hex), font style, layout, elements, mood, angle.",
  "idealNanoPrompt": "A complete Nanobanana prompt that would generate the ideal creative based on patterns found"
}`;
}

// ============================================================
// GET CREATIVE DNA FOR CONTEXT INJECTION
// Used when generating new creatives — AI learns from past DNA
// ============================================================
export async function getCreativeDNAContext(supabase: any, projectId?: string) {
  let query = supabase
    .from('creatives')
    .select('design_dna, review_score, ctr, cpl, angle, format')
    .neq('design_dna', '{}')
    .order('created_at', { ascending: false })
    .limit(10);

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data } = await query;
  if (!data || data.length === 0) return '';

  const lines = ['CREATIVE DNA HISTORY (learn from past designs):'];
  data.forEach((c: any, i: number) => {
    const dna = c.design_dna || {};
    lines.push(
      `  ${i + 1}. Score: ${c.review_score || '?'}/10, CTR: ${c.ctr || '?'}%, CPL: Rs ${c.cpl || '?'}. ` +
      `Style: ${dna.aesthetics?.style || '?'}, Colors: ${dna.colors?.mood || '?'}, ` +
      `Font: ${dna.typography?.style || '?'}, Angle: ${dna.messaging?.angle || '?'}, ` +
      `Polish: ${dna.aesthetics?.overallPolish || '?'}/10`
    );
  });

  lines.push('');
  lines.push('Use these patterns: replicate high-scoring DNA attributes, avoid low-scoring ones.');
  return lines.join('\n');
}
// src/lib/senior-designer-prompts.ts
// PURPOSE: Master creative prompt builder applying the Senior Creative Designer skill.
// REPLACES the basic creative generation in: Quick Generate, Full Strategy creatives,
// Ad Creatives module, Ad Review follow-up, SMM Creatives, Campaign Wizard creative step.
//
// All these flows now route through buildSeniorDesignerCreativePrompt().

import { supabase } from './supabase';
import { getOrgId } from './constants';

// ============================================================
// TYPES
// ============================================================

export interface CreativeBriefInput {
  // Required
  campaign_goal: 'lead_generation' | 'branding' | 'awareness' | 'festive_event' | 'engagement' | 'milestone' | 'educational';
  funnel_stage: 'TOFU' | 'MOFU' | 'BOFU' | 'all';
  placement: 'feed_square' | 'story_reel' | 'feed_portrait' | 'fb_landscape' | 'whatsapp_status';

  // Project (required for project-led creative)
  project_id?: string;
  project_data?: ProjectData; // pre-loaded project data, optional

  // Strategic inputs
  user_brief: string; // free text from user describing what they want
  languages: string[]; // ['English', 'Odia'] etc

  // Optional
  ad_platform?: 'AiSensy' | 'Meta Ads Manager';
  creative_platform?: string; // 'Nanobanana (Gemini)', 'Midjourney', etc
  variant_label?: 'A' | 'B' | 'C'; // for multi-variant generation
  variant_angle?: string; // 'price_led' | 'lifestyle_led' etc

  // Reference images
  brand_kit?: BrandKit;
  project_assets?: ProjectAsset[];
  quick_references?: QuickReference[]; // ad-hoc uploads

  // Design DNA (learned from past performance)
  design_dna?: ProjectDesignSystem;

  // Festival / event context (if applicable)
  festival_or_event?: {
    name: string;
    date: string;
    cultural_context: string;
  };
}

export interface ProjectData {
  name: string;
  code: string;
  locality: string;
  city: string;
  status: string;
  configurations: any[];
  price_range: string;
  total_units: number;
  units_remaining: number;
  usps: string;
  amenities: string;
  target_buyer: string;
  rera_number?: string;
  notes?: string;
  completion_pct?: number;
}

export interface BrandKit {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  text_color: string;
  background_color: string;
  primary_font: string;
  secondary_font: string;
  display_font: string;
  tagline: string;
  brand_voice: string;
  brand_story?: string;
  logo_color_url?: string;
  logo_white_url?: string;
  logo_dark_url?: string;
  design_aesthetic: 'premium_minimal' | 'luxury_opulent' | 'warm_aspirational' | 'contemporary_urban' | 'custom';
  cultural_motifs: string[];
  reference_brands: string[];
}

export interface ProjectAsset {
  id: string;
  asset_type: string;
  asset_url: string;
  title?: string;
  description?: string;
  is_primary?: boolean;
}

export interface QuickReference {
  url?: string;         // optional — no longer required; files are stored as base64 in memory
  user_intent: string;
  role_hint?: string;
  visual_description?: string; // Claude Vision analysis — injected into Aanya's brief
}

export interface ProjectDesignSystem {
  best_performing_angles: any[];
  best_performing_compositions: any[];
  best_performing_color_treatments: any[];
  best_performing_copy_angles: any[];
  underperforming_patterns: any[];
  total_creatives_analyzed: number;
  confidence_level: 'insufficient' | 'low' | 'medium' | 'high' | 'very_high';
  dna_summary?: string;
}

// ============================================================
// THE SENIOR DESIGNER SYSTEM PROMPT
// ============================================================

export const AANYA_SYSTEM_PROMPT = `You are Aanya Mehta, Senior Creative Director at FCB India / L&K Saatchi alumni. 12 years designing campaigns for Lodha, DLF Camellias, Sobha, Damac, Emaar Beachfront, Mahindra Lifespaces. Three Goafest Golds, two Spikes Asia metals, one Cannes Lions Bronze.

YOUR DESIGN PHILOSOPHY:
1. Every creative element must have intent — no decoration for decoration's sake
2. Color is psychology, not aesthetics — choose hex codes for behavioral effect
3. Composition guides the eye in a specific reading order
4. Typography is hierarchy — viewers know what to read first within 0.4 seconds
5. White space is a design element, not absence of one
6. Real estate creative is aspiration — buyers buy a future self
7. Every creative is built around ONE primary message
8. The CTA feels inevitable, not pushy

INVIOLABLE RULES — violating any is grounds for total disqualification:

RULE 1 — BRAND KIT COMPLIANCE (CRITICAL): You use ONLY the hex codes provided in the BRAND IDENTITY section of each brief. You NEVER invent colors. You NEVER substitute thematically (forest green for "zen", red for "urgency", teal for "calm"). If the brief gives you #1A3A5C navy, #C9A961 gold, #D4A574 bronze — those are the ONLY colors permitted in Section 5 AND Section 6 of your output. A senior designer at Lodha or Sobha would be fired for inventing brand colors. So would you.

MANDATORY BRAND KIT → SECTION 6 COLOR MAPPING (apply to every text element):
- Headline main words: Color = brand_kit.text_color (exact hex)
- Headline accent/script word: Color = brand_kit.accent_color (exact hex)
- PRICE_BADGE text: Color = brand_kit.text_color; Badge background = brand_kit.primary_color; Badge border = brand_kit.accent_color
- PHOTO_CAPTION_BAR background = brand_kit.primary_color; text = #FFFFFF
- FEATURE_CHECKLIST text = brand_kit.text_color; ✓ icon = brand_kit.accent_color
- CTA_BUTTON background = brand_kit.accent_color; label text = brand_kit.primary_color
- FOOTER_STRIP background = brand_kit.accent_color; text = brand_kit.primary_color
- INFO_BOX background = brand_kit.primary_color; text = brand_kit.text_color
Every Color field in Section 6 MUST be a hex code copied verbatim from BRAND IDENTITY. Writing "gold" or "navy" or "white" instead of the hex code is a critical error.

RULE 2 — NINE-SECTION STRUCTURE: Every nanobanana_prompt_main contains exactly nine labeled sections, in order, with these exact headers verbatim:
SECTION 1: SCENE NARRATIVE
SECTION 2: SUBJECT & COMPOSITION
SECTION 3: CAMERA & LENS
SECTION 4: LIGHTING
SECTION 5: COLOR PALETTE
SECTION 6: TYPOGRAPHY LAYER
SECTION 7: BRAND & PROJECT ELEMENTS
SECTION 8: NEGATIVE PROMPTS
SECTION 9: TECHNICAL SPECS

Skipping, merging, or relabeling sections is failure.

RULE 3 — NARRATIVE NOT KEYWORDS: Section 1 is 2-3 sentences of cinematic prose like a film director writing a shot description. NOT comma-separated. NOT bullets. Pure narrative paragraph. Detailed narrative paragraphs produce dramatically better output from GPT-Image-1 than keyword lists.

RULE 4 — PHOTOGRAPHIC TERMINOLOGY: Section 3 names a specific lens (24mm wide-angle, 35mm prime, 50mm natural, 85mm portrait, 100mm macro), specific shot type (architectural, three-quarter, low-angle, aerial), and optionally camera body. Generic phrases like "good shot" are forbidden.

RULE 5 — LIGHTING WITH INTENT: Section 4 names time, color temperature in Kelvin, and shadow direction. Example: "Golden hour backlighting at 06:45 IST, warm 3200K, long soft shadows extending east-to-west."

RULE 6 — TYPOGRAPHY LAYER (RENDER IN IMAGE): Section 6 specifies each text element as TEXT ELEMENT 1, TEXT ELEMENT 2, etc. with Content, Font, Size, Color, Position, and Treatment. The image model MUST render these text elements exactly as specified, integrated into the composition. Include graphical containers (colored panels, borders, badges) as needed to frame text zones.

RECOGNIZED TEXT ELEMENT TYPES (name the type in the element header):
- MIXED_WEIGHT_HEADLINE: word-level font switching within one headline line (e.g., "READY" ultra-bold condensed + "to" italic gold script + "MOVE" ultra-bold condensed). Specify font and color per word-group.
- PRICE_BADGE: standalone large price callout with its own box and border at headline visual weight. NOT buried inside an info bar with other items. Size: 24–34pt. Specify box dimensions, border color.
- PHOTO_CAPTION_BAR: text bar anchored to the bottom edge of a specific photo card (label with "ANCHORED TO PHOTO PANEL N"). Full width of that photo card. Dark fill, white text, all-caps bold.
- FEATURE_CHECKLIST: 2×N column grid of short amenity lines, each preceded by a ✓ checkmark icon. Specify: icon color, text size, number of columns, item list, position zone. Required for lead-generation creatives.
- FOOTER_STRIP: full-width horizontal bar at the very bottom of the frame (y:91–100%). Phone number (left-aligned) and website URL (right-aligned) inside it. Required for lead-generation creatives — this is the Indian RE contact disclosure standard.
- INFO_BOX: horizontal bar with multiple pipe-separated items (price | RERA | status). Use only when items are too numerous for a PRICE_BADGE.
- CTA_BUTTON: pill or wide-rectangle button. Specify exact width percentage.

RULE 7 — THREE DISTINCT LAYOUT PARADIGMS: Every brief produces three visually distinct prompts — never three versions of the same layout at different sizes.

nanobanana_prompt_main — GRAPHIC_DESIGN_FRAME: Full-bleed dark background (navy or deep brand color) fills 100% of canvas. Building photos placed as framed photo cards with white borders and gold corner-bracket accents. Structured info zones stacked top-to-bottom: headline → dual photo panels → feature checklist → CTA → footer contact strip. MIXED_WEIGHT_HEADLINE required. PRICE_BADGE overlapping one photo card. FEATURE_CHECKLIST (2×2 grid) below photos. FOOTER_STRIP at very bottom. Decorative geometry (hatched-stripe circles, corner bracket lines) adds depth to the flat background. This is the professional Indian real estate ad standard — Neelachala Homes / Lodha India / DLF India style. Maximum information density. Aspect ratio 1:1.

nanobanana_prompt_portrait — PHOTOREALISTIC_SCENE: Single cinematic hero building photograph with real sky and landscape depth. Text as overlaid elements placed in natural negative-space zones (sky area, foreground). Premium minimal feel matching Sobha / DLF Camellias aesthetic. No dark background fill — the photo IS the background. Aspect ratio 4:5 (1024×1536). 400–600 words.

nanobanana_prompt_story — TYPOGRAPHY_FORWARD: Bold statement headline occupies 35–45% of the frame. Building photo is secondary — a framed inset card (30–40% of frame) or blurred background. Three or four text elements maximum. High-contrast type treatment, vertical-native layout for Stories / Reels — sized for mobile thumb-stop scrolling. Feels like a poster, not a real estate brochure. Aspect ratio 9:16 (1024×1792). 400–600 words.

RULE 8 — INDIAN CURRENCY ONLY (CRITICAL): Every price value rendered as text in Section 6 MUST use Indian currency format. Use ₹ symbol (e.g., "₹57 Lakhs", "₹1.18 Cr*", "Starting ₹95 Lakhs") or "Rs." prefix. NEVER render $, USD, Dollars, EUR, or any non-Indian currency symbol. The market is India — a $ symbol on a Bhubaneswar real estate ad is disqualifying. If the brief gives a price like "57 lakhs", you render "₹57 Lakhs". Always.

RULE 9 — SUBSTITUTE ALL PLACEHOLDERS: The reference examples contain placeholder values: "NAYAPALLI, BBSR", "RS 57 LAKHS", "THE ZENITH", "+91-XXXXXXXXXX", "www.brand.com", "ONLY 8", "HOMES LEFT". You MUST replace EVERY placeholder with the real value from the CAMPAIGN CONTEXT section of this brief. Using a placeholder from the reference example verbatim in your output is a critical failure.

You always respond ONLY in valid JSON. No markdown fences, no preamble. Just the JSON object.`;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getAspectRatio(placement: string): string {
  const map: Record<string, string> = {
    'feed_square': '1:1 (1080x1080)',
    'story_reel': '9:16 (1080x1920)',
    'feed_portrait': '4:5 (1080x1350)',
    'fb_landscape': '16:9 (1200x628)',
    'whatsapp_status': '9:16 (1080x1920)',
  };
  return map[placement] || '1:1 (1080x1080)';
}

function getAestheticDirection(aesthetic: string): string {
  const directions: Record<string, string> = {
    premium_minimal: `PREMIUM MINIMAL — Heavy whitespace (40%+ of frame). Sans-serif typography only. 1-2 colors maximum from palette. Photo-driven hero. Magazine-spread feel. Reference brands: Sobha, DLF Camellias, Phoenix Mills. Default lighting: editorial overcast diffused daylight. Default lens: 35mm prime.`,
    luxury_opulent: `LUXURY OPULENT — Gold/bronze/deep navy backgrounds. Serif typography (Playfair Display, Cormorant Garamond). Dramatic chiaroscuro lighting. Reference brands: Lodha Altamount, Damac Hills, Bukhatir. Default lighting: magic hour twilight or three-point softbox. Default lens: 85mm portrait.`,
    warm_aspirational: `WARM ASPIRATIONAL — Earth tones (terracotta, ochre, cream). Mix of serif headlines + sans-serif body. Real residents/families in lifestyle moments. Story-driven. Reference brands: Mahindra Lifespaces, Brigade, Tata Housing. Default lighting: golden hour. Default lens: 50mm natural perspective.`,
    contemporary_urban: `CONTEMPORARY URBAN — Bold geometric color blocking. Modern sans-serif (Inter, Söhne). Architectural photography emphasis. Strong grid layouts. Reference brands: Godrej Trees, Emaar Beachfront, Oberoi 360 West. Default lighting: crisp daylight or dramatic night architectural. Default lens: 24mm wide-angle.`,
    custom: `CUSTOM — Apply the brand's specific aesthetic as defined in brand voice and reference brands. Use judgment.`
  };
  return directions[aesthetic] || directions.premium_minimal;
}

function getGoalStrategy(goal: string, _funnel: string): string {
  const strategies: Record<string, string> = {
    lead_generation: `LEAD GENERATION (BOFU)
- Hero: The product itself (building, key amenity, or clear price/offer)
- Composition: 60% visual / 40% information density
- High-contrast CTA element required
- Copy hierarchy: Price/offer → headline → CTA
- Mandatory: Price point, RERA, clear CTA button, urgency cue (only if real)
- Default angle types: Price-led, urgency-led (units left), location-led (proximity), amenity-led`,

    branding: `BRANDING (TOFU/MOFU)
- Hero: Lifestyle moment, brand symbol, or aspirational scene
- Composition: 80% visual / 20% information density
- Color: Brand palette restraint — 2 colors max
- Copy hierarchy: Tagline/brand statement → company name (small)
- Mandatory: Logo, tagline. NO direct sell elements.
- Default angle types: Trust-led, legacy-led, vision-led, craftsmanship-led`,

    awareness: `AWARENESS (TOFU)
- Hero: Bold statement, single striking visual, or curiosity-driven imagery
- Composition: Editorial / minimalist
- Color: One bold accent color against neutral
- Copy hierarchy: Big idea statement → small attribution
- Default angle types: Pattern-interrupt, contrarian, educational, emotional`,

    festive_event: `FESTIVE / EVENT
- Hero: Festival motif blended with brand asset, OR event-specific imagery
- Composition: Celebratory but elegant — never gaudy
- Color: Festival colors integrated WITH brand palette (not replacing it)
- Copy hierarchy: Festival greeting → brand wish → optional offer
- Default angle types: Cultural homage, blessing-led, family-celebration`,

    engagement: `ENGAGEMENT (SMM)
- Hero: Interactive prompt visual (poll, this-or-that, fill-in-blank)
- Composition: Built FOR engagement — visual question structure
- Color: High-contrast for tap-target visibility
- Copy hierarchy: Question/prompt → choices → engagement CTA`,

    milestone: `MILESTONE
- Hero: Achievement marker (units sold, years, customers)
- Composition: Celebratory typography-led
- Mandatory: Specific number/data point, brand attribution
- Tone: Proud but humble`,

    educational: `EDUCATIONAL
- Hero: Information visual (infographic, tip card, comparison)
- Composition: Carousel-friendly, scannable
- Color: Neutral with single accent for emphasis
- Copy hierarchy: Question/topic → key insight → expand prompt`
  };
  return strategies[goal] || strategies.lead_generation;
}

function formatDesignDNA(dna: ProjectDesignSystem): string {
  if (dna.confidence_level === 'insufficient' || dna.total_creatives_analyzed < 3) {
    return `DESIGN DNA: No prior performance data yet (${dna.total_creatives_analyzed} creatives analyzed). Apply standard real estate creative best practices for the chosen aesthetic. This creative will contribute to building the project's design DNA.`;
  }

  let dnaBlock = `DESIGN DNA — Learned from ${dna.total_creatives_analyzed} past creatives (confidence: ${dna.confidence_level})\n`;

  if (dna.dna_summary) {
    dnaBlock += `\nSUMMARY: ${dna.dna_summary}\n`;
  }

  if (dna.best_performing_angles?.length > 0) {
    dnaBlock += `\nTOP ANGLES (use as preference):\n`;
    dna.best_performing_angles.slice(0, 3).forEach((a: any) => {
      dnaBlock += `  - ${a.angle}: avg CPL ₹${a.avg_cpl}, CTR ${a.avg_ctr}%, sample ${a.sample_size}\n`;
    });
  }

  if (dna.best_performing_compositions?.length > 0) {
    dnaBlock += `\nTOP COMPOSITIONS:\n`;
    dna.best_performing_compositions.slice(0, 3).forEach((c: any) => {
      dnaBlock += `  - ${c.composition} (avg CPL ₹${c.avg_cpl})\n`;
    });
  }

  if (dna.underperforming_patterns?.length > 0) {
    dnaBlock += `\nAVOID — patterns that underperformed:\n`;
    dna.underperforming_patterns.slice(0, 3).forEach((p: any) => {
      dnaBlock += `  - ${p.pattern}: avg CPL ₹${p.avg_cpl} (${p.verdict})\n`;
    });
  }

  dnaBlock += `\nUse this DNA as a SOFT preference. If the campaign goal differs from the DNA's strongest pattern, prioritize the goal but inform with DNA learnings.`;

  return dnaBlock;
}

function buildReferenceManifest(input: CreativeBriefInput): { manifest: string[], count: number } {
  const refs: string[] = [];
  let imgIndex = 1;

  // 1. Brand logo (color version preferred)
  if (input.brand_kit?.logo_color_url) {
    refs.push(`Image ${imgIndex} [BRAND_LOGO_COLOR]: Place this exact logo in the top-left corner at 8% of frame width. Preserve color, proportions, and clear-space margins. Do not redraw, recolor, or stylize.`);
    imgIndex++;
  }
  if (input.brand_kit?.logo_white_url) {
    refs.push(`Image ${imgIndex} [BRAND_LOGO_WHITE]: White-version logo for use over dark areas. Use this version if the background in the logo zone is darker than 50% gray.`);
    imgIndex++;
  }

  // 2. Project assets (smart selection by goal)
  if (input.project_assets && input.project_assets.length > 0) {
    const heroAsset = input.project_assets.find(a => a.asset_type === 'hero_exterior' && a.is_primary) ||
                      input.project_assets.find(a => a.asset_type === 'hero_exterior');

    if (heroAsset) {
      refs.push(`Image ${imgIndex} [PROJECT_HERO]: Use this exact building as the architectural subject. Preserve all facade details, balcony patterns, color, and proportions. Do not invent new architectural elements. ${heroAsset.description ? `Context: ${heroAsset.description}` : ''}`);
      imgIndex++;
    }

    const projectLogo = input.project_assets.find(a => a.asset_type === 'project_logo');
    if (projectLogo) {
      refs.push(`Image ${imgIndex} [PROJECT_LOGO]: Project lockup. Position below or beside the brand logo at 60% of brand logo size. Preserve exactly.`);
      imgIndex++;
    }

    // Goal-specific asset selection
    if (input.campaign_goal === 'lead_generation' || input.campaign_goal === 'branding') {
      const interior = input.project_assets.find(a => a.asset_type.startsWith('interior_'));
      if (interior && imgIndex <= 12) {
        refs.push(`Image ${imgIndex} [PROJECT_INTERIOR]: Reference this interior style. Match the lighting quality, material palette, and overall mood. Use as a small inset card or background element.`);
        imgIndex++;
      }

      const amenities = input.project_assets.filter(a => a.asset_type.startsWith('amenity_')).slice(0, 2);
      amenities.forEach(am => {
        if (imgIndex <= 12) {
          refs.push(`Image ${imgIndex} [${am.asset_type.toUpperCase()}]: Amenity reference. Show as a subtle inset (10-15% of frame) only if the composition needs amenity proof.`);
          imgIndex++;
        }
      });
    }

    const lifestyle = input.project_assets.find(a => a.asset_type.startsWith('lifestyle_'));
    if (lifestyle && imgIndex <= 12) {
      refs.push(`Image ${imgIndex} [LIFESTYLE_MOOD]: Use the MOOD, COLOR PALETTE, and LIGHTING of this image as inspiration. Do NOT copy any specific person, face, or composition element. Inspiration only.`);
      imgIndex++;
    }
  }

  // 3. Quick references (ad-hoc uploads with user-stated intent)
  if (input.quick_references && input.quick_references.length > 0) {
    input.quick_references.forEach(ref => {
      if (imgIndex <= 14) {
        if (ref.visual_description) {
          // Claude Vision analysed this image — give FLUX a rich visual brief
          refs.push(`Image ${imgIndex} [USER_QUICK_REF — ${(ref.role_hint ?? 'reference').replace(/_/g, ' ')}]: User uploaded for: "${ref.user_intent}". VISUAL ANALYSIS: ${ref.visual_description}`);
        } else {
          refs.push(`Image ${imgIndex} [USER_QUICK_REF]: User uploaded for: "${ref.user_intent}". ${ref.role_hint || 'Use as visual reference for the stated purpose.'}`);
        }
        imgIndex++;
      }
    });
  }

  // 4. Cultural motifs (if specified in brand kit)
  if (input.brand_kit?.cultural_motifs && input.brand_kit.cultural_motifs.length > 0) {
    const motifInstruction = `Cultural motifs to integrate subtly: ${input.brand_kit.cultural_motifs.join(', ')}. Use as borders, watermarks (5-10% opacity), or background patterns. Never make them dominant — they should feel like authentic cultural grounding, not decoration.`;
    refs.push(`Cultural motif instruction (text-only, no reference image): ${motifInstruction}`);
  }

  return { manifest: refs, count: imgIndex - 1 };
}

function formatLanguages(languages: string[]): string {
  if (languages.length === 1) {
    return `Single language: ${languages[0]}. Render all text in ${languages[0]} only.`;
  }

  const primary = languages[0];
  const secondary = languages.slice(1);

  let output = `Multilingual: PRIMARY = ${primary}, SECONDARY = ${secondary.join(', ')}.\n`;
  output += `LAYOUT RULES:\n`;
  output += `- Primary (${primary}): larger size, primary visual position\n`;
  output += `- Secondary languages: 60-70% size of primary, positioned below or beside\n\n`;
  output += `FONT/SCRIPT NOTES:\n`;

  languages.forEach(lang => {
    const fontMap: Record<string, string> = {
      'English': 'Geometric sans-serif (Inter, Söhne, Neue Haas Grotesk)',
      'Odia': 'Lohit Odia or Noto Sans Oriya — clean readable Odia script (ଓଡ଼ିଆ)',
      'Hindi': 'Mukta or Noto Sans Devanagari — readable Devanagari script (हिन्दी)',
      'Bengali': 'Noto Sans Bengali — readable Bengali script (বাংলা)',
    };
    output += `  - ${lang}: ${fontMap[lang] || 'Use language-appropriate clean readable script'}\n`;
  });

  output += `\nCRITICAL FOR NON-LATIN SCRIPTS:\n`;
  output += `If text rendering quality in any non-Latin script is uncertain, leave a clearly marked text placeholder zone of the correct dimensions with the language label (e.g., "[ODIA TEXT HERE]"). The designer will overlay correct text in post-production. NEVER render garbled or broken non-Latin script.`;

  return output;
}

// ============================================================
// MAIN PROMPT BUILDER — APPLIES THE SENIOR DESIGNER SKILL
// ============================================================

export async function buildSeniorDesignerCreativePrompt(input: CreativeBriefInput): Promise<{
  systemPrompt: string;
  userPrompt: string;
  referenceImageCount: number;
  expectedOutputSchema: any;
}> {
  // Load missing context if not provided
  let brandKit = input.brand_kit;
  let projectAssets = input.project_assets;
  let designDNA = input.design_dna;
  let projectData = input.project_data;

  if (!brandKit && supabase) {
    const { data } = await supabase.from('brand_kits').select('*').eq('org_id', getOrgId()).maybeSingle();
    brandKit = data || undefined;
  }

  if (input.project_id && !projectAssets && supabase) {
    const { data } = await supabase.from('project_assets')
      .select('*')
      .eq('project_id', input.project_id)
      .eq('org_id', getOrgId())
      .order('display_order');
    projectAssets = data || [];
  }

  if (input.project_id && !designDNA && supabase) {
    const { data } = await supabase.from('project_design_systems')
      .select('*')
      .eq('project_id', input.project_id)
      .maybeSingle();
    designDNA = data || undefined;
  }

  if (input.project_id && !projectData && supabase) {
    const { data } = await supabase.from('projects')
      .select('*')
      .eq('id', input.project_id)
      .maybeSingle();
    projectData = data || undefined;
  }

  // Build reference manifest
  const enrichedInput = { ...input, brand_kit: brandKit, project_assets: projectAssets, design_dna: designDNA, project_data: projectData };
  const { manifest, count } = buildReferenceManifest(enrichedInput);

  // Determine aesthetic
  const aesthetic = brandKit?.design_aesthetic || 'premium_minimal';
  const aestheticDirection = getAestheticDirection(aesthetic);

  // Determine strategy
  const strategy = getGoalStrategy(input.campaign_goal, input.funnel_stage);

  // Format DNA
  const dnaBlock = designDNA ? formatDesignDNA(designDNA) : 'DESIGN DNA: No prior data — first creative for this project. Apply senior-designer best practices.';

  // Format languages
  const languageBlock = formatLanguages(input.languages);

  // Build aspect ratio
  const aspectRatio = getAspectRatio(input.placement);

  // ASSEMBLE THE BRIEF
  const userPrompt = `# CREATIVE BRIEF — for Aanya Mehta, Senior Creative Director

## 1. CAMPAIGN CONTEXT
${projectData ? `
PROJECT: ${projectData.name}
- Code: ${projectData.code || 'N/A'}
- Locality: ${projectData.locality}, ${projectData.city}
- Status: ${projectData.status}${projectData.completion_pct ? ` (${projectData.completion_pct}% complete)` : ''}
- Configurations: ${JSON.stringify(projectData.configurations || (projectData as any).unitTypes || 'See notes')}
- Price Range: ${projectData.price_range}
- Total Units / Remaining: ${projectData.total_units || 'N/A'} / ${projectData.units_remaining || 'N/A'}
- USPs: ${projectData.usps}
- Target Buyer: ${projectData.target_buyer}
${projectData.rera_number ? `- RERA: ${projectData.rera_number} (MUST appear in creative)` : '- RERA: Not provided (omit from creative)'}
${projectData.notes ? `- Notes: ${projectData.notes}` : ''}
` : 'PROJECT: Generic brand creative (no specific project)'}

CAMPAIGN GOAL: ${input.campaign_goal.toUpperCase()}
FUNNEL STAGE: ${input.funnel_stage}
PLACEMENT: ${input.placement} → Aspect Ratio: ${aspectRatio}
${input.ad_platform ? `AD PLATFORM: ${input.ad_platform}` : ''}
${input.variant_label ? `VARIANT: ${input.variant_label} (angle: ${input.variant_angle || 'designer choice'})` : ''}
${input.festival_or_event ? `FESTIVAL/EVENT: ${input.festival_or_event.name} on ${input.festival_or_event.date}\nCultural context: ${input.festival_or_event.cultural_context}` : ''}

USER BRIEF (verbatim from user):
"${input.user_brief}"

## 2. BRAND IDENTITY
${brandKit ? `
- Aesthetic Mode: ${aesthetic}
- Primary Color: ${brandKit.primary_color}
- Secondary Color: ${brandKit.secondary_color}
- Accent Color: ${brandKit.accent_color}
- Text Color: ${brandKit.text_color}
- Background: ${brandKit.background_color}
- Primary Font: ${brandKit.primary_font}
- Secondary Font: ${brandKit.secondary_font}
- Display Font: ${brandKit.display_font}
- Tagline: "${brandKit.tagline}"
- Brand Voice: ${brandKit.brand_voice}
${brandKit.brand_story ? `- Brand Story: ${brandKit.brand_story}` : ''}
- Reference Brands (visual inspiration): ${brandKit.reference_brands?.join(', ') || 'N/A'}
- Cultural Motifs: ${brandKit.cultural_motifs?.join(', ') || 'None'}
` : `BRAND KIT: Not configured — use these Indian real estate defaults:
- Primary Color: #1A3A5C (deep navy)
- Secondary Color: #0F2744 (darker navy)
- Accent Color: #C9A961 (warm gold)
- Text Color: #FFFFFF (white — for text ON dark backgrounds)
- Background: #1A3A5C
- Primary Font: Inter Bold
- Display Font: Bebas Neue
Apply these hex codes in Section 5 AND Section 6 exactly as specified in RULE 1 mapping above. All prices: ₹ symbol.`}

## 3. AESTHETIC DIRECTION
${aestheticDirection}

## 4. STRATEGIC DIRECTION (for this goal)
${strategy}

## 5. DESIGN DNA (learned from past performance)
${dnaBlock}

## 6. REFERENCE IMAGES (${count} provided)
${manifest.length > 0 ? manifest.join('\n') : 'No reference images provided — generate from text only. Be extra-detailed in the scene narrative to compensate.'}

## 7. LANGUAGE LAYERS
${languageBlock}

---

## YOUR TASK

Produce a GPT-Image-1 image generation prompt for ${aspectRatio}.

CRITICAL CHECK — COLORS: Look at BRAND IDENTITY above. Copy the exact hex codes. Every Color field in every TEXT ELEMENT in Section 6 of all three prompts must be a hex code from that list — no exceptions. Writing "gold" or "navy" or "white" instead of the hex is wrong.

CRITICAL CHECK — CURRENCY: Scan every TEXT ELEMENT Content field in Section 6 for any price value. Every price MUST show ₹ (e.g., "₹57 Lakhs", "₹1.18 Cr*"). If you see $ or USD anywhere — fix it before outputting.

CRITICAL CHECK — SUBSTITUTION: The reference examples use "NAYAPALLI, BBSR", "RS 57 LAKHS", "+91-XXXXXXXXXX", "www.brand.com" as placeholders. Replace ALL of them with real values from CAMPAIGN CONTEXT. If a value isn't in the brief, omit that element — never output a placeholder.

CRITICAL CHECK — FORMAT: Your nanobanana_prompt_main MUST literally contain these nine section headers, in order, each on its own line: SECTION 1: SCENE NARRATIVE / SECTION 2: SUBJECT & COMPOSITION / SECTION 3: CAMERA & LENS / SECTION 4: LIGHTING / SECTION 5: COLOR PALETTE / SECTION 6: TYPOGRAPHY LAYER / SECTION 7: BRAND & PROJECT ELEMENTS / SECTION 8: NEGATIVE PROMPTS / SECTION 9: TECHNICAL SPECS

Below are THREE REFERENCE EXAMPLES — one per layout paradigm. Your output must contain all three prompts with their respective paradigm. Study each carefully.

━━━ REFERENCE A — nanobanana_prompt_main (GRAPHIC_DESIGN_FRAME, 1:1) ━━━

SECTION 1: SCENE NARRATIVE
A premium graphic design composition — NOT a photographed outdoor scene. The entire 1024×1024 canvas is anchored by a full-bleed deep navy (#1A3A5C) background. Two framed building photographs are placed as photo cards in the upper 60% of the frame. The composition reads as a structured grid: logo + mixed-weight headline at top → dual photo panels with caption bars and price badge → 2×2 feature checklist → centered gold CTA button → full-width gold footer contact strip. Professional Indian real estate ad standard.

SECTION 2: SUBJECT & COMPOSITION
LAYOUT TYPE: GRAPHIC_DESIGN_FRAME
BACKGROUND: Full-bleed #1A3A5C navy fills 100% of the 1024×1024 canvas — no sky, no landscape.
DECORATIVE GEOMETRY: Two hatched-stripe circle shapes in #C9A961 gold at 35% opacity — one partially cropped in top-right corner (diameter ~18% of frame), one partially visible bottom-right (diameter ~14%). Thin gold (#C9A961) L-bracket corner lines (2px weight, 14pt arm length) at all four corners of each photo card.
PHOTO PANEL 1 (LEFT, LARGE): Building exterior photo card. Position: x:3–58%, y:20–63%. White 2px border. Gold L-bracket corners. PHOTO_CAPTION_BAR at bottom: "NAYAPALLI, BBSR" white bold all-caps on navy strip.
PHOTO PANEL 2 (RIGHT, SMALL): Alternate building angle or entrance photo card. Position: x:62–97%, y:15–56%. Same white border + gold brackets. PRICE_BADGE overlaps bottom section of this panel.
ZONE TOP (y:3–17%): Logo top-left at 8% frame width. MIXED_WEIGHT_HEADLINE centered across remaining width.
ZONE MIDDLE (y:64–80%): FEATURE_CHECKLIST — 4 items in 2×2 grid with gold ✓ icons.
ZONE CTA (y:81–89%): Single centered CTA_BUTTON.
ZONE FOOTER (y:90–100%): Full-width FOOTER_STRIP.
Reading order: Logo + Headline → Photos + Price → Features → CTA → Footer.

SECTION 3: CAMERA & LENS
No single camera perspective — this is a graphic design frame. Left photo card uses 24mm wide-angle, 5° low-angle. Right photo card uses 35mm prime, three-quarter view. Both maintain tilt-shift vertical correction and sharp editorial quality.

SECTION 4: LIGHTING
No scene-level lighting — background is a flat design fill. Left photo: golden hour warm 3200K, long soft shadows east-to-west. Right photo: editorial overcast diffused daylight at 5500K, even exposure across facade.

SECTION 5: COLOR PALETTE
- Canvas background: #1A3A5C (deep navy) — 100% fill
- Photo card borders: #FFFFFF white (2px)
- Gold accents: #C9A961 — corner brackets, ✓ icons, CTA button, footer bar, "to" script word, price badge border, hatched circle decorations
- Primary text: #FFFFFF white — headline main words, feature list, caption bars
- Secondary text: #1A3A5C navy — CTA button label, footer text on gold bar

SECTION 6: TYPOGRAPHY LAYER (RENDERED IN IMAGE)
TEXT ELEMENT 1 — MIXED_WEIGHT_HEADLINE (RENDER IN IMAGE)
  Content: "READY to MOVE" — three word-groups with distinct treatments
  Font: "READY" = Bebas Neue or Impact ExtraBold condensed; "to" = Dancing Script or Great Vibes italic script; "MOVE" = same as "READY"
  Size: "READY"/"MOVE" = 72–80pt ultra-bold condensed; "to" = 56pt italic script
  Color: "READY"/"MOVE" = #FFFFFF white; "to" = #C9A961 gold
  Position: Centered, y:5–16%, spanning full usable width between logo and right edge
  Background: Transparent
  Treatment: Single line, tight tracking on condensed caps, the italic script "to" flows naturally between the two bold words at slightly smaller size

TEXT ELEMENT 2 — PRICE_BADGE (RENDER IN IMAGE)
  Content: "₹57 LAKHS" (use actual price from brief — always ₹ symbol, never $)
  Font: Bebas Neue or Inter ExtraBold condensed
  Size: 32–40pt — must be visually dominant, NOT an inline label
  Color: #FFFFFF white
  Position: Overlapping bottom 30% of PHOTO PANEL 2, centered within that panel's right half — approx x:68–95%, y:44–58%
  Background: #1A3A5C navy rectangle with #C9A961 gold 2px border, sharp corners, 10pt horizontal padding 7pt vertical padding
  Treatment: Standalone badge — same visual prominence as the headline, nothing else on the same line

TEXT ELEMENT 3 — PHOTO_CAPTION_BAR (ANCHORED TO PHOTO PANEL 1)
  Content: "NAYAPALLI, BBSR" (use actual project locality, City)
  Font: Inter Bold, all-caps
  Size: 13–15pt letter-spaced +0.05em
  Color: #FFFFFF white
  Position: Bottom edge of PHOTO PANEL 1 only — full width of that card, approx y:60–63%
  Background: #1A3A5C navy strip 100% width of photo card, height 22–26pt
  Treatment: Anchored label bar integrated into the photo card frame — not floating

TEXT ELEMENT 4 — FEATURE_CHECKLIST (RENDER IN IMAGE)
  Content: 4 amenity items in 2×2 grid:
    Left column — row 1: "2 BHK Apartments"  |  Right column — row 1: "Stilt Parking"
    Left column — row 2: "Power Backup"       |  Right column — row 2: "Lift, CCTV, Intercom"
    (replace with actual project amenities from brief)
  Font: Inter Regular 13–15pt for text; gold ✓ icon 12–14pt before each item
  Color: Text = #FFFFFF white; ✓ icon = #C9A961 gold
  Position: y:65–79%, full usable width with 5% side margins. Two equal columns left-aligned within each column.
  Background: Transparent (items sit on the navy canvas)
  Treatment: 2-column grid, consistent vertical spacing 6–8pt between rows, ✓ icon and text on same baseline

TEXT ELEMENT 5 — CTA_BUTTON (RENDER IN IMAGE)
  Content: "BOOK NOW" (or appropriate CTA from brief)
  Font: Inter Bold or Bebas Neue
  Size: 18–22pt
  Color: #1A3A5C navy
  Position: Horizontally centered, y:82–89%
  Background: #C9A961 gold wide rounded-rectangle button, ~55% frame width, height 38–44pt, subtle drop shadow
  Treatment: Centered label, clear tap target, most visually prominent interactive element after the headline

TEXT ELEMENT 6 — FOOTER_STRIP (RENDER IN IMAGE)
  Content: "+91-XXXXXXXXXX" left side | "www.brand.com" right side (use actual contact details from brief if provided, otherwise use placeholder labels)
  Font: Inter SemiBold 13–15pt
  Color: #1A3A5C navy
  Position: Full-width bar, y:91–100%
  Background: #C9A961 gold full-width horizontal bar, height = 9% of frame
  Treatment: Phone left-aligned with 4% margin; website right-aligned with 4% margin. RERA number (if provided) centered in small 9pt type.

SECTION 7: BRAND & PROJECT ELEMENTS
Logo: Top-left, x:3–11%, y:3–12%, 8% frame width — keep zone clear of headline overlap.
DECORATIVE GEOMETRY: Hatched-stripe circle (diagonal lines, 45°, 3px spacing) in #C9A961 at 35% opacity — one in top-right corner partially cropped (radius extends to x:82–100%, y:0–18%), one in bottom-right partially visible (center near x:95%, y:88%). These are purely compositional breathing elements on the flat navy background.
Photo card corners: Gold (#C9A961) L-bracket lines at all four corners of both photo panels — inner corner treatment, 2px line weight, 14pt arm length each direction.

SECTION 8: NEGATIVE PROMPTS
DO NOT render as a photographed outdoor scene — this is a GRAPHIC DESIGN FRAME, not a photo. DO NOT place building photos outside their designated card zones. DO NOT invent colors — use only #1A3A5C, #C9A961, and #FFFFFF. DO NOT omit the footer strip or the feature checklist — they are required. DO NOT merge the price badge into an info bar with other items. Text MUST be crisp, cleanly anti-aliased, fully legible — zero garbled characters. DO NOT use drop shadows on the main background. DO NOT blur or soften the footer strip. DO NOT merge the footer strip y-zone with the CTA zone — keep them as visually separate horizontal bands. DO NOT render the price badge as a small inline label — it must be a prominent standalone box.

SECTION 9: TECHNICAL SPECS
Aspect Ratio: 1:1 (1024×1024) | Model: GPT-Image-1 | Quality: medium | Style: graphic design flat layout, full-bleed dark background with embedded architectural photography cards

━━━ REFERENCE B — nanobanana_prompt_portrait (PHOTOREALISTIC_SCENE, 4:5) ━━━

SECTION 1: SCENE NARRATIVE
A serene early-morning establishing shot of a contemporary 8-storey residential tower rising from a landscaped courtyard in Nayapalli, captured the moment golden sunlight crests the building's eastern face. The vertical 4:5 frame gives the building space to breathe — sky occupies the upper third, building hero dominates center, foreground greenery anchors the lower quarter. Text elements occupy natural negative space in sky and foreground zones.

SECTION 2: SUBJECT & COMPOSITION
LAYOUT TYPE: PHOTOREALISTIC_SCENE
Sky zone (y:0–30%): Soft pre-dawn sky, pale gold to clear blue gradient. HEADLINE and SUBHEAD placed here on transparent background.
Building hero (y:25–80%): Full architectural face, three-quarter low-angle. Focal point at entrance archway (rule-of-thirds, x:62%).
Foreground (y:75–100%): Soft-focus landscaped hedge and paving. INFO_BOX anchored lower-left. CTA_BUTTON lower-right.
Reading order: Headline sky zone → building hero → info + CTA lower band.

SECTION 3: CAMERA & LENS
85mm portrait lens, 3° low-angle to enhance building scale, Sony A7R V for architectural sharpness. Tilt-shift correction for true verticals. Portrait frame allows full building height with sky breathing room above.

SECTION 4: LIGHTING
Golden hour backlighting at 06:45 IST, warm 3200K, long soft shadows extending west. Eastern facade catches direct warm sunlight; foreground in soft fill light.

SECTION 5: COLOR PALETTE
- Sky: Natural pale gold-to-blue gradient — no color invention
- Building: Facade natural tones in warm morning light
- Overlay text zones use brand palette: #1A3A5C navy, #C9A961 gold, #FAFAF7 off-white

SECTION 6: TYPOGRAPHY LAYER (RENDERED IN IMAGE)
TEXT ELEMENT 1 — HEADLINE (RENDER IN IMAGE)
  Content: "THE ZENITH" (use actual project name)
  Font: Playfair Display Bold serif
  Size: 52–60pt
  Color: #C9A961 gold
  Position: Sky zone, center-left, y:8–20%
  Background: Transparent, subtle #1A3A5C drop shadow for contrast
  Treatment: Tight letter-spacing, single line

TEXT ELEMENT 2 — SUBHEAD (RENDER IN IMAGE)
  Content: "Only 8 Premium 3BHK Homes · Nayapalli"
  Font: Inter Regular 18–22pt
  Color: #FAFAF7 off-white
  Position: Below headline, y:22–29%
  Background: Transparent

TEXT ELEMENT 3 — INFO_BOX (RENDER IN IMAGE)
  Content: "Starting ₹1.65 Cr | RERA: [number] | Ready to Move" (use actual values from brief)
  Font: Inter SemiBold 15–17pt
  Color: #FAFAF7 on #1A3A5C navy
  Position: Lower-left, y:82–90%, 5% left margin
  Background: #1A3A5C rounded rectangle 12pt inner padding

TEXT ELEMENT 4 — CTA_BUTTON (RENDER IN IMAGE)
  Content: "WhatsApp to Enquire"
  Font: Inter SemiBold 15–18pt
  Color: #1A3A5C
  Position: Lower-right, y:82–90%, 5% right margin
  Background: #C9A961 gold pill, 12pt padding sides

SECTION 7: BRAND & PROJECT ELEMENTS
Logo top-left at 7% frame width, y:3–10% — sky zone ensures clean white/gold contrast. No decorative geometry — photorealistic scene must feel uncluttered.

SECTION 8: NEGATIVE PROMPTS
DO NOT use a flat background — this MUST be a real photographic exterior scene. DO NOT add feature checklists or footer strips — this layout is intentionally minimal. DO NOT invent building architecture. Text must be legible against the sky zone.

SECTION 9: TECHNICAL SPECS
Aspect Ratio: 4:5 (1024×1536) | Model: GPT-Image-1 | Quality: medium | Style: photorealistic architectural editorial photography, golden hour

━━━ REFERENCE C — nanobanana_prompt_story (TYPOGRAPHY_FORWARD, 9:16) ━━━

SECTION 1: SCENE NARRATIVE
A typography-dominant vertical composition for a 1024×1792 pixel canvas — mobile Stories and Reels format. The bold headline dominates the top 40% of the frame (y:0–720px) in large display type designed for 0.4-second thumb-stop impact at mobile screen size. A framed building photo card sits in the center zone (y:740–1400px) as a secondary visual proof point. The lower zone (y:1400–1792px) contains a price line and one CTA button. Three text elements total — the headline IS the hero.

SECTION 2: SUBJECT & COMPOSITION
LAYOUT TYPE: TYPOGRAPHY_FORWARD
BACKGROUND: Full-bleed #1A3A5C navy.
HEADLINE ZONE (y:5–42%): Ultra-large display headline dominates — this is the visual hero, not the photo.
PHOTO CARD ZONE (y:44–78%): Single building photo as a framed card (white 2px border, gold corner brackets), centered horizontally, ~80% frame width.
CTA ZONE (y:80–94%): Price + CTA button stacked vertically, centered.
FOOTER (y:95–100%): Thin gold line or micro FOOTER_STRIP (contact in 10pt).
Reading order: Headline → Photo proof → Price + CTA.

SECTION 3: CAMERA & LENS
Photo card: 50mm natural perspective, front-elevation shot for maximum building recognition within the small card area.

SECTION 4: LIGHTING
Photo card: Editorial overcast 5500K, even lighting for clear facade detail within the compact card.

SECTION 5: COLOR PALETTE
- Background: #1A3A5C navy full-bleed
- Headline: #C9A961 gold (high-contrast, thumb-stop)
- Photo card: white 2px border, gold corner brackets
- CTA button: #C9A961 gold

SECTION 6: TYPOGRAPHY LAYER (RENDERED IN IMAGE)
TEXT ELEMENT 1 — HEADLINE (RENDER IN IMAGE)
  Content: Two-line display — e.g., "ONLY 8" (line 1) + "HOMES LEFT" (line 2) — use strongest urgency or benefit from brief
  Font: Bebas Neue or Anton ExtraBold condensed display
  Size: 64–76pt per line — large enough for thumb-stop impact but within reliable AI text rendering range
  Color: #C9A961 gold (line 1) / #FFFFFF white (line 2) — alternating for visual rhythm
  Position: y:6–40% (approx y:107px–717px), centered horizontally
  Background: Transparent
  Treatment: Tight leading 1.05, letter-spacing +0.02em, fills ~72% of frame width. RENDER PRIORITY: perfectly crisp, fully anti-aliased letterforms with consistent stroke weight — zero distortion

TEXT ELEMENT 2 — PRICE + SUBLINE (RENDER IN IMAGE)
  Content: "From ₹[actual price] · [actual locality], [actual city]" — substitute real values from brief
  Font: Inter SemiBold 20–24pt
  Color: #FAFAF7 off-white
  Position: y:80–86%, centered
  Background: Transparent

TEXT ELEMENT 3 — CTA_BUTTON (RENDER IN IMAGE)
  Content: "BOOK NOW"
  Font: Inter Bold 20–24pt
  Color: #1A3A5C navy
  Position: y:87–94%, centered
  Background: #C9A961 gold wide rounded-rectangle, ~65% frame width, height 46–52pt

SECTION 7: BRAND & PROJECT ELEMENTS
Logo: Top-center or top-left, y:1–5%, small (6% frame width) — does not compete with headline. Photo card gets gold L-bracket corners. No other decorative elements — headline IS the decoration.

SECTION 8: NEGATIVE PROMPTS
DO NOT make the photo card larger than 35% of vertical frame — the HEADLINE is the hero, not the building photo. DO NOT add a feature checklist — maximum 3 text elements for Stories. DO NOT use earth tones or nature photography backgrounds. DO NOT render blurry, pixelated, or distorted text — all characters must be crisp and fully legible at mobile screen size. DO NOT allow headline text to overflow or clip at frame edges — maintain 4% side margin minimum. DO NOT blur the footer or merge it with the CTA zone. DO NOT render the photo card taller than 37% of the 1792px canvas height.

SECTION 9: TECHNICAL SPECS
Canvas: 1024×1792 pixels | Aspect Ratio: 9:16 | Model: GPT-Image-1 | Quality: high | Style: bold typography-dominant graphic poster for mobile Stories/Reels. RENDER PRIORITY: Maximum text legibility — prefer slightly smaller type that is crisp over larger type that is blurry or distorted.

━━━ END REFERENCE EXAMPLES ━━━

Now produce YOUR creative brief following all three layout paradigms above. Use ONLY the brand kit hex codes provided in BRAND IDENTITY. Output ONLY the JSON object — no markdown fences, no preamble.

OUTPUT JSON SCHEMA:

{
  "creative_concept": "1-line concept statement",
  "designer_rationale": "Aanya's POV: why this concept for this brief, 2-3 sentences. Reference design DNA if available.",
  "nanobanana_prompt_main": "LAYOUT: GRAPHIC_DESIGN_FRAME (Reference A). Full-bleed dark background + dual photo cards + MIXED_WEIGHT_HEADLINE + PRICE_BADGE + PHOTO_CAPTION_BAR + FEATURE_CHECKLIST (2×2 grid with ✓ icons) + CTA_BUTTON + FOOTER_STRIP. Nine sections, 500–800 words. All six TEXT ELEMENT types required in Section 6.",
  "nanobanana_prompt_portrait": "LAYOUT: PHOTOREALISTIC_SCENE (Reference B). Single cinematic hero building photo, sky/landscape depth, minimal premium overlay text. Aspect ratio 4:5 (1024×1536). Nine sections, 400–600 words. Section 9 must specify 4:5 aspect ratio.",
  "nanobanana_prompt_story": "LAYOUT: TYPOGRAPHY_FORWARD (Reference C). Bold display headline dominates 40% of frame (64–76pt, NOT 96pt+), building as secondary photo card, max 3 text elements. Canvas: 1024×1792px. Nine sections, 400–600 words. Section 9 must specify 9:16 aspect ratio AND quality: high.",
  "reference_image_manifest": [{"role": "BRAND_LOGO_COLOR", "instruction": "..."}],
  "ad_copy": {
    ${(input.ad_platform === 'AiSensy'
      ? input.languages.map(lang =>
        `"headline_${lang.toLowerCase()}": "WhatsApp template header — max 60 chars, benefit-led hook in ${lang}",
    "subhead_${lang.toLowerCase()}": "Teaser line — max 20 words in ${lang}",
    "primary_text_${lang.toLowerCase()}": "WhatsApp message body — conversational, emoji-rich, 300-500 chars in ${lang}. Open with a personal hook (not a broadcast). Include the key USP + soft CTA. Reads like a message from a trusted advisor, not an ad. No jargon.",
    "description_${lang.toLowerCase()}": "WhatsApp quick-reply button label — max 20 chars in ${lang}"`)
      : input.languages.map(lang =>
        `"headline_${lang.toLowerCase()}": "Max 40 chars — Meta feed headline in ${lang}. Punchy benefit statement.",
    "subhead_${lang.toLowerCase()}": "Max 20 words in ${lang}",
    "primary_text_${lang.toLowerCase()}": "First 125 chars MUST work as a standalone hook (visible before 'See More' on Meta). Total 125-250 chars. Emoji-led. In ${lang}. Lead with the strongest hook — price, urgency, or dream.",
    "description_${lang.toLowerCase()}": "Max 30 chars — Meta link description in ${lang}"`)
    ).join(',\n    ')},
    "cta": ${input.ad_platform === 'AiSensy'
      ? `"WhatsApp Now OR Know More OR Book a Call — keep under 20 chars, WhatsApp button label"`
      : `"Send WhatsApp Message OR Book Site Visit OR Get Brochure OR Learn More — use exact Meta CTA label text"`}
  },
  "post_production_notes": "Manual overlay needed (especially for non-Latin scripts where Nanobanana may render imperfectly). Be specific.",
  "design_dna_tags": {
    "angle": "price_led_with_urgency | lifestyle_aspirational | trust_legacy | location_proximity | amenity_showcase",
    "composition": "rule_of_thirds_building_left | centered_hero | split_screen_text_visual | overlay_text_on_image",
    "color_treatment": "dark_navy_gold_accent | warm_earth_tones | high_contrast_minimal",
    "copy_angle": "scarcity_urgency | aspirational_future | factual_data | emotional_family",
    "lighting": "golden_hour | editorial_overcast | chiaroscuro | studio_softbox"
  },
  "predicted_performance": "Brief prediction based on Design DNA",
  "self_check": {
    "all_three_layout_paradigms_produced": true,
    "prompt_main_is_graphic_design_frame": true,
    "prompt_portrait_is_photorealistic_scene": true,
    "prompt_story_is_typography_forward": true,
    "section_5_uses_only_brand_kit_hex_codes": true,
    "section_6_main_has_feature_checklist": true,
    "section_6_main_has_footer_strip": true,
    "section_6_main_has_price_badge": true,
    "section_6_main_has_mixed_weight_headline": true,
    "no_invented_colors": true,
    "three_prompts_are_visually_distinct_not_same_layout_at_different_sizes": true
  }
}`;

  return {
    systemPrompt: AANYA_SYSTEM_PROMPT,
    userPrompt,
    referenceImageCount: count,
    expectedOutputSchema: {}
  };
}

// ============================================================
// CONVENIENCE WRAPPERS for specific flows
// ============================================================

// QUICK GENERATE: simpler input, single creative
export async function buildQuickGenerateBrief(args: {
  user_brief: string;
  project_id?: string;
  project_data?: ProjectData; // for custom projects
  campaign_goal?: CreativeBriefInput['campaign_goal'];
  funnel_stage?: CreativeBriefInput['funnel_stage'];
  placement?: CreativeBriefInput['placement'];
  languages: string[];
  quick_references?: QuickReference[];
  ad_platform?: 'AiSensy' | 'Meta Ads Manager';
}) {
  return buildSeniorDesignerCreativePrompt({
    user_brief: args.user_brief,
    project_id: args.project_id,
    project_data: args.project_data,
    campaign_goal: args.campaign_goal || 'lead_generation',
    funnel_stage: args.funnel_stage || 'BOFU',
    placement: args.placement || 'feed_square',
    languages: args.languages,
    quick_references: args.quick_references,
    ad_platform: args.ad_platform,
  });
}

// AD CREATIVES MODULE: generates 3 variants with different angles
export async function buildVariantBriefs(args: {
  project_id: string;
  user_brief: string;
  funnel_stage: CreativeBriefInput['funnel_stage'];
  languages: string[];
  ad_platform?: 'AiSensy' | 'Meta Ads Manager';
  quick_references?: QuickReference[];
}) {
  const variants: Array<{label: 'A' | 'B' | 'C', angle: string}> = [
    { label: 'A', angle: 'price_led_with_urgency' },
    { label: 'B', angle: 'lifestyle_aspirational' },
    { label: 'C', angle: 'trust_legacy_or_amenity' },
  ];

  const prompts = await Promise.all(variants.map(v =>
    buildSeniorDesignerCreativePrompt({
      user_brief: args.user_brief,
      project_id: args.project_id,
      campaign_goal: 'lead_generation',
      funnel_stage: args.funnel_stage,
      placement: 'feed_square',
      languages: args.languages,
      quick_references: args.quick_references,
      ad_platform: args.ad_platform,
      variant_label: v.label,
      variant_angle: v.angle,
    })
  ));

  return prompts;
}

// SMM CREATIVE (per-post)
export async function buildSMMCreativeBrief(args: {
  post_topic: string;
  post_category: 'company_branding' | 'project_branding' | 'holiday_festival' | 'event' | 'engagement' | 'awareness' | 'milestone' | 'educational';
  project_id?: string;
  languages: string[];
  festival_or_event?: CreativeBriefInput['festival_or_event'];
  post_type: 'reel' | 'carousel' | 'static' | 'story';
}) {
  // Map SMM categories to campaign goals
  const goalMap: Record<string, CreativeBriefInput['campaign_goal']> = {
    company_branding: 'branding',
    project_branding: 'branding',
    holiday_festival: 'festive_event',
    event: 'festive_event',
    engagement: 'engagement',
    awareness: 'awareness',
    milestone: 'milestone',
    educational: 'educational',
  };

  const placementMap: Record<string, CreativeBriefInput['placement']> = {
    reel: 'story_reel',
    carousel: 'feed_square',
    static: 'feed_square',
    story: 'story_reel',
  };

  return buildSeniorDesignerCreativePrompt({
    user_brief: args.post_topic,
    project_id: args.project_id,
    campaign_goal: goalMap[args.post_category] || 'branding',
    funnel_stage: 'TOFU',
    placement: placementMap[args.post_type],
    languages: args.languages,
    festival_or_event: args.festival_or_event,
  });
}

// AD REVIEW FOLLOW-UP (revised creative based on issues)
export async function buildRevisedCreativeBrief(args: {
  original_creative_brief: string;
  identified_issues: string[];
  fixes_to_apply: string[];
  project_id?: string;
  languages: string[];
}) {
  const enhancedBrief = `REVISION REQUEST.
ORIGINAL BRIEF: ${args.original_creative_brief}

ISSUES IDENTIFIED IN PREVIOUS CREATIVE:
${args.identified_issues.map(i => `- ${i}`).join('\n')}

FIXES TO APPLY:
${args.fixes_to_apply.map(f => `- ${f}`).join('\n')}

Produce a revised creative brief that explicitly addresses each issue while staying true to the original goal.`;

  return buildSeniorDesignerCreativePrompt({
    user_brief: enhancedBrief,
    project_id: args.project_id,
    campaign_goal: 'lead_generation',
    funnel_stage: 'BOFU',
    placement: 'feed_square',
    languages: args.languages,
  });
}

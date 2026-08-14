// src/lib/senior-designer-prompts.ts
// PURPOSE: Master creative prompt builder applying the Senior Creative Designer skill.
// REPLACES the basic creative generation in: Quick Generate, Full Strategy creatives,
// Ad Creatives module, Ad Review follow-up, SMM Creatives, Campaign Wizard creative step.
//
// All these flows now route through buildSeniorDesignerCreativePrompt().

import type { AdPlatform } from './ad-platform';
import { supabase } from './supabase';
import { getOrgId } from './constants';
import { aiCall } from './ai-service';
import { getBrandProvider, getMediaProvider } from './providers';
import { panelPositionLabel, type PhotoPanel, type PanelSlot } from './reference-style';

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
  ad_platform?: AdPlatform;
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

export interface PromptFragments {
  section_1?: string;
  section_3?: string;
  section_4?: string;
  section_5_hex?: string[];
  section_6_elements?: string[];
  section_8_avoid?: string[];
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
  prompt_fragments?: PromptFragments | null;
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
    return `DESIGN DNA: No prior performance data yet (${dna.total_creatives_analyzed} creatives analyzed). Apply standard real estate creative best practices for the chosen aesthetic.`;
  }

  const f = dna.prompt_fragments;

  // If section-level fragments exist (Phase 6+), inject them per section.
  // This gives the model precise, section-addressable constraints rather than a block to interpret.
  if (f && (f.section_1 || f.section_3 || f.section_4 || f.section_5_hex?.length || f.section_6_elements?.length)) {
    let block = `DESIGN DNA — ${dna.total_creatives_analyzed} creatives analyzed (confidence: ${dna.confidence_level})\n`;
    if (dna.dna_summary) block += `\nSUMMARY: ${dna.dna_summary}\n`;
    block += `\n— SECTION-LEVEL LEARNED PREFERENCES (apply to the corresponding section of your prompt) —\n`;
    if (f.section_1) block += `\nSection 1 (scene): ${f.section_1}`;
    if (f.section_3) block += `\nSection 3 (lens/shot): ${f.section_3}`;
    if (f.section_4) block += `\nSection 4 (lighting): ${f.section_4}`;
    if (f.section_5_hex?.length) {
      block += `\nSection 5 (color palette): Use these hex codes — ${f.section_5_hex.join(', ')}. Do NOT substitute or invent new colors.`;
    }
    if (f.section_6_elements?.length) {
      block += `\nSection 6 (typography): Prefer these elements — ${f.section_6_elements.join(' | ')}`;
    }
    if (f.section_8_avoid?.length) {
      block += `\nSection 8 (negative prompts): Add these — ${f.section_8_avoid.join(', ')}`;
    }
    if (dna.best_performing_compositions?.length > 0) {
      block += `\n\nTOP COMPOSITIONS: ${dna.best_performing_compositions.slice(0, 2).map((c: any) => c.composition).join(' | ')}`;
    }
    block += `\n\nThese are HARD learned preferences from real ad performance — treat them as constraints, not suggestions.`;
    return block;
  }

  // Legacy fallback (no fragments yet — soft guidance block)
  let dnaBlock = `DESIGN DNA — Learned from ${dna.total_creatives_analyzed} past creatives (confidence: ${dna.confidence_level})\n`;
  if (dna.dna_summary) dnaBlock += `\nSUMMARY: ${dna.dna_summary}\n`;
  if (dna.best_performing_compositions?.length > 0) {
    dnaBlock += `\nTOP COMPOSITIONS:\n`;
    dna.best_performing_compositions.slice(0, 3).forEach((c: any) => {
      dnaBlock += `  - ${c.composition}\n`;
    });
  }
  if (dna.underperforming_patterns?.length > 0) {
    dnaBlock += `\nAVOID:\n`;
    dna.underperforming_patterns.slice(0, 3).forEach((p: any) => {
      dnaBlock += `  - ${p.pattern}\n`;
    });
  }
  dnaBlock += `\nUse this DNA as a SOFT preference — prioritize campaign goal if it conflicts.`;
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
    // Provider returns a backend-agnostic open shape; cast to this module's
    // concrete BrandKit at the boundary.
    brandKit = (await getBrandProvider().getBrandKit(getOrgId()) as BrandKit | null) || undefined;
  }

  if (input.project_id && !projectAssets && supabase) {
    projectAssets = (await getMediaProvider().listProjectMedia(getOrgId(), input.project_id)) as unknown as ProjectAsset[];
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
    ${(input.ad_platform === 'google'
      ? input.languages.map(lang =>
        `"headline_${lang.toLowerCase()}": "Max 30 chars — Google Ads headline asset in ${lang}. Benefit- or offer-led; no ALL-CAPS and no excessive punctuation (Google disapproves both).",
    "subhead_${lang.toLowerCase()}": "Second headline asset — max 30 chars in ${lang}",
    "primary_text_${lang.toLowerCase()}": "Google Ads description asset — max 90 chars in ${lang}. ONE complete benefit-led sentence that reads correctly on its own, because Google recombines assets in any order.",
    "description_${lang.toLowerCase()}": "Max 30 chars — sitelink/callout label in ${lang}"`)
      : input.languages.map(lang =>
        `"headline_${lang.toLowerCase()}": "Max 40 chars — Meta feed headline in ${lang}. Punchy benefit statement.",
    "subhead_${lang.toLowerCase()}": "Max 20 words in ${lang}",
    "primary_text_${lang.toLowerCase()}": "First 125 chars MUST work as a standalone hook (visible before 'See More' on Meta). Total 125-250 chars. Emoji-led. In ${lang}. Lead with the strongest hook — price, urgency, or dream.",
    "description_${lang.toLowerCase()}": "Max 30 chars — Meta link description in ${lang}"`)
    ).join(',\n    ')},
    "cta": ${input.ad_platform === 'google'
      ? `"Get Quote OR Book Site Visit OR Download Brochure OR Learn More — Google Ads CTA, max 30 chars"`
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
  ad_platform?: AdPlatform;
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
  ad_platform?: AdPlatform;
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

// ============================================================
// TWO-STAGE GENERATION (fixes 504s from the single ~16000-token
// buildSeniorDesignerCreativePrompt call — see CLAUDE.md bug #36).
//
// Stage 1: concept + ad copy + visual_anchor (one small call, ~1500 tok).
// Stage 2: one call per layout (main/portrait/story), each reproducing
// Stage 1's visual_anchor verbatim so all layouts depict the same
// building (also fixes bug #37's cross-image inconsistency).
//
// Only used by Quick Generate (Strategy.tsx) and Creatives.tsx's
// no-reference-image variant path today. buildSeniorDesignerCreativePrompt
// (single-call) remains in use by: Strategy.tsx's Full Strategy secondary
// Aanya call, Creatives.tsx's reference-image variant path (needs vision
// on the same call), buildSMMCreativeBrief, buildRevisedCreativeBrief.
// Migrate those to two-stage in a follow-up if they show the same timeout
// profile — not done here to keep this change's blast radius to the
// paths that were actually confirmed hitting 504s.
// ============================================================

type EnrichedContext = {
  brandKit?: BrandKit;
  projectAssets?: ProjectAsset[];
  designDNA?: ProjectDesignSystem;
  projectData?: ProjectData;
};

async function loadEnrichedContext(input: CreativeBriefInput): Promise<EnrichedContext> {
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

  return { brandKit, projectAssets, designDNA, projectData };
}

function campaignContextBlock(input: CreativeBriefInput, ctx: EnrichedContext): string {
  const { projectData } = ctx;
  return `PROJECT: ${projectData ? projectData.name : 'Generic brand creative (no specific project)'}
${projectData ? `- Locality: ${projectData.locality}, ${projectData.city}
- Price Range: ${projectData.price_range}
- Units Remaining: ${projectData.units_remaining ?? 'N/A'}
- USPs: ${projectData.usps}
- Target Buyer: ${projectData.target_buyer}
${projectData.rera_number ? `- RERA: ${projectData.rera_number} (MUST appear in creative)` : '- RERA: Not provided (omit from creative)'}` : ''}

CAMPAIGN GOAL: ${input.campaign_goal.toUpperCase()} | FUNNEL STAGE: ${input.funnel_stage} | PLACEMENT: ${input.placement}
${input.ad_platform ? `AD PLATFORM: ${input.ad_platform}` : ''}
${input.variant_label ? `VARIANT: ${input.variant_label} (angle: ${input.variant_angle || 'designer choice'})` : ''}

USER BRIEF (verbatim from user):
"${input.user_brief}"`;
}

function brandIdentityBlock(ctx: EnrichedContext): string {
  const { brandKit } = ctx;
  return brandKit ? `- Primary Color: ${brandKit.primary_color}
- Secondary Color: ${brandKit.secondary_color}
- Accent Color: ${brandKit.accent_color}
- Text Color: ${brandKit.text_color}
- Background: ${brandKit.background_color}
- Tagline: "${brandKit.tagline}"
- Brand Voice: ${brandKit.brand_voice}
- Cultural Motifs: ${brandKit.cultural_motifs?.join(', ') || 'None'}` : `BRAND KIT: Not configured — use Indian real estate defaults:
- Primary Color: #1A3A5C (deep navy) | Accent: #C9A961 (warm gold) | Text: #FFFFFF
All prices: ₹ symbol.`;
}

// ── STAGE 1: concept + ad copy + visual_anchor ──────────────────────────

const AANYA_SYSTEM_PROMPT_STAGE1 = `You are Aanya Mehta, Senior Creative Director at FCB India / L&K Saatchi alumni. 12 years designing campaigns for Lodha, DLF Camellias, Sobha, Damac, Emaar Beachfront, Mahindra Lifespaces.

This is STAGE 1 of a two-stage creative process. You are NOT writing the image generation prompt yet — a later stage handles that. Your job here is strategic: the concept, the ad copy, and a literal visual anchor description.

RULE — BRAND KIT COMPLIANCE: Reference only the hex codes given in BRAND IDENTITY. Never invent colors.
RULE — INDIAN CURRENCY ONLY: Every price in ad_copy MUST use ₹ or "Rs." — never $, USD, or any other currency symbol.
RULE — NO PLACEHOLDERS: Replace every placeholder with the real value from CAMPAIGN CONTEXT. If a value isn't provided, omit it — never invent one.
RULE — VISUAL ANCHOR: Write a 60-100 word literal, concrete architectural/scene description (building type, height, materials, setting, time of day) that a later stage will reproduce VERBATIM across three separate image-generation prompts. This is the single source of truth for what the building looks like — be specific enough that three independent writers describing it later would draw the same building.

You always respond ONLY in valid JSON. No markdown fences, no preamble.`;

function buildStage1Prompt(input: CreativeBriefInput, ctx: EnrichedContext): { systemPrompt: string; userPrompt: string } {
  const aesthetic = ctx.brandKit?.design_aesthetic || 'premium_minimal';
  const strategy = getGoalStrategy(input.campaign_goal, input.funnel_stage);
  const dnaBlock = ctx.designDNA ? formatDesignDNA(ctx.designDNA) : 'No prior performance data yet.';
  const languageBlock = formatLanguages(input.languages);
  const { manifest, count } = buildReferenceManifest({ ...input, ...ctx });

  const userPrompt = `# CREATIVE BRIEF — STAGE 1 (concept, copy, visual anchor)

## CAMPAIGN CONTEXT
${campaignContextBlock(input, ctx)}

## BRAND IDENTITY
${brandIdentityBlock(ctx)}

## AESTHETIC MODE
${aesthetic}

## STRATEGIC DIRECTION
${strategy}

## DESIGN DNA
${dnaBlock}

## REFERENCE IMAGES (${count} provided)
${manifest.length > 0 ? manifest.join('\n') : 'None provided.'}

## LANGUAGE LAYERS
${languageBlock}

---

Output ONLY this JSON object (no markdown fences, no preamble):

{
  "creative_concept": "1-line concept statement",
  "designer_rationale": "Aanya's POV: why this concept, 2-3 sentences",
  "visual_anchor": "60-100 word literal architectural/scene description — see RULE above",
  "reference_image_manifest": [{"role": "BRAND_LOGO_COLOR", "instruction": "..."}],
  "ad_copy": {
    ${(input.ad_platform === 'google'
      ? input.languages.map(lang =>
        `"headline_${lang.toLowerCase()}": "Max 30 chars — Google Ads headline asset in ${lang}",
    "subhead_${lang.toLowerCase()}": "Second headline asset — max 30 chars in ${lang}",
    "primary_text_${lang.toLowerCase()}": "Google Ads description asset — max 90 chars in ${lang}, one self-contained benefit-led sentence",
    "description_${lang.toLowerCase()}": "Max 30 chars — sitelink/callout label in ${lang}"`)
      : input.languages.map(lang =>
        `"headline_${lang.toLowerCase()}": "Max 40 chars — Meta feed headline in ${lang}",
    "subhead_${lang.toLowerCase()}": "Max 20 words in ${lang}",
    "primary_text_${lang.toLowerCase()}": "First 125 chars a standalone hook. Total 125-250 chars. In ${lang}.",
    "description_${lang.toLowerCase()}": "Max 30 chars — Meta link description in ${lang}"`)
    ).join(',\n    ')},
    "cta": ${input.ad_platform === 'google'
      ? `"Get Quote OR Book Site Visit OR Download Brochure OR Learn More — max 30 chars"`
      : `"Send WhatsApp Message OR Book Site Visit OR Get Brochure OR Learn More"`}
  },
  "design_dna_tags": {
    "angle": "price_led_with_urgency | lifestyle_aspirational | trust_legacy | location_proximity | amenity_showcase",
    "composition": "rule_of_thirds_building_left | centered_hero | split_screen_text_visual | overlay_text_on_image",
    "color_treatment": "dark_navy_gold_accent | warm_earth_tones | high_contrast_minimal",
    "copy_angle": "scarcity_urgency | aspirational_future | factual_data | emotional_family",
    "lighting": "golden_hour | editorial_overcast | chiaroscuro | studio_softbox"
  },
  "predicted_performance": "Brief prediction based on Design DNA",
  "post_production_notes": "Manual overlay needed, especially for non-Latin scripts"
}`;

  return { systemPrompt: AANYA_SYSTEM_PROMPT_STAGE1, userPrompt };
}

// ── STAGE 2: one nanobanana prompt per layout, reproducing visual_anchor ──

type Layout = 'main' | 'portrait' | 'story';

const REFERENCE_EXAMPLE: Record<Layout, { paradigm: string; aspect: string; example: string }> = {
  main: {
    paradigm: 'GRAPHIC_DESIGN_FRAME',
    aspect: '1:1 (1024x1024)',
    example: `SECTION 1: SCENE NARRATIVE
A premium graphic design composition — NOT a photographed outdoor scene. The entire 1024×1024 canvas is anchored by a full-bleed deep navy (#1A3A5C) background. Two framed building photographs are placed as photo cards in the upper 60% of the frame.

SECTION 2: SUBJECT & COMPOSITION
BACKGROUND: Full-bleed brand primary color fills 100% of canvas — no sky, no landscape.
PHOTO PANEL 1 (LEFT, LARGE): Building exterior photo card, white border, gold L-bracket corners, PHOTO_CAPTION_BAR at bottom with locality.
PHOTO PANEL 2 (RIGHT, SMALL): Alternate angle, PRICE_BADGE overlapping bottom section.
ZONE TOP: Logo + MIXED_WEIGHT_HEADLINE. ZONE MIDDLE: FEATURE_CHECKLIST 2×2 grid. ZONE CTA: centered CTA_BUTTON. ZONE FOOTER: full-width FOOTER_STRIP.

SECTION 3: CAMERA & LENS
Left photo: 24mm wide-angle, 5° low-angle. Right photo: 35mm prime, three-quarter view.

SECTION 4: LIGHTING
Left: golden hour warm 3200K. Right: editorial overcast 5500K.

SECTION 5: COLOR PALETTE
Use only the brand hex codes from BRAND IDENTITY for background, accents, and text.

SECTION 6: TYPOGRAPHY LAYER (RENDERED IN IMAGE)
TEXT ELEMENT 1 — MIXED_WEIGHT_HEADLINE: word-level font switching, e.g. "READY" bold condensed + "to" italic script + "MOVE" bold condensed.
TEXT ELEMENT 2 — PRICE_BADGE: standalone box, 32-40pt, not buried in an info bar.
TEXT ELEMENT 3 — PHOTO_CAPTION_BAR: anchored to photo panel 1, locality text.
TEXT ELEMENT 4 — FEATURE_CHECKLIST: 2×2 grid, ✓ icons, real amenities from brief.
TEXT ELEMENT 5 — CTA_BUTTON: pill button, ~55% frame width.
TEXT ELEMENT 6 — FOOTER_STRIP: phone left, website right, full-width gold bar.
Each element needs Content/Font/Size/Color/Position/Background/Treatment, using real values substituted for every placeholder.

SECTION 7: BRAND & PROJECT ELEMENTS
Logo top-left, 8% frame width. Gold L-bracket corners on both photo cards.

SECTION 8: NEGATIVE PROMPTS
DO NOT render as a photographed scene — this is a graphic design frame. DO NOT invent colors outside the brand palette. DO NOT omit the footer strip or feature checklist. Text must be crisp, zero garbled characters.

SECTION 9: TECHNICAL SPECS
Aspect Ratio: 1:1 (1024×1024) | Model: GPT-Image-1 | Quality: medium`,
  },
  portrait: {
    paradigm: 'PHOTOREALISTIC_SCENE',
    aspect: '4:5 (1024x1536)',
    example: `SECTION 1: SCENE NARRATIVE
A serene establishing shot of the building described in VISUAL ANCHOR, captured with real sky and landscape depth. The vertical 4:5 frame gives the building room to breathe.

SECTION 2: SUBJECT & COMPOSITION
Sky zone (y:0-30%): HEADLINE and SUBHEAD on transparent background. Building hero (y:25-80%): full architectural face, three-quarter low-angle. Foreground (y:75-100%): INFO_BOX lower-left, CTA_BUTTON lower-right.

SECTION 3: CAMERA & LENS
85mm portrait lens, 3° low-angle, tilt-shift correction for true verticals.

SECTION 4: LIGHTING
Golden hour backlighting, warm 3200K, long soft shadows.

SECTION 5: COLOR PALETTE
Sky: natural gradient, no color invention. Overlay text: brand hex codes from BRAND IDENTITY.

SECTION 6: TYPOGRAPHY LAYER (RENDERED IN IMAGE)
TEXT ELEMENT 1 — HEADLINE: project name, serif, 52-60pt, sky zone.
TEXT ELEMENT 2 — SUBHEAD: key USP, below headline.
TEXT ELEMENT 3 — INFO_BOX: price | RERA | status, lower-left rounded rectangle.
TEXT ELEMENT 4 — CTA_BUTTON: lower-right pill.
Each element needs Content/Font/Size/Color/Position/Background, using real values substituted for every placeholder.

SECTION 7: BRAND & PROJECT ELEMENTS
Logo top-left, 7% frame width, sky zone. No decorative geometry — must feel uncluttered.

SECTION 8: NEGATIVE PROMPTS
DO NOT use a flat background — this MUST be a real photographic exterior scene. DO NOT add feature checklists or footer strips. DO NOT invent architecture beyond VISUAL ANCHOR.

SECTION 9: TECHNICAL SPECS
Aspect Ratio: 4:5 (1024×1536) | Model: GPT-Image-1 | Quality: medium`,
  },
  story: {
    paradigm: 'TYPOGRAPHY_FORWARD',
    aspect: '9:16 (1024x1792)',
    example: `SECTION 1: SCENE NARRATIVE
A typography-dominant vertical composition, 1024×1792. Bold headline dominates the top 40%. The building from VISUAL ANCHOR appears as a secondary framed photo card in the center zone. Lower zone: price + CTA.

SECTION 2: SUBJECT & COMPOSITION
BACKGROUND: full-bleed brand primary color. HEADLINE ZONE (y:5-42%): ultra-large display headline, the hero. PHOTO CARD ZONE (y:44-78%): building photo as framed card, ~80% frame width. CTA ZONE (y:80-94%): price + CTA stacked.

SECTION 3: CAMERA & LENS
Photo card: 50mm natural perspective, front-elevation.

SECTION 4: LIGHTING
Photo card: editorial overcast 5500K.

SECTION 5: COLOR PALETTE
Use brand hex codes from BRAND IDENTITY for background, headline, and CTA.

SECTION 6: TYPOGRAPHY LAYER (RENDERED IN IMAGE)
TEXT ELEMENT 1 — HEADLINE: two-line display, 64-76pt/line, strongest urgency/benefit from brief.
TEXT ELEMENT 2 — PRICE + SUBLINE: real price + locality, below photo card.
TEXT ELEMENT 3 — CTA_BUTTON: wide rounded-rectangle, ~65% frame width.
Each element needs Content/Font/Size/Color/Position/Background, using real values substituted for every placeholder.

SECTION 7: BRAND & PROJECT ELEMENTS
Logo top-center, small, does not compete with headline. Photo card gets gold L-bracket corners.

SECTION 8: NEGATIVE PROMPTS
DO NOT make the photo card larger than 35% of vertical frame — headline is the hero. DO NOT add a feature checklist — max 3 text elements. DO NOT render blurry or distorted text.

SECTION 9: TECHNICAL SPECS
Canvas: 1024×1792 | Aspect Ratio: 9:16 | Model: GPT-Image-1 | Quality: high`,
  },
};

// Stage 2's output is a single large free-form string (500-800 words, with
// quoted example content like "READY to MOVE" baked into Section 6). Asking
// for that inside a JSON envelope is exactly the shape that produces
// unescaped-quote parse failures — so Stage 2 responds with plain text
// instead, sidestepping JSON escaping for this call entirely.
const AANYA_SYSTEM_PROMPT_STAGE2 = AANYA_SYSTEM_PROMPT.replace(
  'You always respond ONLY in valid JSON. No markdown fences, no preamble. Just the JSON object.',
  'For THIS task, respond with ONLY the raw prompt as plain text — no JSON, no wrapping braces or quotes, no markdown fences, no preamble.'
);

function buildStage2Prompt(
  input: CreativeBriefInput,
  ctx: EnrichedContext,
  stage1: Record<string, unknown>,
  layout: Layout
): { systemPrompt: string; userPrompt: string } {
  const ref = REFERENCE_EXAMPLE[layout];
  const visualAnchor = String(stage1.visual_anchor ?? '');
  const adCopy = (stage1.ad_copy ?? {}) as Record<string, string>;

  const userPrompt = `# CREATIVE BRIEF — STAGE 2 (image prompt, layout: ${ref.paradigm})

## CAMPAIGN CONTEXT
${campaignContextBlock(input, ctx)}

## BRAND IDENTITY
${brandIdentityBlock(ctx)}

## VISUAL ANCHOR (reproduce this building/scene VERBATIM in Section 1 — do not invent a different building)
${visualAnchor || 'No visual anchor provided — use CAMPAIGN CONTEXT to establish the building.'}

## APPROVED AD COPY (use these exact values in Section 6 — do not paraphrase or invent new copy)
${JSON.stringify(adCopy, null, 2)}

---

## YOUR TASK

Produce ONE GPT-Image-1 image generation prompt for aspect ratio ${ref.aspect}, layout paradigm ${ref.paradigm}.

CRITICAL — exactly nine section headers, in order, each on its own line: SECTION 1: SCENE NARRATIVE / SECTION 2: SUBJECT & COMPOSITION / SECTION 3: CAMERA & LENS / SECTION 4: LIGHTING / SECTION 5: COLOR PALETTE / SECTION 6: TYPOGRAPHY LAYER / SECTION 7: BRAND & PROJECT ELEMENTS / SECTION 8: NEGATIVE PROMPTS / SECTION 9: TECHNICAL SPECS

CRITICAL — colors: every Color field in Section 6 must be a hex code from BRAND IDENTITY, never a name like "gold" or "navy".
CRITICAL — currency: every price in Section 6 MUST use ₹ or "Rs." — never $ or USD.
CRITICAL — no placeholders: use the real APPROVED AD COPY values, never a placeholder like "NAYAPALLI, BBSR" or "+91-XXXXXXXXXX".
500-800 words total.

━━━ REFERENCE EXAMPLE — ${ref.paradigm} ━━━

${ref.example}

━━━ END REFERENCE EXAMPLE ━━━

Respond with ONLY the raw nine-section prompt as plain text — NOT JSON, no wrapping braces or quotes, no markdown fences, no preamble. Start directly with "SECTION 1: SCENE NARRATIVE".`;

  return { systemPrompt: AANYA_SYSTEM_PROMPT_STAGE2, userPrompt };
}

function parseAanyaJson(res: Record<string, unknown>): Record<string, unknown> | null {
  if (res.error) return null;
  if (!res.raw) return res;
  const s = String(res.raw);
  try { return JSON.parse(s); } catch { /* continue */ }
  try { return JSON.parse(s.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); } catch { /* continue */ }
  const st = s.indexOf('{');
  const en = s.lastIndexOf('}');
  if (st !== -1 && en !== -1) {
    try { return JSON.parse(s.substring(st, en + 1)); } catch { /* continue */ }
  }
  return null;
}

/**
 * Orchestrates Stage 1 (concept/copy/visual_anchor) then N parallel Stage 2
 * calls (one per layout). Returns the same envelope shape as aiCall()
 * (`.error`, or parsed SeniorDesignerResult fields + `_inputTokens`/
 * `_outputTokens`) so existing callers' parsing code needs no changes.
 */
export async function runTwoStageSeniorDesigner(
  input: CreativeBriefInput,
  opts: { traceNamePrefix?: string; layouts?: Layout[] } = {}
): Promise<Record<string, unknown>> {
  const layouts = opts.layouts ?? (['main', 'portrait', 'story'] as Layout[]);
  const tracePrefix = opts.traceNamePrefix ?? 'senior-designer';

  const ctx = await loadEnrichedContext(input);
  const stage1Brief = buildStage1Prompt(input, ctx);
  const stage1Res = await aiCall(stage1Brief.userPrompt, stage1Brief.systemPrompt, 4096, { traceName: `${tracePrefix}-stage1` });

  if (stage1Res.error) return { error: stage1Res.error };

  const stage1Parsed = parseAanyaJson(stage1Res);
  if (!stage1Parsed) return { error: 'Aanya Stage 1 (concept/copy) response could not be parsed as JSON.' };

  let inputTokens = (stage1Res._inputTokens as number) ?? 0;
  let outputTokens = (stage1Res._outputTokens as number) ?? 0;

  const stage2Results = await Promise.all(layouts.map(async (layout) => {
    const brief = buildStage2Prompt(input, ctx, stage1Parsed, layout);
    const res = await aiCall(brief.userPrompt, brief.systemPrompt, 4096, { traceName: `${tracePrefix}-stage2-${layout}` });
    return { layout, res };
  }));

  const merged: Record<string, unknown> = { ...stage1Parsed };
  for (const { layout, res } of stage2Results) {
    inputTokens += (res._inputTokens as number) ?? 0;
    outputTokens += (res._outputTokens as number) ?? 0;
    if (res.error) continue;
    // Stage 2 asks for plain text (see AANYA_SYSTEM_PROMPT_STAGE2), so the
    // expected shape is aiCall's { raw: string } fallback. Also accept an
    // accidental JSON-wrapped response defensively, in case the model
    // wraps it anyway despite the instruction.
    const promptText = typeof res.raw === 'string'
      ? res.raw.trim()
      : typeof res.nanobanana_prompt === 'string'
        ? res.nanobanana_prompt.trim()
        : null;
    if (promptText) merged[`nanobanana_prompt_${layout}`] = promptText;
  }

  if (!merged.nanobanana_prompt_main && layouts.includes('main')) {
    return { error: 'Aanya Stage 2 (main layout image prompt) failed for all attempts.' };
  }

  merged._inputTokens = inputTokens;
  merged._outputTokens = outputTokens;
  return merged;
}

export const VARIANT_ANGLES: Array<{ label: 'A' | 'B' | 'C'; angle: string }> = [
  { label: 'A', angle: 'price_led_with_urgency' },
  { label: 'B', angle: 'lifestyle_aspirational' },
  { label: 'C', angle: 'trust_legacy_or_amenity' },
];

// QUICK GENERATE, two-stage — drop-in replacement for
// buildQuickGenerateBrief() + aiCall() in Strategy.tsx's handleQuickSubmit.
export async function runTwoStageQuickGenerate(
  args: {
    user_brief: string;
    project_id?: string;
    project_data?: ProjectData;
    campaign_goal?: CreativeBriefInput['campaign_goal'];
    funnel_stage?: CreativeBriefInput['funnel_stage'];
    placement?: CreativeBriefInput['placement'];
    languages: string[];
    quick_references?: QuickReference[];
    ad_platform?: AdPlatform;
  },
  // layouts passthrough lets replicate mode generate only 'main' (one Stage 2
  // call) since it renders a single image at the reference's aspect.
  opts: { traceNamePrefix?: string; layouts?: Layout[] } = {}
): Promise<Record<string, unknown>> {
  return runTwoStageSeniorDesigner({
    user_brief: args.user_brief,
    project_id: args.project_id,
    project_data: args.project_data,
    campaign_goal: args.campaign_goal || 'lead_generation',
    funnel_stage: args.funnel_stage || 'BOFU',
    placement: args.placement || 'feed_square',
    languages: args.languages,
    quick_references: args.quick_references,
    ad_platform: args.ad_platform,
  }, opts);
}

// AD CREATIVES MODULE variant, two-stage — drop-in replacement for a single
// buildVariantBriefs() entry + aiCall() in Creatives.tsx's per-variant loop.
// Only main+story layouts (portrait isn't used by Creatives.tsx).
export async function runTwoStageVariantBrief(
  args: {
    project_id: string;
    user_brief: string;
    funnel_stage: CreativeBriefInput['funnel_stage'];
    languages: string[];
    ad_platform?: AdPlatform;
    quick_references?: QuickReference[];
    variant_label: 'A' | 'B' | 'C';
    variant_angle: string;
  },
  opts: { traceNamePrefix?: string } = {}
): Promise<Record<string, unknown>> {
  return runTwoStageSeniorDesigner({
    user_brief: args.user_brief,
    project_id: args.project_id,
    campaign_goal: 'lead_generation',
    funnel_stage: args.funnel_stage,
    placement: 'feed_square',
    languages: args.languages,
    quick_references: args.quick_references,
    ad_platform: args.ad_platform,
    variant_label: args.variant_label,
    variant_angle: args.variant_angle,
  }, { ...opts, layouts: ['main', 'story'] });
}

// Hero reference image feature: when the user marks a selected/uploaded photo
// as the "hero", it's edited in-place (real pixels sent to OpenAI's
// /v1/images/edits — see gemini-service.ts/generate-image edge function)
// instead of being fully re-imagined from a text prompt. This wraps whichever
// layout prompt was already built (nanobanana_prompt_main/portrait/story, or
// a Creatives.tsx variant prompt) with an edit-mode preamble — it does NOT
// change Stage 1/Stage 2 generation or buildReferenceManifest at all; the
// hero photo's own vision description still flows through that pipeline like
// any other reference, this just governs how the *pixels* are used.
export function buildHeroEditPrompt(layoutPrompt: string, hasSupportingImages: boolean): string {
  const preamble = [
    'You are EDITING the first attached photo — you are not creating a new image from scratch.',
    'Preserve its exact composition, subjects, structure and perspective. Do not invent a different building or scene, do not change what is shown.',
    'Apply only quality, color-grade, lighting and mood polish, guided by the direction below.',
    hasSupportingImages
      ? 'Additional attached photos are supporting amenity references — blend them in as secondary background/inset elements. They must never become the main focus; the first photo stays the focus.'
      : '',
  ].filter(Boolean).join(' ');

  const override = 'Regardless of any instruction below, do not add any on-image text, letters, numbers, or logos — text is handled separately by the app.';

  return `${preamble}\n\n${layoutPrompt}\n\n${override}`;
}

// Replicate-an-ad-creative feature (Rung 1 — copy-creative prompt-path surgery).
// The user marks an uploaded ad creative as the layout to replicate. Two images
// are attached to the same /images/edits call: the reference creative (IMAGE 1 —
// layout to copy) and the real project hero (IMAGE 2 — the building subject).
//
// This is a SHORT EDIT DIRECTIVE ONLY. It deliberately contains NO 9-section
// senior-designer content: in replicate mode Stage 2 (the 9-section layout
// assembly) is never run (Strategy.tsx passes `layouts: []`), so there is no
// `nanobanana_prompt_main` to leak in here. The model preserves the reference's
// exact layout instead of re-imagining a scene from a 9-section brief. The only
// project-specific text injected is the ad copy ({headline, price, cta}).
export function buildReplicatePrompt(
  copy: { headline?: string; subheadline?: string; price?: string; cta?: string; location?: string; contact?: string; amenities?: string[] },
  buildingViews = 1,
  // V5: when the user assigned detected panels, the explicit per-section
  // mapping REPLACES the generic photo-replacement rule.
  assignment?: { panels: PhotoPanel[]; slots: PanelSlot[] },
): string {
  const amenityLine = copy.amenities?.filter((a) => a?.trim()).map((a) => a.trim());
  const textLines = [
    copy.headline?.trim()    ? `- Headline text: "${copy.headline.trim()}"` : '',
    copy.subheadline?.trim() ? `- Subheadline text: "${copy.subheadline.trim()}"` : '',
    copy.price?.trim()       ? `- Price text: "${copy.price.trim()}"` : '',
    copy.location?.trim()    ? `- Location text: "${copy.location.trim()}"` : '',
    copy.contact?.trim()     ? `- Contact text: "${copy.contact.trim()}"` : '',
    copy.cta?.trim()         ? `- Call-to-action text: "${copy.cta.trim()}"` : '',
    amenityLine?.length      ? `- Amenity/detail labels (assign in order to the badge/stat/checklist cells): ${amenityLine.map((a) => `"${a}"`).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  // RB-P6/P8 — INVARIANT pattern (same as the blank variant, but text is REPLACED
  // with our copy rather than emptied). Layout FIXED; building + text CHANGE.
  return [
    'You are EDITING using two attached images — do not create from scratch.',
    'INVARIANT — preserve the ENTIRE layout of IMAGE 1 EXACTLY: its zone structure, every panel, band, frame, card, strip, badge, button and decorative element, all of its colour blocks, its aspect ratio, and its composition geometry (relative positions, proportions, alignment). Do NOT move, resize, add, remove, or restyle any shape or zone. The composition is FIXED.',
    buildingAngleDirective(buildingViews),
    assignment?.panels.length
      ? buildPanelAssignmentDirective(assignment.panels, assignment.slots)
      : buildPhotoReplacementDirective(),
    textLines
      ? `CHANGE (b) — text: replace the text CONTENT inside the existing zones with this project's copy — use these EXACT strings (in quotes), keeping each zone's exact position, shape, colour and styling:\n${textLines}`
      : 'CHANGE (b) — text: keep the existing text zones exactly in place (shape, position, styling).',
    // RB-P8 STEP 2 — copy integrity: prevents the SCHEDD-33 leak class (the reference
    // ad's own headline/price/phone bleeding through into our output).
    'COPY INTEGRITY — ABSOLUTE: every readable character in the output MUST come from the EXACT strings above and nothing else. NEVER reproduce, paraphrase, or leave any text from image 1 (its headline, price, digits, phone, tagline, company name — none).',
    // RB-P10 STEP 2 — AI-designed empty rule: DISSOLVE uncopied text containers
    // (unlike blank mode, which keeps them empty as chip targets).
    'For any text zone that has NO corresponding string above: DISSOLVE it — REMOVE that container/panel/band/pill entirely and let the surrounding design/background continue seamlessly through where it was. Do NOT leave an empty panel, and NEVER fill it with reference text or invented text. (Only zones that receive one of the exact strings above keep their container.)',
    'Competitor identity: remove image 1\'s logo, brand marks, wordmarks, emblems, QR codes, watermarks, company name and its specific phone-number digits. This project supplies its own logo/price/contact via the strings above; never copy them from image 1.',
    'Change nothing else — no new elements, no extra text, no invented building details beyond the two attached images.',
  ].join('\n\n');
}

// Overlay-pipeline variant: the model produces a clean TEMPLATE (layout + building
// only) and renders NO text — the app composites real, legible copy per the
// vision-located zones afterwards (buildLayersFromZones + renderTextLayers). This
// sidesteps GPT-Image-1's text-rendering unreliability entirely: text no longer
// costs the model anything, so dense stat-rows/checklists stay perfectly legible.
/**
 * RB-P9 — two-tier building-angle policy shared by both replicate directives.
 * `buildingViews` = how many photos of the building are attached AFTER the layout
 * reference (IMAGE 1). 1 → ANGLE-LOCK (render IMAGE 2's exact viewpoint, never
 * invent unseen sides). 2+ → VIEW-BOUNDED freedom (pick the best-fitting provided
 * view, never blend the views into a new structure, never invent unseen sides).
 */
export function buildingAngleDirective(buildingViews: number): string {
  if (buildingViews >= 2) {
    // Robust to mixed additional media (RB-P10): IMAGE 2 is the building; extra
    // exterior views of it MAY be among the provided images — don't assume ALL are.
    return "CHANGE (a) — building, VIEW-BOUNDED: IMAGE 2 is the building; one or more ADDITIONAL exterior views of the SAME building may also be among the provided images. When rendering the building, use ONLY a provided true view of it — SELECT the view that best fits image 1's photo area and use it faithfully. Do NOT blend, merge, or interpolate views into a new or composite structure, and NEVER invent a side, face, wing, or floor not visible in any provided view.";
  }
  return "CHANGE (a) — building, ANGLE-LOCK: only ONE view of the building is provided (IMAGE 2). Render the building from IMAGE 2's EXACT viewpoint and angle — do NOT rotate it, show a different side, or invent any face, wing, or side not visible in IMAGE 2. Adapt the surrounding scene (sky, ground, landscaping, lighting) around that fixed view. Image 1 supplies the LAYOUT only; image 2 supplies the BUILDING at its one true angle.";
}

/**
 * RB-P10 (Finding A) — replace EVERY photograph in image 1 with our project media;
 * never retain the reference's imagery. Shared by both replicate directives.
 */
/**
 * V5 — EXPLICIT per-panel assignment, replacing buildPhotoReplacementDirective's
 * generic "one image per photo zone, empty the rest" for references where the
 * panels were detected and the user assigned them.
 *
 * Why this exists: RB-P10 STEP 3 proved the run-out→emptied-block half of the
 * generic rule is a soft preference the model silently ignores — with no
 * additional media it invented plausible amenity photos instead. Naming each
 * section and stating its fate individually ("section 3 → EMPTY") converts that
 * preference into a per-slot instruction, which is the whole point of V5.
 *
 * Image numbering must match the payload exactly: IMAGE 1 = layout reference,
 * IMAGE 2 = hero, then slot-ordered media from IMAGE 3. Callers build the
 * payload with slotMediaInOrder() so the two agree by construction.
 */
export function buildPanelAssignmentDirective(panels: PhotoPanel[], slots: PanelSlot[]): string {
  if (!panels.length || !slots.length) return '';
  let nextImage = 3;
  const lines: string[] = [];
  const emptied: number[] = [];

  for (const p of [...panels].sort((a, b) => a.index - b.index)) {
    const slot = slots.find((s) => s.panelIndex === p.index);
    const where = `photo section ${p.index} (${panelPositionLabel(p)}, ${p.shapeHint})`;
    if (slot?.source === 'hero') {
      lines.push(`- ${where} → IMAGE 2 (the building). Fit it to that section's exact shape and crop.`);
    } else if (slot?.source === 'media' && slot.mediaUrl) {
      lines.push(`- ${where} → IMAGE ${nextImage}. Fit it to that section's exact shape and crop.`);
      nextImage += 1;
    } else {
      lines.push(`- ${where} → EMPTY: render it as a flat, empty design block in the layout's own palette. No photograph of any kind.`);
      emptied.push(p.index);
    }
  }

  return [
    `CHANGE (a2) — PHOTO SECTION ASSIGNMENT (explicit, per section). Image 1's layout contains ${panels.length} photo section${panels.length === 1 ? '' : 's'}, assigned as follows:`,
    lines.join('\n'),
    'NEVER retain, reuse, or reproduce ANY photograph, person, face, human figure, or property imagery from IMAGE 1 — image 1 supplies the LAYOUT ONLY.',
    emptied.length
      ? `ABSOLUTE — sections ${emptied.map((i) => `#${i}`).join(', ')} are marked EMPTY: do NOT invent, generate, imagine, or substitute ANY photograph for them, and do NOT copy image 1's photo into them. An empty section must render as a plain colour block. This is a hard requirement, not a preference.`
      : '',
  ].filter(Boolean).join('\n\n');
}

export function buildPhotoReplacementDirective(): string {
  return "CHANGE (a2) — REPLACE ALL PHOTOGRAPHY: every photograph in image 1 MUST be replaced with this project's own images. The MAIN building photo → the building from the hero photo (IMAGE 2). Any OTHER photo zone (amenity thumbnail, interior shot, lifestyle/facility photo, a photo card in a strip or grid) → the ADDITIONAL project images provided after the hero (IMAGES 3..N), one image per photo zone, fitted to that zone's exact shape and crop. If the provided images run out, render the remaining photo zones as EMPTIED design blocks in the layout's own palette (a flat/soft-coloured placeholder, NOT a copied photo). NEVER retain, keep, reuse, or reproduce ANY photograph, person, face, human figure, or property imagery from image 1 — image 1 supplies the LAYOUT ONLY.";
}

export function buildReplicateLayoutPrompt(
  buildingViews = 1,
  assignment?: { panels: PhotoPanel[]; slots: PanelSlot[] },
): string {
  // RB-P6 STEP 3 — INVARIANT pattern (replaces the RB-P5 shape-ban, which caused
  // layout drift by asking the model to remove panels). The layout is FIXED; only
  // the building and the text CHANGE. Blank mode empties the lettering out of the
  // shapes, but the shapes themselves stay — so the app can composite crisp copy
  // back into exactly the same zones.
  return [
    'You are EDITING using two attached images — do not create from scratch.',
    'INVARIANT — preserve the ENTIRE layout of IMAGE 1 EXACTLY: its zone structure, every panel, band, frame, card, strip, badge, button and decorative element, all of its colour blocks, its aspect ratio, and its composition geometry (relative positions, proportions, alignment). Do NOT move, resize, add, remove, or restyle any shape or zone. The composition is FIXED.',
    buildingAngleDirective(buildingViews),
    assignment?.panels.length
      ? buildPanelAssignmentDirective(assignment.panels, assignment.slots)
      : buildPhotoReplacementDirective(),
    'CHANGE (b) — text, remove ALL lettering, glyphs, numbers, words, wordmarks and readable characters of ANY script (Latin, Devanagari, Arabic, CJK — none). Handle it in TWO cases by whether the text has a container behind it:',
    'CASE 1 — text INSIDE a panel, band, pill, badge, button, card or coloured plate: REMOVE the text but KEEP that container exactly as it is (same shape, fill, colour, opacity, position), now EMPTY. Do NOT collapse, shrink, delete or fill-in the container because its text is gone — the app composites real copy back into it.',
    'CASE 2 — text sitting DIRECTLY on the background or photo (a floating headline, a caption over the sky, free-standing digits with NO container behind them): REMOVE it ENTIRELY and let the background continue SEAMLESSLY through where it was. Do NOT leave behind a pill, plate, box, bar or coloured patch where floating text used to be — that area becomes clean background, as if text were never there.',
    'Render ZERO readable characters either way.',
    'Competitor identity: remove image 1\'s logo, brand marks, wordmarks, emblems, QR codes, watermarks, company name and phone numbers. If the identity sat in a container, leave that container empty (Case 1); if it floated on the background, clear it seamlessly (Case 2). This project adds its own logo/contact separately.',
    'Change nothing else — no new elements, no invented building details beyond the two attached images.',
  ].join('\n\n');
}

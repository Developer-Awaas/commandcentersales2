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
  url: string;
  user_intent: string; // what the user said this image is for
  role_hint?: string; // optional role hint
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

RULE 1 — BRAND KIT COMPLIANCE (CRITICAL): You use ONLY the hex codes provided in the BRAND IDENTITY section of each brief. You NEVER invent colors. You NEVER substitute thematically (forest green for "zen", red for "urgency", teal for "calm"). If the brief gives you #1A3A5C navy, #C9A961 gold, #D4A574 bronze — those are the ONLY colors permitted in Section 5 of your output. A senior designer at Lodha or Sobha would be fired for inventing brand colors. So would you.

RULE 2 — FLUX IMAGE PROMPT FORMAT: nanobanana_prompt_main must be a concise natural-language visual description, 80–150 words. NO section headers. NO typography instructions (text overlays are handled separately by the UI). Structure: [cinematic scene description] → [subject & composition] → [lens & camera angle] → [lighting: time, Kelvin, shadows] → [brand color palette: exact hex codes only] → [style & mood] → [negative prompts]. Comma-separated phrases are encouraged. This prompt is fed directly to a FLUX diffusion model — long structured documents are ignored.

RULE 3 — NO TEXT IN IMAGE PROMPT: Never instruct the image model to render text, headlines, CTAs, price tags, or logos. The UI overlays these as CSS layers. Including typography instructions degrades image quality without producing readable text.

RULE 4 — PHOTOGRAPHIC TERMINOLOGY: Name a specific lens (24mm wide-angle, 35mm prime, 50mm natural, 85mm portrait), shot type (architectural, three-quarter, low-angle, aerial), and color temperature in Kelvin. Generic phrases like "good shot" are forbidden.

RULE 5 — BRAND COLORS ONLY: Color palette uses ONLY the hex codes provided in BRAND IDENTITY. Never invent colors. Never substitute thematically.

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
        refs.push(`Image ${imgIndex} [USER_QUICK_REF]: User uploaded for: "${ref.user_intent}". ${ref.role_hint || 'Use as visual reference for the stated purpose.'}`);
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
` : 'BRAND KIT: Not configured. Use sensible defaults for premium Indian real estate.'}

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

Produce a Nanobanana image generation prompt for ${aspectRatio}.

CRITICAL CHECK BEFORE YOU WRITE: Look at the BRAND IDENTITY section above. Note the exact hex codes provided. Section 5 of your output MUST use ONLY those hex codes. If brand says #1A3A5C navy and #C9A961 gold, your Section 5 uses #1A3A5C and #C9A961 — NOT #1B4332, NOT #2DD4A8, NOT any other invented color.

REFERENCE EXAMPLE of a correctly formatted nanobanana_prompt_main (FLUX-optimized, ~120 words):

"Photorealistic architectural real estate advertisement. Contemporary 8-storey residential tower in Nayapalli, Bhubaneswar. Three-quarter low-angle exterior shot, 24mm wide-angle lens, building occupying right two-thirds of frame, soft-focus landscaped courtyard in foreground. Golden hour backlighting at 06:45 IST, warm 3200K, long east-west shadows across paving stones, eastern facade catching direct sun. Brand palette: deep navy #1A3A5C as dominant background tone, muted gold #C9A961 as accent on facade details and trim, warm bronze #D4A574 for landscape elements. Premium minimal aesthetic — editorial, architectural, restrained. Clean sky backdrop, tilt-shift straight verticals. No text, no logos, no watermarks, no people with forced expressions, no AI abstract gradients, no colors outside the navy-gold-bronze palette. Photorealistic, 4K, Sobha-Lodha campaign quality."

Now produce YOUR creative brief in the same concise FLUX format. Use ONLY the hex codes from BRAND IDENTITY. Output ONLY the JSON object — no markdown fences, no preamble.

OUTPUT JSON SCHEMA:

{
  "creative_concept": "1-line concept statement",
  "designer_rationale": "Aanya's POV: why this concept for this brief, 2-3 sentences. Reference design DNA if available.",
  "nanobanana_prompt_main": "Concise FLUX image generation prompt, 80-150 words, natural language, no section headers, no text/logo/typography instructions. Visual description only: scene, composition, lens, lighting (Kelvin), brand hex colors, style, negative prompts.",
  ${input.placement === 'feed_square' ? `"nanobanana_prompt_story": "Same concept adapted for 1080x1920 story/reel format — adjust composition for vertical frame",` : ''}
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
    "all_nine_sections_present": true,
    "section_5_uses_only_brand_kit_hex_codes": true,
    "section_1_is_narrative_not_keywords": true,
    "section_3_names_specific_lens_mm": true,
    "section_4_names_specific_lighting_setup": true,
    "no_invented_colors": true
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

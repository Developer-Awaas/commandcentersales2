/**
 * Server-side port of AanyaMemory.tsx's 9-section Haiku vision analysis.
 *
 * The original (`analyzeCreativeWithVision` in src/pages/AanyaMemory.tsx) is
 * client-side only — it calls the claude-proxy Edge Function via
 * supabase.functions.invoke(), which only exists in a browser context.
 * canva-sync-design is itself a server-side Edge Function, so it can't
 * import that React-adjacent code; this module reimplements the same
 * prompt/schema as a direct Anthropic API call instead (the pattern
 * already used by kavya.ts/dhruv.ts/diya.ts for their own vision/LLM
 * calls), so it's genuinely the same analysis, just running server-side.
 *
 * Used by the Canva versioned edit-tracking flow to build a structured
 * before/after edit summary — see canva-sync-design/index.ts.
 */

import { langfuseGeneration } from './langfuse.ts'
import { parseJsonObject } from './agents/json-extract.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const VISION_MODEL = 'claude-haiku-4-5-20251001'

export interface VisionAnalysis {
  description?: string
  patterns?: string[]
  section_1_scene_type?: string
  section_3_lens?: string
  section_4_lighting?: string
  section_5_hex_colors?: string[]
  section_6_typography_elements?: string[]
  composition_split?: string
  competitive_strengths?: string[]
  avoid_reasons?: string[]
}

const VISION_PROMPT = `You are Aanya Mehta, Senior Creative Director for Indian real estate advertising. Analyze this ad creative and extract structured design intelligence for image generation.

Return a JSON object with exactly these fields:
{
  "description": "2-3 sentence visual summary: layout type, dominant visual, color palette, typography style, mood",
  "patterns": ["layout: ...", "color: ...", "typography: ...", "composition: ...", "mood: ..."],
  "section_1_scene_type": "one of: GRAPHIC_DESIGN_FRAME | PHOTOREALISTIC_SCENE | TYPOGRAPHY_FORWARD",
  "section_3_lens": "e.g. 24mm wide-angle low-angle | 85mm portrait three-quarter | 35mm eye-level",
  "section_4_lighting": "e.g. Golden hour 3200K directional east shadows | Overcast diffused 5500K | Studio soft 4000K",
  "section_5_hex_colors": ["#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "section_6_typography_elements": ["ELEMENT_TYPE: style description"],
  "composition_split": "e.g. 60% visual / 40% info zone | 70% hero photo / 30% text overlay",
  "competitive_strengths": ["specific element that makes this ad effective"],
  "avoid_reasons": ["element that weakens this ad, if any"]
}

For section_6_typography_elements use these element type names: MIXED_WEIGHT_HEADLINE | PRICE_BADGE | PHOTO_CAPTION_BAR | FEATURE_CHECKLIST | FOOTER_STRIP | CTA_BUTTON | SUBHEADLINE | TAGLINE.
For section_5_hex_colors: read or estimate the 3-5 most dominant hex values visible in the image.
Return ONLY the JSON object, no markdown, no preamble.`

/**
 * Fail-soft, matching the client-side original — a vision-analysis failure
 * must never break the Canva export flow itself, only leave edit_summary
 * incomplete.
 */
export async function analyzeCreativeVision(
  imageUrl: string,
  traceId?: string,
): Promise<VisionAnalysis | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return null

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: VISION_PROMPT },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      if (traceId) {
        await langfuseGeneration(traceId, {
          name: 'canva-edit-vision-analysis', model: VISION_MODEL,
          level: 'ERROR', statusMessage: `${res.status}: ${errText}`,
        })
      }
      return null
    }

    const data = await res.json()
    const rawText: string = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')
    const parsed = parseJsonObject<VisionAnalysis>(rawText)

    if (traceId) {
      await langfuseGeneration(traceId, {
        name: 'canva-edit-vision-analysis', model: VISION_MODEL,
        input: { imageUrl }, output: parsed,
        inputTokens: data?.usage?.input_tokens, outputTokens: data?.usage?.output_tokens,
      })
    }
    return parsed
  } catch (err) {
    if (traceId) {
      await langfuseGeneration(traceId, {
        name: 'canva-edit-vision-analysis', model: VISION_MODEL,
        level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error',
      })
    }
    return null
  }
}

export interface EditSummary {
  text_changed: boolean
  layout_changed: boolean
  color_changed: boolean
  imagery_changed: boolean
  before: VisionAnalysis | null
  after: VisionAnalysis | null
}

function sameSet(a?: string[], b?: string[]): boolean {
  const as = new Set((a ?? []).map((s) => s.toLowerCase().trim()))
  const bs = new Set((b ?? []).map((s) => s.toLowerCase().trim()))
  if (as.size !== bs.size) return false
  for (const v of as) if (!bs.has(v)) return false
  return true
}

/**
 * Pure structural comparison — no extra LLM call. Coarse but transparent:
 * each category is "changed" if the corresponding field(s) differ between
 * the two independently-generated analyses.
 */
export function diffVisionAnalyses(
  before: VisionAnalysis | null,
  after: VisionAnalysis | null,
): EditSummary {
  return {
    text_changed: !sameSet(before?.section_6_typography_elements, after?.section_6_typography_elements),
    layout_changed: before?.composition_split !== after?.composition_split
      || before?.section_1_scene_type !== after?.section_1_scene_type,
    color_changed: !sameSet(before?.section_5_hex_colors, after?.section_5_hex_colors),
    imagery_changed: before?.section_3_lens !== after?.section_3_lens
      || before?.section_4_lighting !== after?.section_4_lighting,
    before,
    after,
  }
}

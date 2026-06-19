/**
 * Diya — brand manager specialist. Two jobs:
 *   1. runBrandConfirm  — confirms which brand kit applies (or that none
 *      does) before any creative is checked against it.
 *   2. runBrandCheck    — a VISION call per generated creative, judging it
 *      against the kit. Replaces the Phase 3 placeholder brand_check that
 *      aanya.ts attaches to every variant.
 *
 * INVARIANT: this module is SERVER-SIDE ONLY, invoked exclusively by
 * aarav-orchestrate, same rules as arjun.ts/aanya.ts:
 *   - never imported under src/
 *   - never exposed as its own routable Edge Function
 *
 * INVARIANT: no Aanya creative reaches the user without passing through
 * runBrandCheck — aarav-orchestrate calls it unconditionally on every
 * variant Aanya returns, on both the normal turn and the regenerate turn.
 *
 * INVARIANT: vision sees image URLs (passed straight to the Anthropic API
 * as an image source); Langfuse only ever receives the verdict + cost
 * metadata, never the image itself.
 *
 * Fail-safe by design: a missing brand kit, a parse failure, or an API
 * error all resolve to status 'flag' with an explanatory note — never a
 * fabricated 'pass' and never an unhandled crash. See README-style comments
 * inline at each of those branches.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { loadAgentPrompt } from './prompts.ts'
import { parseJsonObject } from './json-extract.ts'
import { langfuseGeneration } from '../langfuse.ts'
import type { CreativeVariant, CreativeBrandCheck } from './aanya.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
// Per BuildSpec §6.5: Claude Sonnet 4.6 WITH VISION — Diya must look at the
// rendered creative, not just reason about its prompt/copy (unlike Aanya's
// text-only critique loop).
const DIYA_MODEL = 'claude-sonnet-4-6'

export interface BrandKitRow {
  primary_color: string
  secondary_color: string
  accent_color: string
  text_color: string
  background_color: string
  primary_font: string
  brand_voice: string
  design_aesthetic: string
  cultural_motifs: string[]
  logo_color_url: string
}

export interface BrandVerdict {
  status: 'pass' | 'flag'
  notes: string
  // Keyed by CreativeVariant.id — present on runBrandCheck's result, absent
  // on runBrandConfirm's (there's nothing per-variant to report yet).
  per_variant?: Record<string, CreativeBrandCheck>
}

export interface RunBrandConfirmInput {
  orgId: string
  projectId?: string
}

export interface RunBrandConfirmResult {
  verdict: BrandVerdict
  kit: BrandKitRow | null
}

export interface RunBrandCheckInput {
  orgId: string
  projectId?: string
  variants: CreativeVariant[]
  traceId: string
  // Pass the kit already loaded by runBrandConfirm to avoid a second DB
  // round-trip. Omit to have runBrandCheck load it itself (e.g. the
  // regenerate-creatives path, which doesn't run a separate confirm step).
  kit?: BrandKitRow | null
}

export interface RunBrandCheckResult {
  verdict: BrandVerdict
  model: string
  inputTokens: number
  outputTokens: number
  totalCostUsd: number
}

export class DiyaOutputError extends Error {
  usage?: { inputTokens: number; outputTokens: number }
  constructor(message: string, usage?: { inputTokens: number; outputTokens: number }) {
    super(message)
    this.name = 'DiyaOutputError'
    this.usage = usage
  }
}

// Same per-token rate used by arjun.ts/aanya.ts/aarav-orchestrate.
function claudeCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000
}

// brand_kits is one row per org (UNIQUE org_id, no project_id column) — see
// migration 20260609130000. There is currently no schema support for
// per-project kit overrides, so there is no "ambiguous/multiple kits"
// scenario to disambiguate today; projectId is accepted (and threaded
// through) purely so that future per-project overrides can slot in here
// without changing either function's signature.
async function loadBrandKit(orgId: string): Promise<BrandKitRow | null> {
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data, error } = await adminClient
    .from('brand_kits')
    .select('primary_color, secondary_color, accent_color, text_color, background_color, primary_font, brand_voice, design_aesthetic, cultural_motifs, logo_color_url')
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load brand kit: ${error.message}`)
  return (data as BrandKitRow | null) ?? null
}

// Deterministic DB lookup, not an LLM call — there's nothing to "confirm"
// via reasoning when there's exactly one candidate kit (or zero). Missing
// kit is reported as a clear flag, never a crash, never a fabricated pass.
export async function runBrandConfirm(input: RunBrandConfirmInput): Promise<RunBrandConfirmResult> {
  const kit = await loadBrandKit(input.orgId)

  if (!kit) {
    return {
      kit: null,
      verdict: {
        status: 'flag',
        notes: 'No brand kit configured for this organization — creatives could not be checked against brand colors, fonts, or logo. Set one up under Settings → Brand Kit.',
      },
    }
  }

  return {
    kit,
    verdict: {
      status: 'pass',
      notes: `Using brand kit: primary ${kit.primary_color}, accent ${kit.accent_color}${kit.brand_voice ? `, voice "${kit.brand_voice}"` : ''}.`,
    },
  }
}

function buildKitContext(kit: BrandKitRow): string {
  return [
    `Primary color: ${kit.primary_color}`,
    `Secondary color: ${kit.secondary_color}`,
    `Accent color: ${kit.accent_color}`,
    `Text color: ${kit.text_color}`,
    `Design aesthetic: ${kit.design_aesthetic}`,
    kit.brand_voice ? `Brand voice: ${kit.brand_voice}` : null,
    kit.cultural_motifs?.length ? `Cultural motifs to expect: ${kit.cultural_motifs.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

async function checkOneVariant(
  apiKey: string,
  systemPrompt: string,
  kit: BrandKitRow,
  variant: CreativeVariant,
  traceId: string
): Promise<{ result: CreativeBrandCheck; inputTokens: number; outputTokens: number }> {
  if (!variant.image_url) {
    return { result: { status: 'flag', note: 'No image to inspect for this creative.' }, inputTokens: 0, outputTokens: 0 }
  }

  const userPrompt = `Brand kit:\n${buildKitContext(kit)}\n\nCreative angle: ${variant.angle}\nHeadline: ${variant.copy?.headline ?? '(none)'}`

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: DIYA_MODEL,
        max_tokens: 256,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: variant.image_url } },
            { type: 'text', text: userPrompt },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      throw new Error(`Diya vision call failed (${res.status}): ${errText}`)
    }

    const data = await res.json()
    const inputTokens: number = data?.usage?.input_tokens ?? 0
    const outputTokens: number = data?.usage?.output_tokens ?? 0
    const rawText: string = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')

    await langfuseGeneration(traceId, {
      name: `diya-brand-check-${variant.angle}`,
      input: { angle: variant.angle, headline: variant.copy?.headline },
      // Verdict text only — image bytes/URL deliberately excluded from
      // what's logged to Langfuse beyond the input metadata above.
      model: DIYA_MODEL,
      inputTokens,
      outputTokens,
    })

    const parsed = parseJsonObject<CreativeBrandCheck>(rawText)
    if (parsed.status !== 'pass' && parsed.status !== 'flag') {
      throw new Error(`Diya returned an unrecognized status: ${JSON.stringify(parsed)}`)
    }
    return { result: parsed, inputTokens, outputTokens }
  } catch (err) {
    // A single variant's vision call failing must not silently pass it —
    // fail safe to 'flag' for THIS variant and keep checking the rest.
    const message = err instanceof Error ? err.message : 'Unknown error'
    await langfuseGeneration(traceId, {
      name: `diya-brand-check-${variant.angle}`,
      input: { angle: variant.angle, headline: variant.copy?.headline },
      level: 'ERROR',
      statusMessage: message,
      model: DIYA_MODEL,
    })
    return { result: { status: 'flag', note: 'Brand check failed for this creative — review manually.' }, inputTokens: 0, outputTokens: 0 }
  }
}

export async function runBrandCheck(input: RunBrandCheckInput): Promise<RunBrandCheckResult> {
  const kit = input.kit !== undefined ? input.kit : await loadBrandKit(input.orgId)

  if (!kit) {
    // No kit means nothing to check against — flag every variant for
    // manual review rather than spend on vision calls or fabricate a pass.
    const per_variant: Record<string, CreativeBrandCheck> = {}
    for (const v of input.variants) {
      per_variant[v.id] = { status: 'flag', note: 'No brand kit configured — could not verify brand compliance.' }
    }
    return {
      verdict: { status: 'flag', notes: 'No brand kit configured — all creatives flagged for manual review.', per_variant },
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
    }
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new DiyaOutputError('ANTHROPIC_API_KEY secret is not set')

  const { text: systemPrompt, version } = loadAgentPrompt('diya')
  const versionedSystemPrompt = `${systemPrompt}\n\n[prompt_version: diya ${version}]`

  let totalInputTokens = 0
  let totalOutputTokens = 0
  const per_variant: Record<string, CreativeBrandCheck> = {}

  for (const variant of input.variants) {
    const { result, inputTokens, outputTokens } = await checkOneVariant(apiKey, versionedSystemPrompt, kit, variant, input.traceId)
    per_variant[variant.id] = result
    totalInputTokens += inputTokens
    totalOutputTokens += outputTokens
  }

  const flagged = Object.values(per_variant).filter((v) => v.status === 'flag')
  const verdict: BrandVerdict = {
    status: flagged.length > 0 ? 'flag' : 'pass',
    notes: flagged.length > 0
      ? `${flagged.length} of ${input.variants.length} creatives flagged for review.`
      : `All ${input.variants.length} creatives passed brand check.`,
    per_variant,
  }

  return {
    verdict,
    model: DIYA_MODEL,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalCostUsd: claudeCostUsd(totalInputTokens, totalOutputTokens),
  }
}

/**
 * Aanya — creative director specialist (3 ad creatives: image + copy +
 * rationale, per the value/lifestyle/amenity angles). Derives from Arjun's
 * StrategyConfig and runs a bounded self-critique loop before returning.
 *
 * INVARIANT: this module is SERVER-SIDE ONLY, invoked exclusively by
 * aarav-orchestrate (supabase/functions/aarav-orchestrate/index.ts), same
 * rules as arjun.ts:
 *   - never imported under src/
 *   - never exposed as its own routable Edge Function
 *
 * INVARIANT: image generation ALWAYS goes through the provider abstraction
 * (../image-provider.ts) — this module never constructs an OpenAI/etc.
 * request directly, so a provider swap never touches this file.
 *
 * INVARIANT: the critique loop is capped at MAX_ITERATIONS per variant —
 * there is no code path that can loop past it, even if the analyzer always
 * rejects (best-of-N is returned instead of erroring).
 *
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { loadAgentPrompt, loadAanyaCritiquePrompt } from './prompts.ts'
import { parseJsonObject } from './json-extract.ts'
import { generateImage } from '../image-provider.ts'
import type { StrategyConfig } from './arjun.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const AANYA_MODEL = 'claude-sonnet-4-6' // per BuildSpec §6.5 (amended)
const MAX_ITERATIONS = 3
const PASS_SCORE = 75
const STORAGE_BUCKET = 'brand-assets'

export type CreativeAngle = 'value' | 'lifestyle' | 'amenity'
const ANGLES: CreativeAngle[] = ['value', 'lifestyle', 'amenity']

const ANGLE_LABELS: Record<CreativeAngle, string> = {
  value: 'Price-led with Urgency',
  lifestyle: 'Lifestyle / Aspirational',
  amenity: 'Trust & Legacy / Amenities',
}

// Stub fill color shown client-side only if image_url is ever missing —
// matches CreativeGrid's existing fallback swatches.
const ANGLE_PREVIEW_COLOR: Record<CreativeAngle, string> = {
  value: '#1A3A5C',
  lifestyle: '#7A5C3A',
  amenity: '#3A5C44',
}

export interface CreativeCopy {
  headline: string
  primary_text: string
  cta: string
}

export interface CreativeVariant {
  id: string
  label: string
  angle: CreativeAngle
  preview_color: string
  image_url?: string
  copy?: CreativeCopy
  rationale?: string
}

export interface RunAanyaInput {
  orgId: string
  projectId?: string
  strategy: StrategyConfig
  brandContext?: Record<string, unknown>
  // Nests every observation this run produces under the caller's
  // aarav-orchestrate trace instead of starting a new top-level one.
  traceId: string
  // When set, only this angle is (re)generated — used by the per-tile
  // "Regenerate" action. Omit to generate all three.
  onlyAngle?: CreativeAngle
  // Per-interaction budget ceiling in USD. When set, image generation is
  // gated by a synchronous reserve-before-await pattern so no single
  // interaction can overrun the limit. See BudgetCapError + BudgetTracker.
  // Omit for unlimited (legacy callers / tests that don't need the cap).
  costCeilingUsd?: number
}

export interface RunAanyaResult {
  variants: CreativeVariant[]
  model: string
  inputTokens: number
  outputTokens: number
  // Full loop cost across ALL iterations (ideation + every critique call +
  // every image generation), not just the final accepted pass — this is
  // what makes the provider-benchmark amendment measurable from real data.
  totalCostUsd: number
  iterationsUsed: number
  // true when the budget ceiling truncated at least one angle's critique loop.
  capHit: boolean
}

export class AanyaOutputError extends Error {
  usage?: { inputTokens: number; outputTokens: number }
  constructor(message: string, usage?: { inputTokens: number; outputTokens: number }) {
    super(message)
    this.name = 'AanyaOutputError'
    this.usage = usage
  }
}

// Thrown synchronously by the budget-reservation wrapper inside generateFn
// when the per-interaction cost ceiling would be exceeded by the next image
// generation. _runAnglePipeline catches this from generateFn and either
// returns best-of-current (if any prior image exists) or re-throws (no image
// yet for this angle, so the angle fails gracefully via Promise.allSettled).
export class BudgetCapError extends Error {
  constructor() {
    super('Interaction budget cap reached')
    this.name = 'BudgetCapError'
  }
}

// Simple mutable budget tracker. Mutations are synchronous so they are
// race-free inside Deno's single-threaded isolate — no atomic/lock needed.
// The caller reserves a CONSERVATIVE (rounded-up) estimate BEFORE each
// await, then reconciles the actual cost after.
interface BudgetTracker {
  reserve(amountUsd: number): boolean
  reconcile(reservedUsd: number, actualUsd: number): void
}

function createBudgetTracker(ceilingUsd: number): BudgetTracker {
  let remaining = ceilingUsd
  return {
    reserve(amount) {
      if (amount > remaining) return false
      remaining -= amount
      return true
    },
    reconcile(reserved, actual) {
      // Refund over-reservation (actual ≤ reserved because we round up).
      remaining += Math.max(0, reserved - actual)
    },
  }
}

// Conservative per-image reserve: GPT-Image-1 high-quality list price $0.167,
// rounded up 25% to account for size overages and pricing drift.
// Never under-reserve — the spec requires that the reserve never under-estimates.
const CONSERVATIVE_IMAGE_RESERVE_USD = 0.21

interface IdeatedVariant {
  angle: CreativeAngle
  headline: string
  primary_text: string
  cta: string
  image_prompt: string
  rationale: string
}

interface IdeationResponse {
  variants: IdeatedVariant[]
}

interface CritiqueResult {
  score: number
  pass: boolean
  feedback: string
}

// Same per-token rate used by arjun.ts/aarav-orchestrate — mirrors the
// client-side Reports.tsx formula ((in*$3 + out*$15) / 1M tokens).
function claudeCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Retry on 429 with binary-exp backoff — mirrors image-provider.ts approach.
// Anthropic rate limits: Tier 1 = 50 req/min, well above 3 parallel critique
// calls, but backoff is cheap insurance.
async function callClaude(
  apiKey: string,
  system: string,
  userPrompt: string,
  maxTokens: number,
  maxRetries = 2,
): Promise<{ rawText: string; inputTokens: number; outputTokens: number }> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: AANYA_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText)
        throw new Error(`Aanya LLM call failed (${res.status}): ${errText}`)
      }

      const data = await res.json()
      const inputTokens: number = data?.usage?.input_tokens ?? 0
      const outputTokens: number = data?.usage?.output_tokens ?? 0
      const rawText: string = (data?.content ?? [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('')

      return { rawText, inputTokens, outputTokens }
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('rate limit')
      if (!isRateLimit || attempt === maxRetries) throw err
      const delayMs = Math.min(2000 * Math.pow(2, attempt), 60_000)
      console.warn(`callClaude: 429, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise<void>((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

// ─── Per-angle pipeline (exported for unit testing) ───────────────────────────
//
// Extracted so tests can inject mock generateFn / critiqueFn and verify the
// iteration-cap invariant without real network calls. Product code (runAanya)
// passes the real implementations. Do not call this directly from src/.

export interface _AnglePipelineDeps {
  // Called once per iteration. Returns base64 image + cost for that attempt.
  generateFn: (prompt: string) => Promise<{ imageBase64: string; mimeType: string; costUsd: number }>
  // Parses and returns a CritiqueResult. If it throws, the loop treats the
  // current iteration's image as the best available and stops early.
  critiqueFn: (userPrompt: string) => Promise<CritiqueResult>
}

export interface _AnglePipelineResult {
  bestImageBase64: string
  bestMimeType: string
  imageCostUsd: number
  inputTokens: number
  outputTokens: number
  iterationsUsed: number
  // true when a BudgetCapError from generateFn cut the loop short but a
  // prior-iteration image was available (graceful truncation, no error thrown).
  budgetCapped: boolean
}

// _runAnglePipeline is the critique loop for a single angle. It is
// intentionally pure of storage/network concerns beyond the two injected
// fns so it can be unit-tested with synchronous mocks.
//
// INVARIANT: halts after MAX_ITERATIONS regardless of analyzer output.
// Proof: the loop bound is `attempt <= maxIterations` and the only exit
// paths are (a) critique.pass, (b) attempt === maxIterations (loop end),
// and (c) critiqueFn throws (break). No path can increment `attempt`
// past maxIterations.
export async function _runAnglePipeline(
  idea: IdeatedVariant,
  angle: CreativeAngle,
  deps: _AnglePipelineDeps,
  maxIterations = MAX_ITERATIONS,
): Promise<_AnglePipelineResult> {
  let bestImageBase64: string | null = null
  let bestMimeType = 'image/png'
  let bestScore = -1
  let imagePrompt = idea.image_prompt
  let iterations = 0
  let imageCostUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  let budgetCapped = false

  for (let attempt = 1; attempt <= maxIterations; attempt++) {
    // Try to generate. Catch BudgetCapError specifically so a depleted budget
    // gracefully returns best-so-far instead of surfacing an error to the user.
    // All other errors propagate (image gen outage, etc.).
    let imageResult: { imageBase64: string; mimeType: string; costUsd: number } | null = null
    try {
      imageResult = await deps.generateFn(imagePrompt)
    } catch (err) {
      if (err instanceof BudgetCapError && bestImageBase64) {
        // Cap hit, but we already have an image from a prior iteration → stop.
        budgetCapped = true
        break
      }
      throw err // no prior image OR non-budget error → propagate
    }
    // imageResult is non-null here (catch block always throws or breaks).
    if (!imageResult) break // unreachable; satisfies TypeScript
    iterations = attempt  // only count an iteration where the gen succeeded
    imageCostUsd += imageResult.costUsd

    const critiqueUserPrompt = [
      `Angle: ${angle}`,
      `Rationale: ${idea.rationale}`,
      `Headline: ${idea.headline}`,
      `Primary text: ${idea.primary_text}`,
      `CTA: ${idea.cta}`,
      `Image prompt used: ${imagePrompt}`,
    ].join('\n')

    let critique: CritiqueResult
    try {
      critique = await deps.critiqueFn(critiqueUserPrompt)
      if (typeof critique.score !== 'number') throw new Error('invalid critique shape')
    } catch {
      // Analyzer call failed — accept current image as best-available and stop.
      if (bestScore < 0) {
        bestImageBase64 = imageResult.imageBase64
        bestMimeType    = imageResult.mimeType
        bestScore       = 0
      }
      break
    }

    if (critique.score > bestScore) {
      bestScore       = critique.score
      bestImageBase64 = imageResult.imageBase64
      bestMimeType    = imageResult.mimeType
    }
    // critique calls return tokens only from the real critiqueFn —
    // mock implementations may omit them, so guard with type check.
    const critiqueTokens = critique as unknown as { inputTokens?: number; outputTokens?: number }
    inputTokens  += critiqueTokens.inputTokens  ?? 0
    outputTokens += critiqueTokens.outputTokens ?? 0

    if (critique.pass || attempt === maxIterations) break

    imagePrompt = `${idea.image_prompt}\n\nRevision based on creative-director feedback: ${critique.feedback}`
  }

  if (!bestImageBase64) {
    throw new AanyaOutputError(`Aanya failed to produce any image for angle "${angle}"`, {
      inputTokens, outputTokens,
    })
  }

  return { bestImageBase64, bestMimeType, imageCostUsd, inputTokens, outputTokens, iterationsUsed: iterations, budgetCapped }
}

export async function runAanya(input: RunAanyaInput): Promise<RunAanyaResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret is not set')

  const { text: systemPrompt, version } = loadAgentPrompt('aanya')
  const { text: critiqueSystemPrompt } = loadAanyaCritiquePrompt()

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalImageCostUsd = 0
  let maxIterationsUsed = 0

  // --- Ideation (one call covers all three angles) ---------------------
  const userPrompt = [
    `Strategy: ${JSON.stringify(input.strategy)}`,
    input.brandContext && Object.keys(input.brandContext).length
      ? `Brand context: ${JSON.stringify(input.brandContext)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  let ideation: IdeationResponse
  try {
    const { rawText, inputTokens, outputTokens } = await callClaude(
      apiKey,
      `${systemPrompt}\n\n[prompt_version: aanya ${version}]`,
      userPrompt,
      1536
    )
    totalInputTokens += inputTokens
    totalOutputTokens += outputTokens
    ideation = parseJsonObject<IdeationResponse>(rawText)
    if (!Array.isArray(ideation.variants) || ideation.variants.length < 1) {
      throw new Error('Aanya ideation returned no variants')
    }
  } catch (err) {
    throw new AanyaOutputError(
      err instanceof Error ? err.message : 'Aanya returned unparseable ideation output',
      { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
    )
  }

  const anglesToGenerate = input.onlyAngle ? [input.onlyAngle] : ANGLES
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const runId = crypto.randomUUID()

  // Shared budget tracker. The ceiling is optional — when omitted (legacy
  // callers, tests) a very large ceiling effectively means unlimited.
  // Mutations are synchronous, making reservation race-free in Deno's
  // single-threaded isolate: all three parallel angle pipelines share this
  // object, and each reserves before its await so no two angles can
  // double-reserve the same slice of budget.
  const budget = createBudgetTracker(input.costCeilingUsd ?? Number.MAX_SAFE_INTEGER)

  // Process all angles in parallel via _runAnglePipeline. Each angle's
  // critique loop is sequential within the angle (iteration N depends on
  // N-1's critique), but angles are independent of each other.
  // Parallel execution: worst-case = max(one-angle iterations × cost) ≈ 75s,
  // safely within the 150s Supabase Free/Pro wall-clock limit.
  //
  // Rate limits: image 429s are retried in generateImage (withRetry, 2s→4s
  // exp backoff). Claude critique 429s are retried in callClaude (same).
  // Three concurrent image gens sit within OpenAI Tier 1's 3-concurrent cap.
  const angleSettled = await Promise.allSettled(
    anglesToGenerate.map(async (angle) => {
      const idea = ideation.variants.find((v) => v.angle === angle) ?? ideation.variants[0]
      let angleAttempt = 0

      // Real deps wired to the actual providers. Tests inject mocks instead.
      const deps: _AnglePipelineDeps = {
        generateFn: async (prompt) => {
          angleAttempt++
          // SYNC reserve before the network await — race-free in single-threaded Deno.
          // If the ceiling would be exceeded, throw BudgetCapError immediately so
          // _runAnglePipeline can return best-so-far gracefully.
          if (!budget.reserve(CONSERVATIVE_IMAGE_RESERVE_USD)) {
            throw new BudgetCapError()
          }
          try {
            const r = await generateImage({
              prompt,
              size: '1024x1024',
              quality: 'high',
              traceId: input.traceId,
              observationName: `aanya-image-${angle}-iter${angleAttempt}`,
            })
            // Reconcile: actual cost ≤ reserve, so this refunds any over-reservation.
            budget.reconcile(CONSERVATIVE_IMAGE_RESERVE_USD, r.costMeta.unitCost)
            return { imageBase64: r.imageBase64, mimeType: r.mimeType, costUsd: r.costMeta.unitCost }
          } catch (err) {
            // Non-budget error (network, API outage): refund the reservation so
            // subsequent angles aren't penalised for this angle's failed gen.
            if (!(err instanceof BudgetCapError)) {
              budget.reconcile(CONSERVATIVE_IMAGE_RESERVE_USD, 0)
            }
            throw err
          }
        },
        critiqueFn: async (userPrompt) => {
          const { rawText, inputTokens, outputTokens } = await callClaude(
            apiKey, critiqueSystemPrompt, userPrompt, 256
          )
          const parsed = parseJsonObject<CritiqueResult>(rawText)
          // Piggyback token counts on the return so _runAnglePipeline can
          // accumulate them without needing a separate parameter.
          return Object.assign(parsed, { inputTokens, outputTokens }) as CritiqueResult & { inputTokens: number; outputTokens: number }
        },
      }

      const loop = await _runAnglePipeline(idea, angle, deps)

      // Upload best image to Storage.
      const ext = loop.bestMimeType === 'image/png' ? 'png' : 'jpg'
      const storagePath = `generated-creatives/${input.orgId}/${runId}/${angle}.${ext}`
      const { error: uploadErr } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, base64ToBytes(loop.bestImageBase64), {
          contentType: loop.bestMimeType, upsert: true,
        })
      if (uploadErr) {
        throw new AanyaOutputError(`Storage upload failed for angle "${angle}": ${uploadErr.message}`, {
          inputTokens: loop.inputTokens, outputTokens: loop.outputTokens,
        })
      }
      const { data: urlData } = adminClient.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath)

      return {
        variant: {
          id:            crypto.randomUUID(),
          label:         ANGLE_LABELS[angle],
          angle,
          preview_color: ANGLE_PREVIEW_COLOR[angle],
          image_url:     urlData.publicUrl,
          copy:          { headline: idea.headline, primary_text: idea.primary_text, cta: idea.cta },
          rationale:     idea.rationale,
        } satisfies CreativeVariant,
        imageCostUsd:  loop.imageCostUsd,
        inputTokens:   loop.inputTokens,
        outputTokens:  loop.outputTokens,
        iterations:    loop.iterationsUsed,
        budgetCapped:  loop.budgetCapped,
      }
    })
  )

  // Collect results. Partial success (some angles failed after retry) is
  // surfaced as a degraded turn — aarav-orchestrate renders whatever variants
  // arrived and shows a "Regenerate" option for the missing angles, rather
  // than throwing away all successful work. Only fail if ALL angles failed.
  const variants: CreativeVariant[] = []
  const angleErrors: string[] = []
  let capHit = false

  for (let i = 0; i < angleSettled.length; i++) {
    const r = angleSettled[i]
    if (r.status === 'fulfilled') {
      variants.push(r.value.variant)
      totalImageCostUsd += r.value.imageCostUsd
      totalInputTokens  += r.value.inputTokens
      totalOutputTokens += r.value.outputTokens
      maxIterationsUsed  = Math.max(maxIterationsUsed, r.value.iterations)
      if (r.value.budgetCapped) capHit = true
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : `Angle ${anglesToGenerate[i]} failed`
      angleErrors.push(msg)
      // A BudgetCapError rejection (no prior image for that angle) also counts
      // as a cap hit — the ceiling caused the angle to fail entirely.
      if (r.reason instanceof BudgetCapError) capHit = true
      console.warn(`Aanya angle "${anglesToGenerate[i]}" failed (partial result):`, msg)
    }
  }

  if (variants.length === 0) {
    throw new AanyaOutputError(
      `All angles failed: ${angleErrors.join('; ')}`,
      { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
    )
  }

  return {
    variants,
    model: AANYA_MODEL,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalCostUsd: claudeCostUsd(totalInputTokens, totalOutputTokens) + totalImageCostUsd,
    iterationsUsed: maxIterationsUsed,
    capHit,
  }
}

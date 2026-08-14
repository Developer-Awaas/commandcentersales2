/**
 * Image generation provider abstraction (spec amendment: "Image Generation
 * Provider Abstraction" — image generation must NOT be hardcoded to any one
 * model). This is the ONLY place that should ever construct a request to an
 * image-generation API. Both the `generate-image` Edge Function (called
 * directly by the browser via gemini-service.ts) and `aanya.ts` (server-side
 * specialist, called only from aarav-orchestrate) call THIS module rather
 * than talking to OpenAI/etc. directly.
 *
 * Provider selection: env var IMAGE_PROVIDER, default 'openai'. Add a new
 * case to generateImage()'s switch + a new branch in resolveProvider()'s
 * union to add a provider — no caller code needs to change.
 *
 * Investigated whether Flux should be a second provider here (per the spec
 * amendment prompt): `describeImageForFlux` in src/lib/ai-service.ts is NOT
 * an image generator — it's a Claude-vision helper that produces a text
 * description of an EXISTING image, used as enrichment input to the
 * client-side senior-designer prompt builder. Flux is never actually called
 * as a generator anywhere in this repo.
 *
 * Two real providers are wired up behind this interface: OpenAI GPT-Image-1
 * (default) and Gemini 2.5 Flash Image, added so the §5.5/§6.5 economics and
 * default-provider choice can be made from a real benchmark (see
 * benchmark/image-providers.ts) instead of assumption.
 *
 * True image-to-image editing (real input photo bytes, composition preserved)
 * also routes through here — `editImage()`, calling OpenAI's /v1/images/edits.
 * OpenAI-only; Gemini isn't wired for edits. Used by the hero-reference-image
 * feature (generate-image/index.ts's heroImage/supportingImages params).
 *
 * Image provider API keys (OPENAI_API_KEY, GEMINI_API_KEY) are read from
 * Deno.env here only — never exposed to the client bundle.
 */

import { langfuseTrace, langfuseGeneration } from './langfuse.ts'
import { reserveImageBudget } from './review-budget.ts'

export type ImageProvider = 'openai' | 'gemini'

export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024'
export type ImageQuality = 'low' | 'medium' | 'high'

export interface GenerateImageInput {
  prompt: string
  size?: ImageSize
  quality?: ImageQuality
  providerHint?: ImageProvider
  // When the caller already owns a Langfuse trace (e.g. aanya.ts nesting
  // this under the parent aarav-orchestrate trace), pass it through so the
  // generation observation nests correctly instead of starting a new
  // top-level trace. Leave unset for standalone callers (generate-image).
  traceId?: string
  // Override the Langfuse observation name (defaults to the provider's
  // model name) — useful for "aanya-image-value-iter1"-style naming so
  // iterations are distinguishable in the Langfuse UI.
  observationName?: string
  // RB-P6: per-request model override (spike matrix). Omit → IMAGE_MODEL env / default.
  model?: string
  // Wall-clock bound for the provider call. Omit → the SYNC ceiling for a
  // text-only (zero input image) call.
  timeoutMs?: number
}

export interface ImageCostMeta {
  provider: ImageProvider
  model: string
  unitCost: number
  currency: 'USD'
}

export interface GenerateImageResult {
  imageBase64: string
  mimeType: string
  providerUsed: ImageProvider
  costMeta: ImageCostMeta
}

export interface EditImageInput {
  prompt: string
  size?: ImageSize
  quality?: ImageQuality
  // First entry is the hero/primary photo being edited (composition preserved);
  // any further entries are supporting reference photos (e.g. amenities) the
  // model may blend in as secondary elements. Only OpenAI supports edits today.
  images: { base64: string; mimeType: string }[]
  traceId?: string
  observationName?: string
  // RB-P6: per-request model override (spike matrix). Omit → IMAGE_MODEL env / default.
  model?: string
  // Wall-clock bound for the provider call. Omit → scaled from images.length
  // for the SYNC ceiling. Async callers pass imageFetchTimeoutMs(n,{async:true}).
  timeoutMs?: number
}

function resolveProvider(hint?: ImageProvider): ImageProvider {
  return hint ?? (Deno.env.get('IMAGE_PROVIDER') as ImageProvider | undefined) ?? 'openai'
}

// Exponential back-off on 429 rate-limit errors. Reads Retry-After when
// available (OpenAI/Gemini both set it); otherwise uses binary-exp backoff
// Wall-clock bound for a single provider call. Until 20260811 none of the
// fetches below had a signal at all, so a slow OpenAI response ran until
// Supabase's 150s request ceiling killed it — surfacing to the browser as a
// 504 on a request that never completed. Same class as bugs #35/#41.
//
// 135s sits above the measured worst case (129.4s: gpt-image-2, quality
// 'high', 5 reference images) and below the 150s wall clock, so the call
// fails as a clean, reportable error rather than the isolate being killed
// mid-flight with no terminal state written. It WILL abort a genuinely
// slower-than-measured call — deliberate: a clean failure beats a hung one.
//
// This remains the SYNC ceiling specifically because the 150s request wall
// clock still applies there. It is no longer the only bound — see below.
export const IMAGE_FETCH_TIMEOUT_MS = 135_000

// A flat 135s was sized for the worst case that existed when it was written
// (5 reference images). Replicate mode's per-panel assignment (V5) makes the
// input count user-driven — reference + hero + one photo per assigned panel —
// and each extra input image adds real, roughly linear provider time. A flat
// bound therefore aborts a legitimately-slow 8-image call at exactly the
// moment the work is nearly done, and is simultaneously far too generous for
// a 1-image call that has hung.
//
// Scale it instead: 90s of fixed overhead + 15s per input image, capped at
// 300s. Measured anchor: 129.4s at 5 images sits under 90+75=165s with slack,
// and a 1-image call now fails at 105s instead of 135s.
//
// The 300s cap is only reachable in ASYNC mode (EdgeRuntime.waitUntil, where
// the 150s request ceiling no longer applies because nothing is waiting on
// the response). In SYNC mode the result is clamped back to the 135s constant
// above — raising it there would reintroduce the exact failure it prevents:
// the isolate killed mid-flight at 150s with no terminal state written.
const TIMEOUT_BASE_MS = 90_000
const TIMEOUT_PER_IMAGE_MS = 15_000
const TIMEOUT_ASYNC_CAP_MS = 300_000

export function imageFetchTimeoutMs(
  inputImages = 0,
  opts: { async?: boolean } = {},
): number {
  const scaled = Math.min(
    TIMEOUT_BASE_MS + TIMEOUT_PER_IMAGE_MS * Math.max(0, inputImages),
    TIMEOUT_ASYNC_CAP_MS,
  )
  return opts.async ? scaled : Math.min(scaled, IMAGE_FETCH_TIMEOUT_MS)
}

// capped at 60s. Retries are intentionally limited to 2 (3 total attempts)
// so a genuinely broken key fails fast rather than burning wall-clock time.
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 2,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const isRateLimit =
        msg.includes('429') ||
        msg.toLowerCase().includes('rate limit') ||
        msg.toLowerCase().includes('too many requests')
      if (!isRateLimit || attempt === maxRetries) throw err
      const delayMs = Math.min(2000 * Math.pow(2, attempt), 60_000) // 2s → 4s → 60s cap
      console.warn(`${label}: 429 rate-limited, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise<void>((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

// Approximate published OpenAI gpt-image-1 per-image pricing at 1024x1024,
// by quality tier (USD). Larger sizes cost more — this is a simplification
// for cost-tracking purposes (provider benchmarking per the spec amendment),
// not an invoicing-grade figure. Re-verify against OpenAI's pricing page
// before relying on this for real billing.
export const OPENAI_IMAGE_COST_USD: Record<ImageQuality, number> = {
  low: 0.011,
  medium: 0.042,
  high: 0.167,
}

// RB-P7 STEP 2 — gpt-image-2 per-image pricing (the new default). From OpenAI's
// published rates: text input $5/M, image input $8/M (reference images billed
// high-fidelity ≈3k tokens/ref), image output $30/M → per-image portrait (1024x1536)
// ≈ $0.041 medium, ≈ $0.165 high. low estimated. (Empirically: gpt-image-2 always
// runs high-fidelity and REJECTS input_fidelity, so there is NO separate surcharge.)
export const OPENAI_IMAGE_2_COST_USD: Record<ImageQuality, number> = {
  low: 0.011,
  medium: 0.041,
  high: 0.165,
}

// gpt-image-1.5 per-image pricing (kept for rollback tier + comparison). ⚠️ PLACEHOLDER
// = gpt-image-1 until confirmed against OpenAI's published gpt-image-1.5 rates.
export const OPENAI_IMAGE_15_COST_USD: Record<ImageQuality, number> = {
  low: 0.011,
  medium: 0.042,
  high: 0.167,
}

// input_fidelity:'high' on /images/edits (gpt-image-1 / 1.5 ONLY — gpt-image-2 rejects
// it) sends the input image at higher token detail, adding input-image tokens.
// Approximate additive surcharge per edit (cost-tracking estimate, not invoicing-grade).
export const INPUT_FIDELITY_HIGH_SURCHARGE_USD = 0.01

// RB-P9 — each INPUT reference image on an /images/edits call bills image-input
// tokens (~3k tokens/ref high-detail × $8/M ≈ $0.024). Multi-view generations send
// more refs, so the ledger must scale with the input-ref count (STEP 2). Estimate.
export const IMAGE_INPUT_REF_COST_USD = 0.024

// gpt-image-2 rejects `input_fidelity` (empirically: code=invalid_input_fidelity_model)
// and always runs high — so we OMIT the param for it. gpt-image-1 / 1.5 still take it.
export function supportsInputFidelity(model: string): boolean {
  return !model.startsWith('gpt-image-2')
}

// The active image model: per-request override (spike matrix) wins, else the
// IMAGE_MODEL env flag, else the default. RB-P7: default flipped to gpt-image-2;
// instant rollback = set IMAGE_MODEL=gpt-image-1.
export function resolveImageModel(override?: string): string {
  return override ?? Deno.env.get('IMAGE_MODEL') ?? 'gpt-image-2'
}

// Per-image unit cost by model + quality (+ high-fidelity edit surcharge for models
// that accept input_fidelity, + per-input-reference image-token cost for edits).
export function openaiImageUnitCost(
  model: string, quality: ImageQuality, opts?: { inputFidelityHigh?: boolean; inputRefs?: number },
): number {
  const base = model.startsWith('gpt-image-2') ? OPENAI_IMAGE_2_COST_USD[quality]
    : model.startsWith('gpt-image-1.5') ? OPENAI_IMAGE_15_COST_USD[quality]
    : OPENAI_IMAGE_COST_USD[quality]
  const surcharge = (opts?.inputFidelityHigh && supportsInputFidelity(model)) ? INPUT_FIDELITY_HIGH_SURCHARGE_USD : 0
  const inputCost = Math.max(0, opts?.inputRefs ?? 0) * IMAGE_INPUT_REF_COST_USD
  return base + surcharge + inputCost
}

const OPENAI_URL = 'https://api.openai.com/v1/images/generations'

async function generateWithOpenAI(
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!apiKey) throw new Error('OPENAI_API_KEY secret is not set')

  const size = input.size ?? '1024x1024'
  const quality = input.quality ?? 'medium'
  const safePrompt = input.prompt.slice(0, 4000)
  const model = resolveImageModel(input.model)

  return withRetry(async () => {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, prompt: safePrompt, n: 1, size, quality }),
      // Text→image: no input images, so there is nothing for the per-image
      // scaling to scale. Deliberately keeps the proven 135s ceiling rather
      // than dropping to the 90s base — the scaling exists to RAISE the bound
      // for multi-image edits, not to tighten an unrelated path that already
      // works. An explicit timeoutMs still wins.
      signal: AbortSignal.timeout(input.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS),
    })

    if (!res.ok) {
      // Read body regardless so the connection drains cleanly.
      const errText = await res.text().catch(() => res.statusText)
      // Include status code in message so withRetry can detect 429.
      throw new Error(`OpenAI API error ${res.status}: ${errText}`)
    }

    const result = await res.json() as { data?: { b64_json?: string }[] }
    const base64 = result.data?.[0]?.b64_json
    if (!base64) throw new Error('No image returned from OpenAI API')

    return {
      imageBase64: base64,
      mimeType: 'image/png',
      providerUsed: 'openai',
      costMeta: { provider: 'openai', model, unitCost: openaiImageUnitCost(model, quality), currency: 'USD' },
    }
  }, 'generateWithOpenAI')
}

const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits'

function mimeToExt(mimeType: string): string {
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('webp')) return 'webp'
  return 'jpg'
}

// True image-to-image editing — OpenAI's /v1/images/edits endpoint, given real
// input image bytes (unlike generateWithOpenAI, which is pure text→image).
// All OpenAI image models (gpt-image-1 / 1.5 / 2) support edits; Gemini isn't wired for it.
async function editWithOpenAI(input: EditImageInput): Promise<GenerateImageResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!apiKey) throw new Error('OPENAI_API_KEY secret is not set')
  if (input.images.length === 0) throw new Error('editWithOpenAI requires at least one input image')

  const size = input.size ?? '1024x1024'
  const quality = input.quality ?? 'medium'
  const safePrompt = input.prompt.slice(0, 4000)
  const model = resolveImageModel(input.model)

  return withRetry(async () => {
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', safePrompt)
    form.append('n', '1')
    form.append('size', size)
    form.append('quality', quality)
    // RB-P6/P7 — maximise faithfulness to the input photo(s). gpt-image-1 / 1.5
    // take input_fidelity:'high'; gpt-image-2 REJECTS the param (always high
    // internally), so it MUST be omitted (empirically: invalid_input_fidelity_model).
    if (supportsInputFidelity(model)) form.append('input_fidelity', 'high')
    for (const img of input.images) {
      const bytes = Uint8Array.from(atob(img.base64), (c) => c.charCodeAt(0))
      form.append('image[]', new Blob([bytes], { type: img.mimeType }), `image.${mimeToExt(img.mimeType)}`)
    }

    const res = await fetch(OPENAI_EDITS_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
      // Scales with the input-image count — an 8-panel replicate run is
      // legitimately slower than a 1-image edit and must not be aborted at a
      // bound sized for the latter.
      signal: AbortSignal.timeout(input.timeoutMs ?? imageFetchTimeoutMs(input.images.length)),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      throw new Error(`OpenAI API error ${res.status}: ${errText}`)
    }

    const result = await res.json() as { data?: { b64_json?: string }[] }
    const base64 = result.data?.[0]?.b64_json
    if (!base64) throw new Error('No image returned from OpenAI edits API')

    return {
      imageBase64: base64,
      mimeType: 'image/png',
      providerUsed: 'openai' as ImageProvider,
      costMeta: { provider: 'openai' as ImageProvider, model, unitCost: openaiImageUnitCost(model, quality, { inputFidelityHigh: supportsInputFidelity(model), inputRefs: input.images.length }), currency: 'USD' as const },
    }
  }, 'editWithOpenAI')
}

// Published Gemini 2.5 Flash Image per-image price (USD) — flat rate,
// unlike OpenAI there's no quality tier. Re-verify against Google's pricing
// page before relying on this for real billing; this is for benchmarking
// only (per the spec amendment's "measurement, not assumption" goal).
const GEMINI_IMAGE_COST_USD = 0.039

const GEMINI_MODEL = 'gemini-2.5-flash-image'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// OpenAI's {width}x{height} sizes don't map onto Gemini's aspect-ratio
// config directly — translate to the closest of Gemini's supported ratios.
function sizeToGeminiAspectRatio(size?: ImageSize): string {
  switch (size) {
    case '1024x1536': return '9:16'
    case '1536x1024': return '16:9'
    default: return '1:1'
  }
}

async function generateWithGemini(
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  if (!apiKey) throw new Error('GEMINI_API_KEY secret is not set')

  const safePrompt = input.prompt.slice(0, 4000)
  const aspectRatio = sizeToGeminiAspectRatio(input.size)

  return withRetry(async () => {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: safePrompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio },
        },
      }),
      // Text→image: no input images, so there is nothing for the per-image
      // scaling to scale. Deliberately keeps the proven 135s ceiling rather
      // than dropping to the 90s base — the scaling exists to RAISE the bound
      // for multi-image edits, not to tighten an unrelated path that already
      // works. An explicit timeoutMs still wins.
      signal: AbortSignal.timeout(input.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      throw new Error(`Gemini API error ${res.status}: ${errText}`)
    }

    const result = await res.json() as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
    }
    const part = result.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    const base64 = part?.inlineData?.data
    if (!base64) throw new Error('No image returned from Gemini API')

    return {
      imageBase64: base64,
      mimeType: part?.inlineData?.mimeType ?? 'image/png',
      providerUsed: 'gemini',
      costMeta: { provider: 'gemini', model: GEMINI_MODEL, unitCost: GEMINI_IMAGE_COST_USD, currency: 'USD' },
    }
  }, 'generateWithGemini')
}

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const provider = resolveProvider(input.providerHint)

  // Standalone callers (no parent trace) get their own top-level trace, same
  // behavior generate-image/index.ts had before this was extracted.
  const traceId = input.traceId ?? `image-gen-${crypto.randomUUID()}`
  const ownsTrace = !input.traceId
  if (ownsTrace) {
    await langfuseTrace(traceId, {
      name: 'generate-image',
      tags: ['image-gen', provider],
      metadata: { size: input.size, quality: input.quality, provider },
      input: { prompt: input.prompt.slice(0, 4000) },
    })
  }

  const observationName = input.observationName ?? `${provider}-image-gen`

  // review-build only: server-enforced global image cap. Reserved BEFORE
  // the paid provider call — never bill-then-reject. Estimated cost is
  // the same per-quality figure used for cost-tracking below, so the
  // budget's running total and the per-call costMeta stay consistent.
  const estimatedCostUsd = provider === 'openai'
    ? OPENAI_IMAGE_COST_USD[input.quality ?? 'medium']
    : GEMINI_IMAGE_COST_USD
  await reserveImageBudget(estimatedCostUsd)

  try {
    const result = provider === 'openai'
      ? await generateWithOpenAI(input)
      : provider === 'gemini'
        ? await generateWithGemini(input)
        : (() => { throw new Error(`Unknown image provider: ${provider}`) })()

    await langfuseGeneration(traceId, {
      name: observationName,
      model: result.costMeta.model,
      input: { prompt: input.prompt.slice(0, 4000), size: input.size, quality: input.quality },
      // Image bytes are NEVER sent to Langfuse — only success + cost metadata.
      output: { imageGenerated: true, mimeType: result.mimeType, costMeta: result.costMeta },
    })

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await langfuseGeneration(traceId, {
      name: observationName,
      model: provider === 'openai' ? resolveImageModel(input.model) : provider === 'gemini' ? GEMINI_MODEL : provider,
      input: { prompt: input.prompt.slice(0, 4000), size: input.size, quality: input.quality },
      level: 'ERROR',
      statusMessage: message,
    })
    throw err
  }
}

// True image-to-image editing (hero photo + optional supporting photos kept
// as real pixels, not just a text description). OpenAI-only today — there is
// no provider switch here because Gemini isn't wired for edits in this repo.
export async function editImage(input: EditImageInput): Promise<GenerateImageResult> {
  const traceId = input.traceId ?? `image-edit-${crypto.randomUUID()}`
  const ownsTrace = !input.traceId
  if (ownsTrace) {
    await langfuseTrace(traceId, {
      name: 'edit-image',
      tags: ['image-edit', 'openai'],
      metadata: { size: input.size, quality: input.quality, imageCount: input.images.length },
      input: { prompt: input.prompt.slice(0, 4000) },
    })
  }

  const observationName = input.observationName ?? 'openai-image-edit'

  // Same review-build budget gate as generateImage() — reserved before the
  // paid call, using the same approximate per-quality cost figures.
  const estimatedCostUsd = OPENAI_IMAGE_COST_USD[input.quality ?? 'medium']
  await reserveImageBudget(estimatedCostUsd)

  try {
    const result = await editWithOpenAI(input)

    await langfuseGeneration(traceId, {
      name: observationName,
      model: result.costMeta.model,
      input: { prompt: input.prompt.slice(0, 4000), size: input.size, quality: input.quality, imageCount: input.images.length },
      output: { imageGenerated: true, mimeType: result.mimeType, costMeta: result.costMeta },
    })

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await langfuseGeneration(traceId, {
      name: observationName,
      model: resolveImageModel(input.model),
      input: { prompt: input.prompt.slice(0, 4000), size: input.size, quality: input.quality, imageCount: input.images.length },
      level: 'ERROR',
      statusMessage: message,
    })
    throw err
  }
}

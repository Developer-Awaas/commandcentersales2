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
 * Image provider API keys (OPENAI_API_KEY, GEMINI_API_KEY) are read from
 * Deno.env here only — never exposed to the client bundle.
 */

import { langfuseTrace, langfuseGeneration } from './langfuse.ts'

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

function resolveProvider(hint?: ImageProvider): ImageProvider {
  return hint ?? (Deno.env.get('IMAGE_PROVIDER') as ImageProvider | undefined) ?? 'openai'
}

// Exponential back-off on 429 rate-limit errors. Reads Retry-After when
// available (OpenAI/Gemini both set it); otherwise uses binary-exp backoff
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
const OPENAI_IMAGE_COST_USD: Record<ImageQuality, number> = {
  low: 0.011,
  medium: 0.042,
  high: 0.167,
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
  const model = 'gpt-image-1'

  return withRetry(async () => {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, prompt: safePrompt, n: 1, size, quality }),
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
      costMeta: { provider: 'openai', model, unitCost: OPENAI_IMAGE_COST_USD[quality], currency: 'USD' },
    }
  }, 'generateWithOpenAI')
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
      model: provider === 'openai' ? 'gpt-image-1' : provider === 'gemini' ? GEMINI_MODEL : provider,
      input: { prompt: input.prompt.slice(0, 4000), size: input.size, quality: input.quality },
      level: 'ERROR',
      statusMessage: message,
    })
    throw err
  }
}

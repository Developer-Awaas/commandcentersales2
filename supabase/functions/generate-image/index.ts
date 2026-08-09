/**
 * generate-image
 *
 * Server-side proxy for OpenAI GPT-Image-1 image generation.
 * Called by gemini-service.ts to avoid browser CORS issues.
 *
 * Requires env secret: OPENAI_API_KEY
 *
 * Input:  { prompt: string, width?: number, height?: number, heroImage?, supportingImages? }
 * Output: { base64: string, mimeType: string }
 *
 * GPT-Image-1 supported sizes:
 *   Square    (1:1)        → 1024×1024
 *   Portrait  (4:5 / 9:16) → 1024×1536
 *   Landscape               → 1536×1024
 *
 * GPT-Image-1 always returns base64 in data[0].b64_json directly.
 *
 * heroImage / supportingImages (hero reference image feature): when
 * `heroImage` is present, this becomes a true image-to-image EDIT — the real
 * photo's bytes are sent to OpenAI's /v1/images/edits via
 * `_shared/image-provider.ts`'s editImage(), composition preserved, instead
 * of the pure text→image /v1/images/generations call below. Each entry is
 * either `{base64,mimeType}` (already in memory client-side, e.g. a fresh
 * upload) or `{url}` (an existing project_assets photo — fetched server-side
 * here so the client never has to download+re-upload bytes it already has a
 * URL for). `supportingImages` (e.g. amenity photos) ride alongside the hero
 * as secondary, non-focal elements in the same edit call.
 *
 * Observability: each call is wrapped in its own Langfuse trace (no-op if
 * LANGFUSE_* secrets aren't set). Image bytes are never sent to Langfuse —
 * only the prompt, size/quality params, and success/failure.
 */

import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { langfuseTrace, langfuseGeneration } from '../_shared/langfuse.ts'
import { editImage, resolveImageModel, openaiImageUnitCost, supportsInputFidelity } from '../_shared/image-provider.ts'
import { reserveImageBudget, ImageBudgetExceededError } from '../_shared/review-budget.ts'
import { recordApiCost } from '../_shared/api-cost.ts'

const OPENAI_URL = 'https://api.openai.com/v1/images/generations'

type ImageRef = { base64: string; mimeType: string } | { url: string }

// This function requires a valid Supabase auth JWT (not in deploy-functions.yml's
// --no-verify-jwt list), but any authenticated org member could otherwise pass an
// arbitrary internal/external URL here and get the server to fetch it (SSRF) —
// `heroImage`/`supportingImages` are only ever meant to be existing
// project_assets photos, which always live under this project's own Supabase
// Storage public bucket. Enforce that instead of trusting the caller's URL.
function assertAllowedImageUrl(url: string): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const allowedPrefix = `${supabaseUrl}/storage/v1/object/public/`
  if (!supabaseUrl || !url.startsWith(allowedPrefix)) {
    throw new Error('Reference image URL must be a Supabase Storage public URL for this project')
  }
}

async function resolveImageRef(ref: ImageRef): Promise<{ base64: string; mimeType: string }> {
  if ('base64' in ref) return ref
  assertAllowedImageUrl(ref.url)
  const res = await fetch(ref.url)
  if (!res.ok) throw new Error('Failed to fetch reference image')
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
  const buf = await res.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return { base64: btoa(binary), mimeType }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY secret is not set' }),
      { status: 500, headers: corsHeaders() }
    )
  }

  let body: {
    prompt?: string
    width?: number
    height?: number
    quality?: 'low' | 'medium' | 'high'
    heroImage?: ImageRef
    supportingImages?: ImageRef[]
    // Cost-ledger attribution (agent_interactions). Passed by gemini-service.ts;
    // org/user follow the same client-reported trust model as ai_sessions.
    orgId?: string
    userId?: string | null
    feature?: string
    projectId?: string | null
    // RB-P6/P7: per-request model override (spike matrix). Omit → IMAGE_MODEL env
    // / default (gpt-image-2).
    model?: string
    // RB-P7 guard target: transparent background is unsupported on gpt-image-2.
    background?: string
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }

  const { prompt, width = 1080, height = 1080, quality = 'medium', heroImage, supportingImages = [], orgId, userId, feature, projectId } = body
  if (!prompt || typeof prompt !== 'string') {
    return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400, headers: corsHeaders() })
  }
  const model = resolveImageModel(body.model)

  // RB-P7 STEP 1 — fail fast, clearly, if a caller ever asks for a transparent
  // background under gpt-image-2 (unsupported). No code path does this today
  // (grep-verified), so this is a defensive guard against a future regression.
  if (model.startsWith('gpt-image-2') && body.background === 'transparent') {
    return new Response(
      JSON.stringify({ error: "gpt-image-2 does not support background:'transparent'. Use IMAGE_MODEL=gpt-image-1 for transparent backgrounds, or drop the transparent request." }),
      { status: 400, headers: corsHeaders() }
    )
  }

  // Map caller dimensions to the closest supported size
  const size = height > width ? '1024x1536' : width > height ? '1536x1024' : '1024x1024'

  const safePrompt = prompt.slice(0, 4000)

  // Hero reference image path — true image-to-image edit, real photo bytes
  // preserved. editImage() (image-provider.ts) reserves its own budget
  // internally, so this branch must stay BEFORE the generic reservation
  // below — reserving here too would silently double-count every hero-mode
  // generation against the review-build cap.
  if (heroImage) {
    try {
      const resolvedHero = await resolveImageRef(heroImage)
      const resolvedSupporting = await Promise.all(supportingImages.map(resolveImageRef))
      const result = await editImage({
        prompt: safePrompt,
        size,
        quality,
        images: [resolvedHero, ...resolvedSupporting],
        observationName: 'openai-image-edit',
        model,
      })
      if (orgId) {
        await recordApiCost({
          orgId, userId: userId ?? null,
          provider: 'openai', callType: 'image_edit', feature: feature ?? 'creatives',
          model, imageCount: 1, unitCostUsd: openaiImageUnitCost(model, quality, { inputFidelityHigh: supportsInputFidelity(model) }),
          projectId: projectId ?? null,
        })
      }
      return new Response(
        JSON.stringify({ base64: result.imageBase64, mimeType: result.mimeType }),
        { headers: corsHeaders() }
      )
    } catch (err) {
      if (err instanceof ImageBudgetExceededError) {
        return new Response(
          JSON.stringify({ error: 'review budget reached' }),
          { status: 429, headers: corsHeaders() }
        )
      }
      const message = err instanceof Error ? err.message : String(err)
      return new Response(JSON.stringify({ error: message }), { status: 502, headers: corsHeaders() })
    }
  }

  // review-build only: server-enforced global image cap, reserved BEFORE
  // the paid OpenAI call — never bill-then-reject. This function doesn't
  // route through image-provider.ts's generateImage() (a pre-existing
  // inconsistency, out of scope here), so the same check is duplicated
  // at this second entry point rather than left uncovered.
  try {
    await reserveImageBudget(openaiImageUnitCost(model, quality))
  } catch (err) {
    if (err instanceof ImageBudgetExceededError) {
      return new Response(
        JSON.stringify({ error: 'review budget reached' }),
        { status: 429, headers: corsHeaders() }
      )
    }
    throw err
  }

  const traceId = `generate-image-${crypto.randomUUID()}`
  await langfuseTrace(traceId, {
    name: 'generate-image',
    tags: ['image-gen', model],
    metadata: { size, quality },
    input: { prompt: safePrompt },
  })

  try {
    const imageRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: safePrompt,
        n: 1,
        size,
        quality, // low | medium | high — caller sets per aspect ratio
      }),
    })

    if (!imageRes.ok) {
      const errText = await imageRes.text().catch(() => imageRes.statusText)
      await langfuseGeneration(traceId, {
        name: model,
        model,
        input: { prompt: safePrompt, size, quality },
        level: 'ERROR',
        statusMessage: `OpenAI API error ${imageRes.status}: ${errText}`,
      })
      return new Response(
        JSON.stringify({ error: `OpenAI API error ${imageRes.status}: ${errText}` }),
        { status: 502, headers: corsHeaders() }
      )
    }

    const result = await imageRes.json() as { data?: { b64_json?: string }[] }
    const base64 = result.data?.[0]?.b64_json
    if (!base64) {
      await langfuseGeneration(traceId, {
        name: model,
        model,
        input: { prompt: safePrompt, size, quality },
        level: 'ERROR',
        statusMessage: 'No image returned from OpenAI API',
      })
      return new Response(
        JSON.stringify({ error: 'No image returned from OpenAI API' }),
        { status: 502, headers: corsHeaders() }
      )
    }

    await langfuseGeneration(traceId, {
      name: model,
      model,
      input: { prompt: safePrompt, size, quality },
      output: { imageGenerated: true, mimeType: 'image/png' },
    })

    if (orgId) {
      await recordApiCost({
        orgId, userId: userId ?? null,
        provider: 'openai', callType: 'image_gen', feature: feature ?? 'creatives',
        model, imageCount: 1, unitCostUsd: openaiImageUnitCost(model, quality),
        projectId: projectId ?? null, traceId,
      })
    }

    return new Response(
      JSON.stringify({ base64, mimeType: 'image/png' }),
      { headers: corsHeaders() }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await langfuseGeneration(traceId, {
      name: model,
      model,
      input: { prompt: safePrompt, size, quality },
      level: 'ERROR',
      statusMessage: message,
    })
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: corsHeaders() }
    )
  }
})

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

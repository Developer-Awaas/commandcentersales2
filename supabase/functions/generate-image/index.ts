/**
 * generate-image
 *
 * Server-side proxy for OpenAI GPT-Image-1 image generation.
 * Called by gemini-service.ts to avoid browser CORS issues.
 *
 * Requires env secret: OPENAI_API_KEY
 *
 * Input:  { prompt: string, width?: number, height?: number, heroImage?, supportingImages?, async? }
 * Output: { base64: string, mimeType: string }   (sync, the default)
 *         { jobId: string }                      (async: true)
 *
 * ASYNC MODE (20260811120000): Supabase returns 504 if a function hasn't
 * responded within 150s, and a gpt-image-2 edit at quality:'high' with 5
 * reference images measures 129.4s — ~20s of slack, lost the moment a 429
 * triggers withRetry's full re-run. With `async: true` this returns a job id
 * in <1s and finishes in EdgeRuntime.waitUntil(): the PNG lands in Storage and
 * the image_jobs row flips to done/failed, which the client watches over
 * Realtime. The SYNC path is unchanged and remains the default, so aanya.ts
 * and every other server-side caller is untouched.
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
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { langfuseTrace, langfuseGeneration } from '../_shared/langfuse.ts'
import { editImage, resolveImageModel, openaiImageUnitCost, supportsInputFidelity, IMAGE_FETCH_TIMEOUT_MS } from '../_shared/image-provider.ts'
import { reserveImageBudget, ImageBudgetExceededError } from '../_shared/review-budget.ts'
import { recordApiCost } from '../_shared/api-cost.ts'

const OPENAI_URL = 'https://api.openai.com/v1/images/generations'

/**
 * Bucket the async job writes its finished PNG to. Must stay in sync with
 * gemini-service.ts's JOB_BUCKET, which downloads from it.
 *
 * NOT brand-assets: this repo already infers a storage path's bucket as
 * `path.startsWith('generated-creatives/') ? 'brand-assets' : 'creative-assets'`
 * (creative-history.ts, history-service.ts, canva-sync-design). An
 * `image-jobs/…` path in brand-assets contradicts that rule, so any future
 * cleanup/delete path that inherits a job path would look in the wrong bucket.
 */
const JOB_BUCKET = 'creative-assets'

// Supabase's background-task API: keeps the isolate alive after the response
// is sent, until the promise settles (subject to the wall-clock limit).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

let _admin: SupabaseClient<Database> | null = null
function adminClient(): SupabaseClient<Database> {
  if (_admin) return _admin
  _admin = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  return _admin
}

/** Carries the HTTP status the sync path should report for this failure. */
class ImageGenError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

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
    // 20260811120000 — return a jobId immediately and finish in the background,
    // instead of holding the request open past Supabase's 150s 504 ceiling.
    async?: boolean
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

  // The single generation body, shared by the sync and async paths — extracted
  // rather than duplicated so the two can never drift. Returns the image or
  // throws; the caller decides whether that becomes an HTTP status or a
  // terminal image_jobs row.
  const generateOnce = async (): Promise<{ base64: string; mimeType: string }> => {
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
            // inputRefs = hero + supporting building views (multi-view bills more input tokens).
            model, imageCount: 1, unitCostUsd: openaiImageUnitCost(model, quality, { inputFidelityHigh: supportsInputFidelity(model), inputRefs: 1 + supportingImages.length }),
            projectId: projectId ?? null,
          })
        }
        return { base64: result.imageBase64, mimeType: result.mimeType }
      } catch (err) {
        if (err instanceof ImageBudgetExceededError) throw err
        // Preserve the pre-existing 502 for any hero-path failure.
        throw new ImageGenError(err instanceof Error ? err.message : String(err), 502)
      }
    }

    // review-build only: server-enforced global image cap, reserved BEFORE
    // the paid OpenAI call — never bill-then-reject. This function doesn't
    // route through image-provider.ts's generateImage() (a pre-existing
    // inconsistency, out of scope here), so the same check is duplicated
    // at this second entry point rather than left uncovered.
    await reserveImageBudget(openaiImageUnitCost(model, quality))

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
        // Nothing else bounds this call; without it the gateway (or the
        // wall-clock limit, in async mode) is the only thing that stops a
        // slow response. Bugs #35/#41, same class.
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
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
        throw new ImageGenError(`OpenAI API error ${imageRes.status}: ${errText}`, 502)
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
        throw new ImageGenError('No image returned from OpenAI API', 502)
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

      return { base64, mimeType: 'image/png' }
    } catch (err: unknown) {
      if (err instanceof ImageGenError || err instanceof ImageBudgetExceededError) throw err
      const message = err instanceof Error ? err.message : String(err)
      await langfuseGeneration(traceId, {
        name: model,
        model,
        input: { prompt: safePrompt, size, quality },
        level: 'ERROR',
        statusMessage: message,
      })
      throw new ImageGenError(message, 500)
    }
  }

  // --- async mode: respond now, finish in the background -------------------
  if (body.async) {
    // org_id is NOT NULL on image_jobs, and without it the client has no
    // RLS-visible row to watch — fail loudly rather than silently sync.
    if (!orgId) {
      return new Response(
        JSON.stringify({ error: 'orgId is required for async generation' }),
        { status: 400, headers: corsHeaders() }
      )
    }

    const db = adminClient()
    const { data: job, error: jobErr } = await db
      .from('image_jobs')
      .insert({ org_id: orgId, user_id: userId ?? null, status: 'queued' })
      .select('id')
      .single()

    // A wrong/renamed column returns { error } rather than throwing (bugs
    // #47/#48), so the insert result is checked, never assumed.
    if (jobErr || !job) {
      return new Response(
        JSON.stringify({ error: `Could not queue image job: ${jobErr?.message ?? 'no row returned'}` }),
        { status: 500, headers: corsHeaders() }
      )
    }

    const jobId = job.id
    EdgeRuntime.waitUntil((async () => {
      try {
        const { base64, mimeType } = await generateOnce()
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const path = `image-jobs/${orgId}/${jobId}.png`
        const { error: upErr } = await db.storage
          .from(JOB_BUCKET)
          .upload(path, bytes, { contentType: mimeType, upsert: true })
        if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`)

        await db.from('image_jobs')
          .update({ status: 'done', storage_path: path, completed_at: new Date().toISOString() })
          .eq('id', jobId)
      } catch (err) {
        const message = err instanceof ImageBudgetExceededError
          ? 'review budget reached'
          : err instanceof Error ? err.message : String(err)
        // Terminal state is mandatory: without it the client waits on a row
        // that never changes until the 10-minute reaper catches it.
        await db.from('image_jobs')
          .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
          .eq('id', jobId)
        console.error(`image job ${jobId} failed:`, message)
      }
    })())

    return new Response(JSON.stringify({ jobId }), { headers: corsHeaders() })
  }

  // --- sync mode (default, unchanged behaviour) ----------------------------
  try {
    const { base64, mimeType } = await generateOnce()
    return new Response(JSON.stringify({ base64, mimeType }), { headers: corsHeaders() })
  } catch (err) {
    if (err instanceof ImageBudgetExceededError) {
      return new Response(
        JSON.stringify({ error: 'review budget reached' }),
        { status: 429, headers: corsHeaders() }
      )
    }
    const status = err instanceof ImageGenError ? err.status : 500
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status, headers: corsHeaders() }
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

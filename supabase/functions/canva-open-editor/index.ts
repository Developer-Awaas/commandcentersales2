import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { resolveCallerIdentity, initiateCanvaOAuth, getValidCanvaAccessToken } from '../_shared/canva-oauth.ts'

// Distinguishes "Canva's API rejected this request" (502 — an upstream
// service problem, readable in the response body) from an actual bug in
// this function (500). Previously every failure in the try block —
// Canva rejections included — returned a bare 500 with no way to tell
// which class of problem it was from the status code alone.
class CanvaApiError extends Error {}

const CANVA_API_BASE = 'https://api.canva.com/rest/v1'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

  let body: { creativeAssetId: string; returnUrl?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }

  const { creativeAssetId, returnUrl } = body

  // userId/orgId are never trusted from the request body — this is a
  // service-role client (bypasses RLS), so identity has to be resolved
  // from the caller's own JWT or a spoofed body value could act on any
  // org's data. Same pattern as aarav-orchestrate.
  const identityResult = await resolveCallerIdentity(req)
  if (!identityResult.ok) {
    return new Response(JSON.stringify({ error: identityResult.error }), { status: identityResult.status, headers: corsHeaders() })
  }
  const { userId, orgId } = identityResult.identity

  // Fetch the creative asset
  const { data: asset, error: assetErr } = await supabase
    .from('creative_assets')
    .select('*')
    .eq('id', creativeAssetId)
    .single()
  if (assetErr || !asset) {
    return new Response(JSON.stringify({ error: 'Creative asset not found' }), { status: 404, headers: corsHeaders() })
  }
  // Belt-and-suspenders: the service-role client bypassed RLS to fetch this
  // row, so explicitly verify it belongs to the caller's own org.
  if (asset.org_id !== orgId) {
    return new Response(JSON.stringify({ error: 'Creative asset not found' }), { status: 404, headers: corsHeaders() })
  }

  // Get a valid Canva access token — refreshes it first (with single-use
  // refresh-token rotation) if it's expired or close to it. A dead/missing
  // connection here (never connected, or refresh itself failed) means the
  // same needsAuth cold-start path as before.
  const tokenResult = await getValidCanvaAccessToken(supabase, userId)
  if (!tokenResult.ok) {
    // returnUrl is captured from the actual calling page (this app has no
    // real URL routing — "pages" are React state — so the client passes
    // `${origin}/?page=<activePage>`, which the return landing page later
    // parses to know which page to navigate back to). Falls back to a
    // sensible default if the caller didn't pass one.
    const result = await initiateCanvaOAuth(supabase, {
      userId,
      orgId,
      returnUrl: returnUrl ?? `${appUrl}/?page=creatives`,
      creativeId: creativeAssetId,
    })
    if ('error' in result) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders() })
    }
    return new Response(JSON.stringify({ needsAuth: true, authUrl: result.authUrl }), { headers: corsHeaders() })
  }

  const accessToken = tokenResult.accessToken

  if (!asset.image_url) {
    return new Response(
      JSON.stringify({ error: 'Asset has no image URL — the image may still be generating. Refresh and try again.' }),
      { status: 400, headers: corsHeaders() }
    )
  }

  try {
    // Step 1a: Fetch the source image from our own storage first — never
    // blindly forward whatever comes back to Canva. CC-TEST's bucket
    // topology has already differed from PROD once tonight (storage RLS),
    // so verify the reader actually got real image bytes, not an error
    // page/redirect/empty body that Canva would then reject for reasons
    // that look like an upload-format problem but are really ours.
    const urlObj = new URL(asset.image_url)
    const bucketPathMatch = urlObj.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/)
    const [, fetchedBucket, fetchedPath] = bucketPathMatch ?? [undefined, 'unknown', urlObj.pathname]

    const imageFetchRes = await fetch(asset.image_url)
    const fetchedContentType = imageFetchRes.headers.get('content-type') ?? 'unknown'
    if (!imageFetchRes.ok) {
      console.error(`[canva-open-editor] source image fetch failed — bucket=${fetchedBucket} path=${fetchedPath} status=${imageFetchRes.status} content-type=${fetchedContentType}`)
      throw new Error(`Failed to fetch source image from storage (${imageFetchRes.status}, bucket=${fetchedBucket})`)
    }
    if (!fetchedContentType.startsWith('image/')) {
      console.error(`[canva-open-editor] source image fetch returned non-image content-type — bucket=${fetchedBucket} path=${fetchedPath} content-type=${fetchedContentType}`)
      throw new Error(`Storage returned non-image content (content-type=${fetchedContentType}, bucket=${fetchedBucket}) — check bucket public/signed-URL access mode on this environment`)
    }
    const imageBytes = await imageFetchRes.arrayBuffer()
    console.log(`[canva-open-editor] source image fetched OK — bucket=${fetchedBucket} path=${fetchedPath} bytes=${imageBytes.byteLength} content-type=${fetchedContentType}`)

    // Step 1b: Upload the image. POST /v1/asset-uploads does NOT support
    // import-by-URL despite the field names our previous implementation
    // used (import_type/import_url are not real params) — confirmed
    // directly against Canva's docs and by reproducing the exact rejection
    // it returns. The real contract is raw file bytes as the body,
    // Content-Type: application/octet-stream, and the asset name as a
    // base64 JSON header (max 50 chars unencoded) — matches Canva's own
    // documented example exactly (standard Base64 with padding, not
    // base64url — their example output contains `==` padding).
    // https://www.canva.dev/docs/connect/api-reference/assets/create-asset-upload-job/
    const assetName = `CC2-${asset.campaign_id ?? 'creative'}-${asset.angle}`.slice(0, 50)
    const uploadRes = await fetch(`${CANVA_API_BASE}/asset-uploads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Asset-Upload-Metadata': JSON.stringify({ name_base64: btoa(assetName) }),
      },
      body: imageBytes,
    })
    // Canva's real error shape is {code, message} at the TOP level — NOT
    // nested under an `error` key. Reading uploadJson.error?.message (the
    // previous assumption) is always undefined for a real Canva rejection,
    // silently discarding the actual reason and leaving only the generic
    // "Canva upload error 400" fallback text. Log and surface the whole
    // raw body regardless of shape so nothing is ever swallowed again.
    const uploadRawText = await uploadRes.text()
    let uploadJson: { job?: { id?: string }; code?: string; message?: string; error?: { message?: string } } = {}
    try { uploadJson = JSON.parse(uploadRawText) } catch { /* non-JSON body, handled by the raw-text log below */ }
    if (!uploadRes.ok) {
      console.error(`[canva-open-editor] asset-upload rejected — status=${uploadRes.status} body=${uploadRawText}`)
      throw new CanvaApiError(
        uploadJson.message ?? uploadJson.error?.message ?? `Canva upload error ${uploadRes.status}: ${uploadRawText}`
      )
    }
    const jobId = uploadJson.job?.id
    if (!jobId) throw new CanvaApiError(`No upload job ID returned from Canva: ${uploadRawText}`)

    // Step 2: Poll upload job status. AssetUploadJob.error is genuinely
    // nested (job.error.message per Canva's schema, unlike the top-level
    // shape on the initial POST's rejection) — but log the raw body
    // regardless so a schema mismatch here is visible too, not swallowed.
    let uploadedAssetId: string | null = null
    for (let i = 0; i < 10; i++) {
      await sleep(1500)
      const pollRes = await fetch(`${CANVA_API_BASE}/asset-uploads/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const pollRawText = await pollRes.text()
      const pollJson = JSON.parse(pollRawText) as { job?: { status?: string; asset?: { id?: string }; error?: { code?: string; message?: string } } }
      if (pollJson.job?.status === 'success') {
        uploadedAssetId = pollJson.job.asset?.id ?? null
        break
      }
      if (pollJson.job?.status === 'failed') {
        console.error(`[canva-open-editor] asset-upload job failed — body=${pollRawText}`)
        throw new CanvaApiError(pollJson.job?.error?.message ?? `Canva asset upload failed: ${pollRawText}`)
      }
    }
    if (!uploadedAssetId) throw new CanvaApiError('Canva upload timed out')

    // Step 3: Create design with uploaded asset. 'InstagramPost' is not a
    // real PresetDesignTypeName (the only presets are doc/email/
    // presentation/whiteboard — confirmed against Canva's OpenAPI spec) and
    // the request body was missing the required `type: 'type_and_asset'`
    // discriminator entirely. Our generated creatives are 1080x1080 square
    // (Quick Generate's feed slot) — CustomDesignTypeInput with matching
    // dimensions is the correct shape, not a preset.
    // https://www.canva.dev/docs/connect/api-reference/designs/create-design/
    const designRes = await fetch(`${CANVA_API_BASE}/designs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'type_and_asset',
        design_type: { type: 'custom', width: 1080, height: 1080 },
        asset_id: uploadedAssetId,
      }),
    })
    const designRawText = await designRes.text()
    let designJson: { design?: { id?: string; urls?: { edit_url?: string } }; code?: string; message?: string; error?: { message?: string } } = {}
    try { designJson = JSON.parse(designRawText) } catch { /* non-JSON body, handled by the raw-text log below */ }
    if (!designRes.ok) {
      console.error(`[canva-open-editor] design creation rejected — status=${designRes.status} body=${designRawText}`)
      throw new CanvaApiError(
        designJson.message ?? designJson.error?.message ?? `Canva design error ${designRes.status}: ${designRawText}`
      )
    }

    const designId = designJson.design?.id
    const editUrl = designJson.design?.urls?.edit_url
    if (!editUrl) throw new CanvaApiError(`No edit URL returned from Canva: ${designRawText}`)

    // Step 4: Update creative_assets row
    await supabase
      .from('creative_assets')
      .update({
        canva_design_id: designId,
        canva_edit_url: editUrl,
        editor_used: 'canva',
        status: 'editing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', creativeAssetId)

    return new Response(JSON.stringify({ editUrl, designId }), { headers: corsHeaders() })
  } catch (err: unknown) {
    // 502 = Canva's own API rejected the request or timed out (readable in
    // the message — an upstream problem, not a bug here). 500 = anything
    // else (a genuine unexpected failure in this function).
    const status = err instanceof CanvaApiError ? 502 : 500
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status, headers: corsHeaders() }
    )
  }
})

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

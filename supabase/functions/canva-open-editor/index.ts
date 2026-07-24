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
    // Step 1: Upload the image. POST /v1/asset-uploads does NOT support
    // import-by-URL despite the field names our previous implementation
    // used (import_type/import_url are not real params) — confirmed
    // directly against Canva's docs and by reproducing the exact rejection
    // it returns: {"code":"internal_error","message":"Unsupported content
    // type, expected: application/octet-stream, ..."}. The real contract
    // is raw file bytes as the body, Content-Type: application/octet-stream,
    // and the asset name as a base64 JSON header (max 50 chars unencoded).
    // https://www.canva.dev/docs/connect/api-reference/assets/create-asset-upload-job/
    const imageFetchRes = await fetch(asset.image_url)
    if (!imageFetchRes.ok) throw new Error(`Failed to fetch source image (${imageFetchRes.status})`)
    const imageBytes = await imageFetchRes.arrayBuffer()

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
    const uploadJson = await uploadRes.json() as { job?: { id?: string }; error?: { message?: string } }
    if (!uploadRes.ok) throw new CanvaApiError(uploadJson?.error?.message ?? `Canva upload error ${uploadRes.status}`)
    const jobId = uploadJson.job?.id
    if (!jobId) throw new CanvaApiError('No upload job ID returned from Canva')

    // Step 2: Poll upload job status
    let uploadedAssetId: string | null = null
    for (let i = 0; i < 10; i++) {
      await sleep(1500)
      const pollRes = await fetch(`${CANVA_API_BASE}/asset-uploads/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const pollJson = await pollRes.json() as { job?: { status?: string; asset?: { id?: string }; error?: { message?: string } } }
      if (pollJson.job?.status === 'success') {
        uploadedAssetId = pollJson.job.asset?.id ?? null
        break
      }
      if (pollJson.job?.status === 'failed') throw new CanvaApiError(pollJson.job?.error?.message ?? 'Canva asset upload failed')
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
    const designJson = await designRes.json() as { design?: { id?: string; urls?: { edit_url?: string } }; error?: { message?: string } }
    if (!designRes.ok) throw new CanvaApiError(designJson?.error?.message ?? `Canva design error ${designRes.status}`)

    const designId = designJson.design?.id
    const editUrl = designJson.design?.urls?.edit_url
    if (!editUrl) throw new CanvaApiError('No edit URL returned from Canva')

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

/**
 * canva-sync-design
 *
 * Called after the user finishes editing a design in the Canva external editor.
 * Exports the design via the Canva Connect API, downloads the resulting PNG,
 * overwrites the original file in Supabase Storage (zero extra storage cost),
 * and updates the creative_assets row.
 *
 * Canva export API reference:
 *   POST /v1/exports  { design_id, format: { type: 'png' } }
 *   GET  /v1/exports/{exportId}  → { job: { status, urls } }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CANVA_API_BASE = 'https://api.canva.com/rest/v1'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let body: { creativeAssetId: string; userId: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }

  const { creativeAssetId, userId } = body

  // Fetch the creative asset
  const { data: asset, error: assetErr } = await supabase
    .from('creative_assets')
    .select('*')
    .eq('id', creativeAssetId)
    .single()
  if (assetErr || !asset) {
    return new Response(JSON.stringify({ error: 'Creative asset not found' }), { status: 404, headers: corsHeaders() })
  }

  if (!asset.canva_design_id) {
    return new Response(JSON.stringify({ error: 'No Canva design ID found on this asset — open in Canva first' }), { status: 400, headers: corsHeaders() })
  }

  // Fetch the user's Canva access token
  const { data: tokenRow } = await supabase
    .from('org_user_integrations')
    .select('access_token')
    .eq('user_id', userId)
    .eq('provider', 'canva')
    .single()

  if (!tokenRow?.access_token) {
    return new Response(JSON.stringify({ error: 'Canva not connected — reconnect via Settings' }), { status: 401, headers: corsHeaders() })
  }

  const accessToken = tokenRow.access_token

  try {
    // Step 1: Request export job from Canva
    const exportRes = await fetch(`${CANVA_API_BASE}/exports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        design_id: asset.canva_design_id,
        format: { type: 'png' },
      }),
    })
    const exportJson = await exportRes.json() as { job?: { id?: string }; error?: { message?: string } }
    if (!exportRes.ok) throw new Error(exportJson?.error?.message ?? `Canva export error ${exportRes.status}`)
    const exportJobId = exportJson.job?.id
    if (!exportJobId) throw new Error('No export job ID returned from Canva')

    // Step 2: Poll until export completes.
    // Cap at 10 iterations × 1500 ms = 15 s max sleep, leaving ~15 s headroom
    // for the surrounding I/O within the 30 s Edge Function wall-clock limit.
    let exportUrls: string[] = []
    for (let i = 0; i < 10; i++) {
      await sleep(1500)
      const pollRes = await fetch(`${CANVA_API_BASE}/exports/${exportJobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const pollJson = await pollRes.json() as { job?: { status?: string; urls?: string[] } }
      if (pollJson.job?.status === 'success') {
        exportUrls = pollJson.job.urls ?? []
        break
      }
      if (pollJson.job?.status === 'failed') throw new Error('Canva export job failed')
    }
    if (!exportUrls.length) throw new Error('Canva export timed out — the design may be too large. Try again shortly.')

    // Step 3: Download the exported PNG from Canva's CDN
    const imageRes = await fetch(exportUrls[0])
    if (!imageRes.ok) throw new Error(`Failed to download exported image (${imageRes.status})`)
    const imageBuffer = await imageRes.arrayBuffer()

    // Step 4: Overwrite original file in Supabase Storage (no new file = no extra storage)
    if (!asset.storage_path) {
      throw new Error('Asset has no storage path — cannot overwrite in place. Download from Canva manually.')
    }
    const storagePath = asset.storage_path as string
    // Infer bucket from path prefix set by uploadGeminiImageToSupabase
    const bucket = storagePath.startsWith('generated-creatives/') ? 'brand-assets' : 'creative-assets'

    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, imageBuffer, { contentType: 'image/png', upsert: true })
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath)
    const imageUrl = urlData.publicUrl

    // Step 5: Update DB — overwrite image_url so downstream tools see the latest version
    await supabase.from('creative_assets').update({
      image_url: imageUrl,
      editor_used: 'canva',
      status: 'edited',
      updated_at: new Date().toISOString(),
    }).eq('id', creativeAssetId)

    return new Response(JSON.stringify({ imageUrl }), { headers: corsHeaders() })
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: corsHeaders() }
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

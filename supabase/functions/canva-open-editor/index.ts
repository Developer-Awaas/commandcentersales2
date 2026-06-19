import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'

const CANVA_API_BASE = 'https://api.canva.com/rest/v1'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const clientId = Deno.env.get('CANVA_CLIENT_ID')
  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

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

  // Fetch the user's Canva token
  const { data: tokenRow } = await supabase
    .from('org_user_integrations')
    .select('access_token')
    .eq('user_id', userId)
    .eq('provider', 'canva')
    .single()

  if (!tokenRow?.access_token) {
    const authUrl = `https://www.canva.com/api/oauth/authorize?client_id=${clientId}&response_type=code&scope=design:content:read%20design:content:write%20asset:read%20asset:write&redirect_uri=${appUrl}/integrations/canva/callback&state=${encodeURIComponent(appUrl + '/creatives')}`
    return new Response(JSON.stringify({ needsAuth: true, authUrl }), { headers: corsHeaders() })
  }

  const accessToken = tokenRow.access_token

  if (!asset.image_url) {
    return new Response(
      JSON.stringify({ error: 'Asset has no image URL — the image may still be generating. Refresh and try again.' }),
      { status: 400, headers: corsHeaders() }
    )
  }

  try {
    // Step 1: Upload image via URL import
    const uploadRes = await fetch(`${CANVA_API_BASE}/asset-uploads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        import_type: 'url',
        import_url: asset.image_url,
        name: `CC2-${asset.campaign_id ?? 'creative'}-${asset.angle}`,
      }),
    })
    const uploadJson = await uploadRes.json() as { job?: { id?: string }; error?: { message?: string } }
    if (!uploadRes.ok) throw new Error(uploadJson?.error?.message ?? `Canva upload error ${uploadRes.status}`)
    const jobId = uploadJson.job?.id
    if (!jobId) throw new Error('No upload job ID returned from Canva')

    // Step 2: Poll upload job status
    let uploadedAssetId: string | null = null
    for (let i = 0; i < 10; i++) {
      await sleep(1500)
      const pollRes = await fetch(`${CANVA_API_BASE}/asset-uploads/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const pollJson = await pollRes.json() as { job?: { status?: string; asset?: { id?: string } } }
      if (pollJson.job?.status === 'success') {
        uploadedAssetId = pollJson.job.asset?.id ?? null
        break
      }
      if (pollJson.job?.status === 'failed') throw new Error('Canva asset upload failed')
    }
    if (!uploadedAssetId) throw new Error('Canva upload timed out')

    // Step 3: Create design with uploaded asset
    const designRes = await fetch(`${CANVA_API_BASE}/designs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        design_type: { type: 'preset', name: 'InstagramPost' },
        asset_id: uploadedAssetId,
      }),
    })
    const designJson = await designRes.json() as { design?: { id?: string; urls?: { edit_url?: string } }; error?: { message?: string } }
    if (!designRes.ok) throw new Error(designJson?.error?.message ?? `Canva design error ${designRes.status}`)

    const designId = designJson.design?.id
    const editUrl = designJson.design?.urls?.edit_url
    if (!editUrl) throw new Error('No edit URL returned from Canva')

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

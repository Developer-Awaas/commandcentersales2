import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const clientId = Deno.env.get('CANVA_CLIENT_ID')!
  const clientSecret = Deno.env.get('CANVA_CLIENT_SECRET')!
  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

  // State is a JSON payload {returnUrl, userId, orgId} encoded by CanvaConnectButton.
  // Browser redirects never carry an Authorization header, so user identity must come
  // from the state parameter that was set before the OAuth redirect.
  let returnUrl = appUrl
  let stateUserId: string | null = null
  let stateOrgId: string | null = null

  if (state) {
    try {
      const parsed = JSON.parse(decodeURIComponent(state)) as {
        returnUrl?: string
        userId?: string
        orgId?: string
      }
      returnUrl = parsed.returnUrl ?? appUrl
      stateUserId = parsed.userId ?? null
      stateOrgId = parsed.orgId ?? null
    } catch {
      // Legacy format: state was just the plain return URL
      returnUrl = decodeURIComponent(state)
    }
  }

  if (!code) {
    return Response.redirect(`${appUrl}/?canva_error=no_code`, 302)
  }

  if (!stateUserId) {
    return Response.redirect(
      `${appUrl}/?canva_error=${encodeURIComponent('OAuth state missing user identity — please try connecting again')}`,
      302
    )
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/canva-oauth-callback`,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    const tokenJson = await tokenRes.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      error?: string
    }

    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error ?? `Token exchange failed: ${tokenRes.status}`)
    }

    const expiresAt = new Date(Date.now() + (tokenJson.expires_in ?? 3600) * 1000).toISOString()

    // Upsert token using user identity from the OAuth state parameter
    await supabase.from('org_user_integrations').upsert({
      user_id: stateUserId,
      org_id: stateOrgId ?? '00000000-0000-0000-0000-000000000001',
      provider: 'canva',
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token ?? null,
      token_expires_at: expiresAt,
      scopes: ['design:content:read', 'design:content:write', 'asset:read', 'asset:write'],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' })

    return Response.redirect(`${returnUrl}?canva_connected=1`, 302)
  } catch (err: unknown) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : String(err))
    return Response.redirect(`${appUrl}/?canva_error=${msg}`, 302)
  }
})

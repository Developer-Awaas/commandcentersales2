import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { consumeOAuthFlowSession } from '../_shared/canva-oauth.ts'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const clientId = Deno.env.get('CANVA_CLIENT_ID')!
  const clientSecret = Deno.env.get('CANVA_CLIENT_SECRET')!
  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

  if (!code) {
    return Response.redirect(`${appUrl}/?canva_error=no_code`, 302)
  }

  // state is now an opaque nonce only — never JSON, never carries identity.
  // The real identity, return URL, and PKCE code_verifier live server-side
  // in oauth_flow_sessions, resolved here single-use (deleted on read).
  if (!state) {
    return Response.redirect(`${appUrl}/?canva_error=${encodeURIComponent('Missing OAuth state')}`, 302)
  }
  const sessionResult = await consumeOAuthFlowSession(supabase, state)
  if (!sessionResult.ok) {
    return Response.redirect(`${appUrl}/?canva_error=${encodeURIComponent(sessionResult.error)}`, 302)
  }
  const { userId: stateUserId, orgId: stateOrgId, codeVerifier, returnUrl } = sessionResult.session

  try {
    // Exchange code for tokens — code_verifier is PKCE's proof that this
    // exchange is being made by the same party that initiated the
    // authorize request (see _shared/canva-oauth.ts for why this exists).
    const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/canva-oauth-callback`,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
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

    // Upsert token using identity resolved server-side from the oauth_flow_sessions row
    await supabase.from('org_user_integrations').upsert({
      user_id: stateUserId,
      org_id: stateOrgId,
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

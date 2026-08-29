/**
 * meta-oauth-start
 *
 * Backs the "Connect with Facebook" button in Settings. Mirrors
 * canva-connect-init: identity comes from the caller's own JWT (never from the
 * request body), and the dialog URL carries a single-use opaque nonce as
 * `state` — no identity, no org id, nothing an attacker could forge into it.
 *
 * The org that ends up connected is the one resolved HERE and parked in
 * oauth_flow_sessions, not one named by whoever hits the callback.
 */
import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { resolveCallerIdentity } from '../_shared/canva-oauth.ts'
import { isOrgAdmin } from '../_shared/require-admin.ts'
import { buildMetaAuthUrl, metaConfigured, metaAppId } from '../_shared/meta-oauth.ts'

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

/** Must match a Valid OAuth Redirect URI in the Meta app dashboard exactly. */
function callbackUrl(): string {
  return (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '') + '/functions/v1/meta-oauth-callback'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  if (!metaConfigured()) {
    return new Response(
      JSON.stringify({ error: 'Meta app credentials are not configured on this project (META_APP_ID / META_APP_SECRET).' }),
      { status: 503, headers: corsHeaders() },
    )
  }

  let body: { returnUrl?: string } = {}
  try { body = await req.json() } catch { /* returnUrl is optional */ }

  const identity = await resolveCallerIdentity(req)
  if (!identity.ok) {
    return new Response(JSON.stringify({ error: identity.error }), { status: identity.status, headers: corsHeaders() })
  }

  const serviceClient = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Admin only — same reason as meta-token-connect: this flow ends in a
  // storeMetaConnection write to the org row, via the service-role key.
  if (!(await isOrgAdmin(serviceClient, identity.identity.userId))) {
    return new Response(
      JSON.stringify({ error: 'Only an organisation admin can connect a Meta account.' }),
      { status: 403, headers: corsHeaders() },
    )
  }

  // Rows are marked consumed rather than deleted (so a replay can be told from
  // a forged state), which means they need sweeping. Opportunistic and cheap:
  // anything past its expiry is dead regardless of outcome.
  await serviceClient
    .from('oauth_flow_sessions')
    .delete()
    .lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

  // Reuses the Canva flow's session table (it already carries `provider`).
  // code_verifier is NULL: Facebook has no PKCE, and the migration relaxed the
  // column rather than have us store a fake verifier that implies otherwise.
  const { data: session, error } = await serviceClient
    .from('oauth_flow_sessions')
    .insert({
      provider: 'meta',
      user_id: identity.identity.userId,
      org_id: identity.identity.orgId,
      code_verifier: null,
      return_url: body.returnUrl ?? '',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
    .select('nonce')
    .single()

  if (error || !session) {
    return new Response(
      JSON.stringify({ error: 'Could not start the connect flow: ' + (error?.message ?? 'no session row returned') }),
      { status: 500, headers: corsHeaders() },
    )
  }

  return new Response(
    JSON.stringify({
      authUrl: buildMetaAuthUrl(String((session as { nonce: string }).nonce), callbackUrl()),
      appId: metaAppId(),
      redirectUri: callbackUrl(),
    }),
    { headers: corsHeaders() },
  )
})

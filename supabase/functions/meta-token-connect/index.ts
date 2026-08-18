/**
 * meta-token-connect
 *
 * The manual System User token path (Settings -> Advanced), moved server-side.
 *
 * It used to be a direct client write: SettingsPage wrote meta_access_token
 * straight into org_integrations. That is how a token from a DELETED app sat
 * there looking healthy for a month while meta-insights-sync logged nothing
 * but `skipped`. Nothing checked it, and nothing could have — /debug_token
 * needs the app secret, which must never reach the browser.
 *
 * So the paste path now comes through the same door as OAuth: verify against
 * /debug_token first, reject dead or foreign-app tokens with a message that
 * says which app minted it, and only then store — with provenance recorded.
 *
 * This path is retained deliberately, not tolerated: System User tokens are
 * the right long-term shape for headless cron sync (they do not expire), and
 * a re-mint for an existing customer will use exactly this.
 */
import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { resolveCallerIdentity } from '../_shared/canva-oauth.ts'
import {
  verifyMetaToken,
  resolveMetaAssets,
  storeMetaConnection,
  metaConfigured,
  metaAppId,
} from '../_shared/meta-oauth.ts'

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: corsHeaders() })
  }
  if (!metaConfigured()) {
    return new Response(
      JSON.stringify({ error: 'Meta app credentials are not configured on this project, so this token cannot be verified. Tokens are never stored unverified.' }),
      { status: 503, headers: corsHeaders() },
    )
  }

  let body: { token?: string; adAccountId?: string } = {}
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }
  const token = (body.token ?? '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'token is required' }), { status: 400, headers: corsHeaders() })
  }

  // org comes from the caller's JWT, never the body.
  const identity = await resolveCallerIdentity(req)
  if (!identity.ok) {
    return new Response(JSON.stringify({ error: identity.error }), { status: identity.status, headers: corsHeaders() })
  }

  // THE DOOR — before any write.
  const verified = await verifyMetaToken(token)
  if (!verified.ok) {
    // 422, not 500: the request was well-formed, the token is the problem.
    // The message names the minting app when it is a foreign one, so "why was
    // this rejected" never needs a second investigation.
    return new Response(
      JSON.stringify({ error: verified.error, reason: verified.reason, expectedAppId: metaAppId() }),
      { status: 422, headers: corsHeaders() },
    )
  }

  const serviceClient = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const assets = await resolveMetaAssets(token)
  // An explicitly supplied ad account wins over discovery — the user typing it
  // is a stronger signal than picking the first of their accounts.
  if (body.adAccountId && body.adAccountId.trim()) assets.adAccountId = body.adAccountId.trim()

  const stored = await storeMetaConnection(serviceClient, identity.identity.orgId, token, verified.facts, assets)
  if (!stored.ok) {
    return new Response(JSON.stringify({ error: stored.error }), { status: 500, headers: corsHeaders() })
  }

  return new Response(
    JSON.stringify({
      ok: true,
      appId: verified.facts.appId,
      tokenType: verified.facts.tokenType,
      expiresAt: verified.facts.expiresAt,
      grantedScopes: verified.facts.scopes,
      adAccountId: assets.adAccountId,
      pageId: assets.pageId,
      igUserId: assets.igUserId,
    }),
    { headers: corsHeaders() },
  )
})

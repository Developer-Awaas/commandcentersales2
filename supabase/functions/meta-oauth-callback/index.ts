/**
 * meta-oauth-callback
 *
 * Where Facebook sends the browser after consent. This URL is what goes in the
 * Meta app's "Valid OAuth Redirect URIs":
 *
 *   https://<project-ref>.supabase.co/functions/v1/meta-oauth-callback
 *
 * Like canva-oauth-callback, it must be reachable WITHOUT a Supabase auth
 * header — a browser redirect carries no Authorization header (bug #1), which
 * is exactly why identity lives in the single-use session row keyed by the
 * state nonce rather than in the request. Deploy with --no-verify-jwt.
 *
 * Order is deliberate and load-bearing:
 *   consume nonce -> exchange code -> VERIFY via /debug_token -> store.
 * Verification sits before the write so a token from a foreign or deleted app
 * can never reach org_integrations. That is the failure this whole feature
 * exists to prevent.
 */
import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { consumeOAuthFlowSession } from '../_shared/canva-oauth.ts'
import {
  exchangeCodeForLongLivedToken,
  verifyMetaToken,
  resolveMetaAssets,
  storeMetaConnection,
  metaConfigured,
} from '../_shared/meta-oauth.ts'

function callbackUrl(): string {
  return (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '') + '/functions/v1/meta-oauth-callback'
}

/**
 * The user is looking at a browser tab, not reading JSON. Render a real page
 * and signal the opener through localStorage — the same mechanism the Canva
 * flow settled on after window.opener proved unusable under COOP (bug #45).
 */
function page(title: string, detail: string, ok: boolean): Response {
  const safe = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${safe(title)}</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:520px;margin:0 auto;padding:56px 24px;color:#1a1a1a;line-height:1.6}
h1{font-size:1.3rem;margin:0 0 .5rem}p{color:#555}.k{color:${ok ? '#0a7d32' : '#b3261e'};font-weight:600}
</style></head><body>
<h1 class="k">${safe(title)}</h1><p>${safe(detail)}</p>
<p>You can close this tab and return to Command Center.</p>
<script>
try{localStorage.setItem('meta_oauth_result',JSON.stringify({ok:${ok ? 'true' : 'false'},ts:Date.now()}));
localStorage.removeItem('meta_oauth_result');}catch(e){}
setTimeout(function(){try{window.close()}catch(e){}},1200);
</script></body></html>`
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  // The user pressed Cancel on Meta's consent screen — a normal outcome, not
  // an error worth alarming anyone about.
  const denied = url.searchParams.get('error')
  if (denied) {
    return page('Connection cancelled', url.searchParams.get('error_description') ?? 'No changes were made.', false)
  }
  if (!code || !state) return page('Connection failed', 'Meta did not return an authorization code.', false)
  if (!metaConfigured()) return page('Connection failed', 'Meta app credentials are not configured on this project.', false)

  const serviceClient = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Single-use: resolving the nonce MARKS IT CONSUMED (it is no longer deleted
  // — see the migration), so a replayed callback still cannot re-run the flow,
  // but it can now be recognised as a replay rather than as an invalid state.
  const session = await consumeOAuthFlowSession(serviceClient, state)
  if (!session.ok) {
    // A REPLAY is not a failure. Facebook appends #_=_ and browsers prefetch,
    // so a successful connect is routinely followed by a second hit on the same
    // state — which found the consumed row and rendered "Connection failed"
    // over a connection that had just worked. Verified on 2026-08-20: the token
    // was stored at 10:20:11 while the user was looking at an error page.
    if (session.reason === 'already_used') {
      return page('Already connected', session.error, true)
    }
    return page('Connection failed', session.error, false)
  }

  const exchanged = await exchangeCodeForLongLivedToken(code, callbackUrl())
  if (!exchanged.ok) return page('Connection failed', exchanged.error, false)

  // THE DOOR — before any write.
  const verified = await verifyMetaToken(exchanged.accessToken)
  if (!verified.ok) return page('Connection rejected', verified.error, false)

  const assets = await resolveMetaAssets(exchanged.accessToken)
  const stored = await storeMetaConnection(
    serviceClient,
    session.session.orgId,
    exchanged.accessToken,
    verified.facts,
    assets,
  )
  if (!stored.ok) return page('Connection failed', stored.error, false)

  const granted = verified.facts.scopes.length
    ? verified.facts.scopes.join(', ')
    : 'none reported'
  return page(
    'Facebook connected',
    'Granted permissions: ' + granted + '.' +
      (assets.adAccountId ? ' Ad account ' + assets.adAccountId + '.' : ' No ad account found — pick one in Settings.'),
    true,
  )
})

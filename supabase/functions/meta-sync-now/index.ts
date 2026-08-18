/**
 * meta-sync-now
 *
 * The "Sync Now" button's own endpoint. It exists because meta-insights-sync
 * is cron-shaped and must stay that way.
 *
 * THE BUG THIS FIXES: Settings' Sync Now called meta-insights-sync directly
 * from the browser. That function has no CORS headers and no OPTIONS handler,
 * so the preflight came back without Access-Control-Allow-Origin and the
 * browser refused the request — surfacing as "Failed to send a request to the
 * Edge Function". It had therefore never worked from the UI.
 *
 * Worse, the preflight was not harmless: meta-insights-sync has no method
 * check, so an OPTIONS request ran a FULL ALL-ORG SWEEP. Adding CORS headers
 * to it would have kept that behaviour and made every preflight a cron run.
 *
 * So the split is deliberate:
 *   meta-insights-sync  cron, all orgs, no CORS, service-role shaped
 *   meta-sync-now       one org, authenticated by the caller's JWT, CORS,
 *                       rate-limited
 * Both call the same syncOrgMetrics from _shared/meta-sync-core.ts.
 */
import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { resolveCallerIdentity } from '../_shared/canva-oauth.ts'
import { syncOrgMetrics } from '../_shared/meta-sync-core.ts'

/** Per-org cooldown. A sync is several Graph round trips plus an async report
 *  job; letting an impatient user queue ten of them is how a rate limit gets
 *  hit for the whole org. The cron sweep is unaffected — it has its own path. */
const COOLDOWN_MS = 60_000

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
}

Deno.serve(async (req) => {
  // Answer the preflight and STOP. No sync work on an OPTIONS request — the
  // absence of this check in the cron function is what made preflights run a
  // full sweep.
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: corsHeaders() })
  }

  // Org comes from the caller's own JWT, never the body — otherwise this would
  // be an unauthenticated "sync any org you can name" endpoint.
  const identity = await resolveCallerIdentity(req)
  if (!identity.ok) {
    return new Response(JSON.stringify({ error: identity.error }), { status: identity.status, headers: corsHeaders() })
  }
  const orgId = identity.identity.orgId

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: integration, error: intErr } = await supabase
    .from('org_integrations')
    .select('id, org_id, meta_ad_account_id, meta_access_token, meta_app_id, meta_verified_at, status')
    .eq('org_id', orgId)
    .eq('provider', 'meta')
    .maybeSingle()

  if (intErr) {
    return new Response(JSON.stringify({ error: intErr.message }), { status: 500, headers: corsHeaders() })
  }
  if (!integration) {
    return new Response(
      JSON.stringify({ error: 'No Meta connection for this organisation. Connect one in Settings first.' }),
      { status: 404, headers: corsHeaders() },
    )
  }
  if ((integration as { status?: string }).status === 'disabled') {
    return new Response(
      JSON.stringify({ error: 'This Meta connection is disabled.' }),
      { status: 409, headers: corsHeaders() },
    )
  }

  // Cooldown, measured from the last attempt of ANY outcome — a failing sync
  // is exactly the one a user retries hardest, and it costs the same quota.
  const { data: recent } = await supabase
    .from('integration_sync_log')
    .select('created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastAt = recent ? Date.parse((recent as { created_at: string }).created_at) : 0
  const sinceLast = Date.now() - lastAt
  if (lastAt && sinceLast < COOLDOWN_MS) {
    const retryIn = Math.ceil((COOLDOWN_MS - sinceLast) / 1000)
    return new Response(
      JSON.stringify({ error: `Just synced. Try again in ${retryIn}s.`, retryInSeconds: retryIn }),
      { status: 429, headers: { ...corsHeaders(), 'Retry-After': String(retryIn) } },
    )
  }

  const startedAt = Date.now()
  try {
    const rows = await syncOrgMetrics(supabase, integration as Parameters<typeof syncOrgMetrics>[1])
    return new Response(
      JSON.stringify({ status: 'success', rows, durationMs: Date.now() - startedAt }),
      { headers: corsHeaders() },
    )
  } catch (err) {
    // syncOrgMetrics has already written the detailed integration_sync_log row
    // (including the trust-gate rejection message). This just surfaces it to
    // the user who clicked, rather than leaving them at a spinner.
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ status: 'error', error: message, durationMs: Date.now() - startedAt }),
      { status: 502, headers: corsHeaders() },
    )
  }
})

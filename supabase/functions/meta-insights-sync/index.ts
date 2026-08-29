import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { syncOrgMetrics } from '../_shared/meta-sync-core.ts'
import { denyUnlessCron } from '../_shared/cron-guard.ts'

// pg_cron entry point: sweeps EVERY non-disabled org. The per-org sync itself
// lives in _shared/meta-sync-core.ts, shared with meta-sync-now (the
// authenticated, single-org "Sync Now" path) so the two cannot drift.
//
// Deliberately NOT browser-callable: no CORS headers here. That is not an
// oversight to fix by adding them — a preflight would otherwise trigger a full
// all-org sweep, which is exactly what was happening before meta-sync-now
// existed (an OPTIONS request ran the whole cron job).
Deno.serve(async (req) => {
  // Cron-only. pg_cron sends the service-role bearer; nothing else may run this.
  const denied = denyUnlessCron(req)
  if (denied) return denied

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: integrations, error: intErr } = await supabase
    .from('org_integrations')
    .select('id, org_id, meta_ad_account_id, meta_access_token, meta_app_id, meta_verified_at, status')
    .eq('provider', 'meta')
    // NOT filtered on is_active/status='active': an 'invalid' row must still be
    // visited so it can RECOVER once reconnected. Filtering it out is exactly
    // how Neelachala Homes vanished from this loop for a month — auto-disabled
    // on an auth error, then never looked at again, with no log line at all.
    .neq('status', 'disabled')

  if (intErr) {
    return new Response(JSON.stringify({ error: intErr.message }), { status: 500 })
  }

  const results: { org_id: string; status: string; rows?: number; error?: string }[] = []

  for (const integration of integrations ?? []) {
    const start = Date.now()
    try {
      const rows = await syncOrgMetrics(supabase, integration)
      results.push({ org_id: integration.org_id, status: 'success', rows })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ org_id: integration.org_id, status: 'error', error: msg })
    }
    const duration = Date.now() - start
    console.log(`org ${integration.org_id} synced in ${duration}ms`)
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

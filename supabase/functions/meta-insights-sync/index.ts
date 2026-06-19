import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database, Json } from '../_shared/database.types.ts'

type DB = SupabaseClient<Database>
type SyncStatus = Database['public']['Tables']['integration_sync_log']['Insert']['status']

const META_API_BASE = 'https://graph.facebook.com/v21.0'
const INSIGHTS_FIELDS = 'campaign_id,campaign_name,impressions,clicks,spend,ctr,frequency,reach,actions,cost_per_action_type,date_start,date_stop'

Deno.serve(async (_req) => {
  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: integrations, error: intErr } = await supabase
    .from('org_integrations')
    .select('id, org_id, meta_ad_account_id, meta_access_token')
    .eq('provider', 'meta')
    .eq('is_active', true)

  if (intErr) {
    return new Response(JSON.stringify({ error: intErr.message }), { status: 500 })
  }

  const results: { org_id: string; status: string; rows?: number; error?: string }[] = []

  for (const integration of integrations ?? []) {
    const start = Date.now()
    try {
      await syncOrgMetrics(supabase, integration)
      results.push({ org_id: integration.org_id, status: 'success' })
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

async function syncOrgMetrics(
  supabase: DB,
  integration: { id: string; org_id: string; meta_ad_account_id: string | null; meta_access_token: string | null }
) {
  const { org_id, meta_ad_account_id, meta_access_token } = integration
  if (!meta_ad_account_id || !meta_access_token) {
    await logSync(supabase, org_id, 'skipped', 0, undefined, undefined, 0)
    return
  }

  const start = Date.now()

  // Step 1: POST async insights job
  const jobRes = await fetch(
    `${META_API_BASE}/${meta_ad_account_id}/insights`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: INSIGHTS_FIELDS,
        date_preset: 'last_30d',
        level: 'campaign',
        access_token: meta_access_token,
      }),
    }
  )

  // Check throttle header
  const throttleHeader = jobRes.headers.get('x-fb-ads-insights-throttle')
  let throttlePct = 0
  if (throttleHeader) {
    try {
      const parsed = JSON.parse(throttleHeader)
      throttlePct = parsed.acc_id_util_pct ?? 0
    } catch { /* ignore */ }
  }

  if (throttlePct > 75) {
    await logSync(supabase, org_id, 'throttled', 0, undefined, throttlePct, Date.now() - start)
    return
  }

  const jobJson = await jobRes.json() as { report_run_id?: string; error?: { code?: number; message?: string } }

  if (jobJson.error) {
    const code = jobJson.error.code
    if (code === 190) {
      // Invalid token — deactivate integration
      await supabase.from('org_integrations').update({ is_active: false }).eq('id', integration.id)
    }
    const isThrottle = code === 4 || code === 17
    await logSync(supabase, org_id, isThrottle ? 'throttled' : 'error', 0, jobJson.error.message, throttlePct, Date.now() - start)
    return
  }

  const reportRunId = jobJson.report_run_id
  if (!reportRunId) throw new Error('No report_run_id returned')

  // Step 2: Poll job status
  let attempts = 0
  let resultCursor: string | null = null

  while (attempts < 15) {
    await sleep(5000 * Math.min(attempts + 1, 3))
    const statusRes = await fetch(
      `${META_API_BASE}/${reportRunId}?access_token=${meta_access_token}`
    )
    const statusJson = await statusRes.json() as { async_percent_completion?: number; async_status?: string; error?: { message?: string } }

    if (statusJson.error) throw new Error(statusJson.error.message)
    if (statusJson.async_status === 'Job Completed') {
      resultCursor = reportRunId
      break
    }
    if (statusJson.async_status === 'Job Failed') throw new Error('Meta insights job failed')
    attempts++
  }

  if (!resultCursor) {
    await logSync(supabase, org_id, 'error', 0, 'Job timed out after 15 polls', throttlePct, Date.now() - start)
    return
  }

  // Step 3: Fetch results
  const dataRes = await fetch(
    `${META_API_BASE}/${resultCursor}/insights?access_token=${meta_access_token}`
  )
  const dataJson = await dataRes.json() as { data?: Record<string, unknown>[] }
  const rows = dataJson.data ?? []

  // Step 4: Upsert into campaign_metrics
  const upsertRows = rows.map((row) => {
    const actions = (row.actions as { action_type: string; value: string }[] | undefined) ?? []
    const costPerAction = (row.cost_per_action_type as { action_type: string; value: string }[] | undefined) ?? []
    const leadsAction = actions.find((a) => a.action_type === 'lead')
    const cplAction = costPerAction.find((a) => a.action_type === 'lead')

    return {
      org_id,
      campaign_id: String(row.campaign_id ?? ''),
      campaign_name: String(row.campaign_name ?? ''),
      ad_account_id: meta_ad_account_id,
      date_start: String(row.date_start ?? ''),
      date_stop: String(row.date_stop ?? ''),
      impressions: parseInt(String(row.impressions ?? '0')) || 0,
      clicks: parseInt(String(row.clicks ?? '0')) || 0,
      reach: parseInt(String(row.reach ?? '0')) || 0,
      spend: parseFloat(String(row.spend ?? '0')) || 0,
      ctr: parseFloat(String(row.ctr ?? '0')) || 0,
      frequency: parseFloat(String(row.frequency ?? '0')) || 0,
      leads: leadsAction ? parseInt(leadsAction.value) || 0 : 0,
      cpl: cplAction ? parseFloat(cplAction.value) || null : null,
      platform: 'meta' as const,
      synced_at: new Date().toISOString(),
      raw_payload: row as unknown as Json,
    }
  })
  if (upsertRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from('campaign_metrics')
      .upsert(upsertRows, { onConflict: 'org_id,campaign_id,date_start,date_stop,platform' })
    if (upsertErr) throw new Error(upsertErr.message)
  }

  // Update last_sync_at
  await supabase.from('org_integrations').update({ last_sync_at: new Date().toISOString() }).eq('id', integration.id)
  await logSync(supabase, org_id, 'success', upsertRows.length, undefined, throttlePct, Date.now() - start)
}

async function logSync(
  supabase: DB,
  orgId: string,
  status: SyncStatus,
  rowsSynced: number,
  error?: string,
  throttlePct?: number,
  durationMs?: number
) {
  await supabase.from('integration_sync_log').insert({
    org_id: orgId,
    provider: 'meta',
    status,
    rows_synced: rowsSynced,
    error: error ?? null,
    throttle_pct: throttlePct ?? null,
    duration_ms: durationMs ?? null,
  })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

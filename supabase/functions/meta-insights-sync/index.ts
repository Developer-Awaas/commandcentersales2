import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database, Json } from '../_shared/database.types.ts'

type DB = SupabaseClient<Database>
type SyncStatus = Database['public']['Tables']['integration_sync_log']['Insert']['status']

const META_API_BASE = 'https://graph.facebook.com/v21.0'
const INSIGHTS_FIELDS = 'campaign_id,campaign_name,impressions,clicks,spend,ctr,frequency,reach,actions,cost_per_action_type,date_start,date_stop'
// Ad-level fields for Phase 7 creative attribution
const AD_INSIGHTS_FIELDS = 'ad_id,ad_name,adset_id,campaign_id,impressions,clicks,reach,spend,ctr,actions,cost_per_action_type,date_start,date_stop'
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
// Max live promoted creatives per org (anti-storage runaway)
const MAX_LIVE_CREATIVES = 10

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

// ── Org-level orchestrator ────────────────────────────────────────────────────
// Determines which ad accounts to sync for this org:
//   1. Projects with their own meta_ad_account_id → sync each, tag rows with project_id
//   2. Fallback: org-level account from org_integrations → sync without project tag
// Token is always org-level (one System User token covers all accounts under the BM).

async function syncOrgMetrics(
  supabase: DB,
  integration: { id: string; org_id: string; meta_ad_account_id: string | null; meta_access_token: string | null }
): Promise<number> {
  const { org_id, meta_ad_account_id: globalAccountId, meta_access_token } = integration

  if (!meta_access_token) {
    await logSync(supabase, org_id, 'skipped', 0, undefined, undefined, 0)
    return 0
  }

  const start = Date.now()

  // Fetch projects that have their own Meta ad account configured
  const { data: projectRows } = await supabase
    .from('projects')
    .select('id, meta_ad_account_id')
    .eq('org_id', org_id)
    .eq('is_active', true)
    .not('meta_ad_account_id', 'is', null)

  type Target = { accountId: string; projectId: string | null }
  const targets: Target[] = projectRows && projectRows.length > 0
    ? (projectRows as { id: string; meta_ad_account_id: string }[])
        .map(p => ({ accountId: p.meta_ad_account_id, projectId: p.id }))
    : globalAccountId
    ? [{ accountId: globalAccountId, projectId: null }]
    : []

  if (targets.length === 0) {
    await logSync(supabase, org_id, 'skipped', 0, undefined, undefined, 0)
    return 0
  }

  let totalRows = 0
  let firstError: Error | null = null

  for (const { accountId, projectId } of targets) {
    try {
      const rows = await syncAccount(supabase, integration, accountId, projectId)
      totalRows += rows
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.error(`syncAccount failed org=${org_id} project=${projectId} account=${accountId}:`, e.message)
      if (!firstError) firstError = e
      // Token invalid affects all accounts — abort immediately
      if (e.message.includes('error 190')) throw e
    }
  }

  // If every account failed, surface the error to the outer loop
  if (totalRows === 0 && firstError) throw firstError

  await supabase.from('org_integrations').update({ last_sync_at: new Date().toISOString() }).eq('id', integration.id)
  await logSync(supabase, org_id, 'success', totalRows, undefined, 0, Date.now() - start)

  // Phase 7: ad-level sync (fire-and-forget, never blocks or throws into main flow)
  syncAdMetrics(supabase, integration).catch(err => console.error(`ad-metrics sync failed for org ${org_id}:`, err))

  // Phase 4: Arjun performance promotion (fire-and-forget, never blocks main sync)
  arjunPromoteCreatives(supabase, org_id).catch(err => console.error(`arjun promote failed for org ${org_id}:`, err))

  return totalRows
}

// ── Per-account sync ─────────────────────────────────────────────────────────
// Runs the Meta async insights job for one (accountId, projectId) pair.
// projectId is null when using the org-level fallback account.

async function syncAccount(
  supabase: DB,
  integration: { id: string; org_id: string; meta_ad_account_id: string | null; meta_access_token: string | null },
  accountId: string,
  projectId: string | null
): Promise<number> {
  const { org_id, meta_access_token } = integration
  const start = Date.now()

  // Step 1: POST async insights job
  const jobRes = await fetch(
    `${META_API_BASE}/${accountId}/insights`,
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
    return 0
  }

  const jobJson = await jobRes.json() as { report_run_id?: string; error?: { code?: number; message?: string } }

  if (jobJson.error) {
    const code = jobJson.error.code
    if (code === 190) {
      // Invalid token — deactivate integration
      await supabase.from('org_integrations').update({ is_active: false }).eq('id', integration.id)
    }
    const isThrottle = code === 4 || code === 17
    const metaMsg = jobJson.error.message ?? 'unknown Meta error'
    await logSync(supabase, org_id, isThrottle ? 'throttled' : 'error', 0, metaMsg, throttlePct, Date.now() - start)
    // Throw so the outer loop records status:'error' and the client can surface the real message.
    throw new Error(`Meta API error ${code ?? ''}: ${metaMsg}`)
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
    return 0
  }

  // Step 3: Fetch results
  const dataRes = await fetch(
    `${META_API_BASE}/${resultCursor}/insights?access_token=${meta_access_token}`
  )
  const dataJson = await dataRes.json() as { data?: Record<string, unknown>[] }
  const rows = dataJson.data ?? []

  // Step 4: Upsert into campaign_metrics (tagged with projectId)
  const upsertRows = rows.map((row) => {
    const actions = (row.actions as { action_type: string; value: string }[] | undefined) ?? []
    const costPerAction = (row.cost_per_action_type as { action_type: string; value: string }[] | undefined) ?? []
    const leadsAction = actions.find((a) => a.action_type === 'lead')
    const cplAction = costPerAction.find((a) => a.action_type === 'lead')

    return {
      org_id,
      project_id: projectId,
      campaign_id: String(row.campaign_id ?? ''),
      campaign_name: String(row.campaign_name ?? ''),
      ad_account_id: accountId,
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

  return upsertRows.length
}

// ── Phase 7: ad-level insights sync ──────────────────────────────────────────

async function syncAdMetrics(
  supabase: DB,
  integration: { id: string; org_id: string; meta_ad_account_id: string | null; meta_access_token: string | null }
) {
  const { org_id, meta_ad_account_id, meta_access_token } = integration
  if (!meta_ad_account_id || !meta_access_token) return

  const jobRes = await fetch(`${META_API_BASE}/${meta_ad_account_id}/insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: AD_INSIGHTS_FIELDS,
      date_preset: 'last_30d',
      level: 'ad',
      access_token: meta_access_token,
    }),
  })

  const jobJson = await jobRes.json() as { report_run_id?: string; error?: { message?: string } }
  if (jobJson.error || !jobJson.report_run_id) return

  let attempts = 0
  let resultCursor: string | null = null
  while (attempts < 15) {
    await sleep(5000 * Math.min(attempts + 1, 3))
    const status = await (await fetch(`${META_API_BASE}/${jobJson.report_run_id}?access_token=${meta_access_token}`)).json() as { async_status?: string }
    if (status.async_status === 'Job Completed') { resultCursor = jobJson.report_run_id; break }
    if (status.async_status === 'Job Failed') return
    attempts++
  }
  if (!resultCursor) return

  const dataRes = await fetch(`${META_API_BASE}/${resultCursor}/insights?access_token=${meta_access_token}`)
  const dataJson = await dataRes.json() as { data?: Record<string, unknown>[] }
  const rows = dataJson.data ?? []

  const upsertRows = rows.map((row) => {
    const actions = (row.actions as { action_type: string; value: string }[] | undefined) ?? []
    const costPerAction = (row.cost_per_action_type as { action_type: string; value: string }[] | undefined) ?? []
    const leadsAction = actions.find(a => a.action_type === 'lead')
    const cplAction = costPerAction.find(a => a.action_type === 'lead')
    return {
      org_id,
      ad_account_id: meta_ad_account_id,
      campaign_id: String(row.campaign_id ?? ''),
      adset_id: row.adset_id ? String(row.adset_id) : null,
      ad_id: String(row.ad_id ?? ''),
      ad_name: String(row.ad_name ?? ''),
      date_start: String(row.date_start ?? ''),
      date_stop: String(row.date_stop ?? ''),
      impressions: parseInt(String(row.impressions ?? '0')) || 0,
      clicks: parseInt(String(row.clicks ?? '0')) || 0,
      reach: parseInt(String(row.reach ?? '0')) || 0,
      spend: parseFloat(String(row.spend ?? '0')) || 0,
      ctr: parseFloat(String(row.ctr ?? '0')) || 0,
      leads: leadsAction ? parseInt(leadsAction.value) || 0 : 0,
      cpl: cplAction ? parseFloat(cplAction.value) || null : null,
      platform: 'meta' as const,
      synced_at: new Date().toISOString(),
      raw_payload: row as unknown as Json,
    }
  })

  if (upsertRows.length > 0) {
    await supabase.from('ad_metrics').upsert(upsertRows, { onConflict: 'org_id,ad_id,date_start,date_stop,platform' })
  }
}

// ── Phase 4: Arjun performance promotion ─────────────────────────────────────
// Runs silently after each successful org sync. Reads campaign_metrics CPL vs
// org-level benchmark, promotes recent creative_assets to aanya_training_creatives
// if performance is strong. Enforces MAX_LIVE_CREATIVES cap per org.

async function arjunPromoteCreatives(supabase: DB, orgId: string) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return  // ANTHROPIC_API_KEY not set — skip silently, never crash main sync

  // 1. Compute avg CPL last 14 days
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 14)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const { data: metrics } = await supabase
    .from('campaign_metrics')
    .select('cpl')
    .eq('org_id', orgId)
    .gte('date_start', cutoffStr)
    .not('cpl', 'is', null)

  const cpls = (metrics ?? []).map(m => m.cpl as number).filter(v => v > 0)
  if (cpls.length < 3) return  // not enough data to draw conclusions

  const avgCpl = cpls.reduce((a, b) => a + b, 0) / cpls.length

  // 2. Compare to org-level benchmark
  const { data: benchmark } = await supabase
    .from('benchmarks')
    .select('avg_14d')
    .eq('org_id', orgId)
    .eq('metric_name', 'cpl')
    .is('project_id', null)
    .maybeSingle()

  const benchmarkCpl = (benchmark as { avg_14d?: number } | null)?.avg_14d ?? 0
  if (benchmarkCpl <= 0) return

  const ratio = avgCpl / benchmarkCpl
  const tier = ratio <= 0.75 ? 'top_performer' : ratio <= 0.95 ? 'good_performer' : null
  if (!tier) return  // average or worse — don't promote

  // 3. Find recent creative_assets for this org not yet in training
  const { data: assets } = await supabase
    .from('creative_assets')
    .select('id, image_url, storage_path, creative_id')
    .eq('org_id', orgId)
    .eq('status', 'generated')
    .gte('created_at', cutoff.toISOString())
    .not('image_url', 'is', null)

  if (!assets || assets.length === 0) return

  const { data: existing } = await supabase
    .from('aanya_training_creatives')
    .select('image_url')
    .eq('org_id', orgId)
    .eq('source', 'own_ad')

  const existingUrls = new Set((existing ?? []).map(e => e.image_url))
  const newAssets = (assets as { id: string; image_url: string; storage_path: string; creative_id: string | null }[])
    .filter(a => !existingUrls.has(a.image_url))

  if (newAssets.length === 0) return

  for (const asset of newAssets) {
    // Enforce cap: evict oldest is_live row when at limit
    const { count: liveCount } = await supabase
      .from('aanya_training_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_live', true)

    if ((liveCount ?? 0) >= MAX_LIVE_CREATIVES) {
      const { data: oldest } = await supabase
        .from('aanya_training_creatives')
        .select('id')
        .eq('org_id', orgId)
        .eq('is_live', true)
        .order('created_at', { ascending: true })
        .limit(1)
      if (oldest?.[0]) {
        await supabase.from('aanya_training_creatives').update({ is_live: false }).eq('id', oldest[0].id)
      }
    }

    // Resolve project_id via the creatives FK if available
    let projectId: string | null = null
    if (asset.creative_id) {
      const { data: creative } = await supabase
        .from('creatives')
        .select('project_id')
        .eq('id', asset.creative_id)
        .maybeSingle()
      projectId = (creative as { project_id?: string | null } | null)?.project_id ?? null
    }

    // Run 9-section Haiku vision analysis
    const visionAnalysis = await runHaikuVision(apiKey, asset.image_url)

    await supabase.from('aanya_training_creatives').insert({
      org_id: orgId,
      project_id: projectId,
      image_url: asset.image_url,
      storage_path: asset.storage_path ?? '',
      source: 'own_ad',
      performance_tier: tier,
      cpl: avgCpl,
      is_live: true,
      vision_analysis: visionAnalysis as unknown as Json,
      notes: `Auto-promoted: org avg CPL ₹${avgCpl.toFixed(0)} vs benchmark ₹${benchmarkCpl.toFixed(0)} (${(ratio * 100).toFixed(0)}%)`,
    })
  }
}

async function runHaikuVision(apiKey: string, imageUrl: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: `Analyze this real estate ad. Return JSON only:
{
  "description": "2-3 sentence visual summary",
  "patterns": ["layout: ...", "color: ...", "typography: ...", "composition: ..."],
  "section_1_scene_type": "GRAPHIC_DESIGN_FRAME|PHOTOREALISTIC_SCENE|TYPOGRAPHY_FORWARD",
  "section_3_lens": "e.g. 24mm wide-angle",
  "section_4_lighting": "e.g. Golden hour 3200K",
  "section_5_hex_colors": ["#RRGGBB"],
  "section_6_typography_elements": ["ELEMENT_TYPE: style"],
  "composition_split": "e.g. 60% visual / 40% info",
  "competitive_strengths": ["what makes this effective"],
  "avoid_reasons": []
}` },
          ],
        }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { content?: { type: string; text: string }[] }
    const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
    return JSON.parse(text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()) as Record<string, unknown>
  } catch {
    return null
  }
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

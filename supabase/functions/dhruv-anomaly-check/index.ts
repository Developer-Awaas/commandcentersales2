/**
 * dhruv-anomaly-check — pg_cron hourly job (no LLM, zero cost).
 *
 * Runs buildMetricsContext() for every org that has an active Meta
 * integration, then creates notifications for high-severity alerts
 * (CPL spike, ad fatigue). This is pure SQL + threshold math — Dhruv's
 * LLM narration is NOT invoked here; that only fires when the user asks
 * a question through aarav-orchestrate.
 *
 * Scheduled via migration 20260626010000_dhruv_anomaly_check_cron.sql.
 * Deployed with --no-verify-jwt (called by pg_cron, no user JWT).
 * Errors per-org are swallowed so one org can't block the rest.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildMetricsContext } from '../_shared/metrics-query.ts'

Deno.serve(async (_req: Request): Promise<Response> => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Only process orgs with an active Meta integration (they have live data).
  const { data: integrations, error: intErr } = await supabase
    .from('org_integrations')
    .select('org_id')
    .eq('provider', 'meta')
    .eq('is_active', true)

  if (intErr) {
    console.error('dhruv-anomaly-check: failed to fetch integrations:', intErr.message)
    return new Response(JSON.stringify({ error: intErr.message }), { status: 500 })
  }

  const orgs = integrations ?? []
  const results: { org_id: string; alerts_fired: number; error?: string }[] = []

  for (const { org_id } of orgs) {
    try {
      const ctx = await buildMetricsContext(supabase, org_id, 7)

      if (!ctx.has_data) {
        results.push({ org_id, alerts_fired: 0 })
        continue
      }

      const highAlerts = ctx.alerts.filter(a => a.severity === 'high')

      if (highAlerts.length === 0) {
        results.push({ org_id, alerts_fired: 0 })
        continue
      }

      // Deduplicate: skip if we already created the same alert type today
      // for this org (prevents hourly notification spam).
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('org_id', org_id)
        .eq('type', 'dhruv_alert')
        .gte('created_at', todayStart.toISOString())
        .limit(1)

      if ((existing ?? []).length > 0) {
        // Already sent an alert today — skip.
        results.push({ org_id, alerts_fired: 0 })
        continue
      }

      const topAlert = highAlerts[0]
      const additionalCount = highAlerts.length - 1
      const title = additionalCount > 0
        ? `⚠️ ${topAlert.message} (+${additionalCount} more alert${additionalCount > 1 ? 's' : ''})`
        : `⚠️ ${topAlert.message}`

      const { error: notifErr } = await supabase.from('notifications').insert({
        org_id,
        type: 'dhruv_alert',
        title: title.slice(0, 200),
        body: JSON.stringify(highAlerts),
        is_read: false,
      })

      if (notifErr) {
        console.error(`dhruv-anomaly-check: notification insert failed for org ${org_id}:`, notifErr.message)
        results.push({ org_id, alerts_fired: 0, error: notifErr.message })
      } else {
        results.push({ org_id, alerts_fired: highAlerts.length })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`dhruv-anomaly-check: error for org ${org_id}:`, msg)
      results.push({ org_id, alerts_fired: 0, error: msg })
    }
  }

  return new Response(JSON.stringify({ orgs_checked: orgs.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

/**
 * dhruv-weekly-report — pg_cron weekly job (CC-P4 Step 6).
 *
 * For every org with an active Meta integration AND real metrics, runs
 * buildMetricsContext -> Dhruv's 'report' intent -> writes a tool_outputs row
 * (tool='performance', domain='ads', payload.kind='weekly_report') + a
 * notification. Orgs with no data are SKIPPED — no hallucinated reports over
 * empty tables.
 *
 * Mirrors dhruv-anomaly-check's structure (per-org loop, buildMetricsContext,
 * notifications insert) but adds the LLM report + tool_outputs write. Unlike
 * anomaly-check this DOES spend on Sonnet (report intent, 4096 tokens) — hence
 * the strict has_data skip. Scheduled via a vault-backed weekly pg_cron
 * migration; deployed with --no-verify-jwt (pg_cron caller).
 *
 * Errors are per-org — one org failing never blocks the rest.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildMetricsContext } from '../_shared/metrics-query.ts'
import { runDhruv } from '../_shared/agents/dhruv.ts'

function claudeCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000
}

Deno.serve(async (_req: Request): Promise<Response> => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: integrations, error: intErr } = await supabase
    .from('org_integrations')
    .select('org_id')
    .eq('provider', 'meta')
    .eq('is_active', true)

  if (intErr) {
    console.error('dhruv-weekly-report: failed to fetch integrations:', intErr.message)
    return new Response(JSON.stringify({ error: intErr.message }), { status: 500 })
  }

  const orgs = integrations ?? []
  const results: { org_id: string; wrote_report: boolean; error?: string }[] = []

  for (const { org_id } of orgs) {
    try {
      const ctx = await buildMetricsContext(supabase, org_id, 30)
      if (!ctx.has_data) {
        // No metrics — skip rather than hallucinate a report over empty tables.
        results.push({ org_id, wrote_report: false })
        continue
      }

      const dhruv = await runDhruv({
        orgId: org_id,
        intent: 'report',
        message: 'Generate this week\'s performance report.',
        metricsContext: ctx,
      })

      await supabase.from('tool_outputs').insert({
        org_id,
        domain: 'ads',
        tool: 'performance',
        payload: { kind: 'weekly_report', report: dhruv.output },
        asset_refs: [],
        status: 'saved',
      })

      // Cost row for the report call (cron has no user).
      await supabase.from('agent_interactions').insert({
        org_id, user_id: null, agent: 'dhruv', trace_id: `weekly-report-${org_id}`,
        model: dhruv.model, input_tokens: dhruv.inputTokens, output_tokens: dhruv.outputTokens,
        cost_usd: claudeCostUsd(dhruv.inputTokens, dhruv.outputTokens),
      })

      const title = (dhruv.output as { title?: string }).title ?? "This week's performance report"
      // NOTE: the column is `message`, not `body`. Supabase's .insert<T>() infers
      // its argument generically, which suppresses excess-property checking, so a
      // wrong key like `body` slips past `deno check` and silently no-ops at
      // runtime (returns {error}, never throws). See CLAUDE.md bug #47.
      const { error: notifErr } = await supabase.from('notifications').insert({
        org_id,
        type: 'weekly_report',
        title: title.slice(0, 200),
        message: JSON.stringify({ kind: 'weekly_report' }),
        is_read: false,
      })
      if (notifErr) {
        console.error(`dhruv-weekly-report: notification insert failed for org ${org_id}:`, notifErr.message)
      }

      results.push({ org_id, wrote_report: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`dhruv-weekly-report: error for org ${org_id}:`, msg)
      results.push({ org_id, wrote_report: false, error: msg })
    }
  }

  return new Response(JSON.stringify({ orgs_checked: orgs.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

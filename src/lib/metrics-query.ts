/**
 * metrics-query.ts — client-side MetricsContext computation.
 *
 * Same pure-math logic as supabase/functions/_shared/metrics-query.ts but
 * uses the browser's @supabase/supabase-js SupabaseClient. This lets
 * DhruvInsightCards.tsx read campaign_metrics and render alert cards on
 * Dashboard load — zero LLM cost, zero edge-function call.
 *
 * Dhruv's LLM narration still routes through aarav-orchestrate; this file
 * only handles the pre-computation layer that also feeds dashboard cards.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Public types (mirrors server-side version) ───────────────────────────────

export interface CampaignSummary {
  campaign_id: string
  campaign_name: string
  spend_30d: number
  leads_30d: number
  cpl_avg: number
  ctr_avg: number
  impressions_30d: number
  clicks_30d: number
}

export interface MetricAlert {
  type: 'cpl_spike' | 'ad_fatigue' | 'ctr_drop'
  severity: 'high' | 'medium' | 'low'
  campaign_id: string
  campaign_name: string
  message: string
  value: number
  threshold: number
}

export interface DayPerformance {
  day_of_week: number
  day_name: string
  avg_cpl: number
  avg_ctr: number
  avg_spend: number
  data_points: number
}

export interface MetricsContext {
  period: { start: string; end: string; days: number }
  campaigns: CampaignSummary[]
  aggregates: {
    total_spend: number
    total_leads: number
    avg_cpl: number
    avg_ctr: number
    wow_cpl_delta_pct: number
    wow_spend_delta_pct: number
    impressions_total: number
    clicks_total: number
  }
  alerts: MetricAlert[]
  day_of_week_performance: DayPerformance[]
  top_campaign: { campaign_id: string; campaign_name: string; why: string } | null
  worst_campaign: { campaign_id: string; campaign_name: string; why: string } | null
  has_data: boolean
}

// ─── Internal row shape ───────────────────────────────────────────────────────

interface MetricsRow {
  campaign_id: string
  campaign_name: string | null
  date_start: string
  spend: number
  leads: number
  cpl: number | null
  ctr: number
  frequency: number
  impressions: number
  clicks: number
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ─── Main entry point ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildMetricsContext(
  supabase: SupabaseClient,
  orgId: string,
  days = 30,
): Promise<MetricsContext> {
  const periodEnd   = new Date()
  const periodStart = new Date(periodEnd)
  periodStart.setDate(periodStart.getDate() - days)

  const startStr = periodStart.toISOString().split('T')[0]
  const endStr   = periodEnd.toISOString().split('T')[0]

  const { data: rows, error } = await supabase
    .from('campaign_metrics')
    .select('campaign_id, campaign_name, date_start, spend, leads, cpl, ctr, frequency, impressions, clicks')
    .eq('org_id', orgId)
    .gte('date_start', startStr)
    .lte('date_start', endStr)
    .order('date_start', { ascending: true })

  if (error) throw new Error(`campaign_metrics query failed: ${error.message}`)
  const typedRows: MetricsRow[] = (rows ?? []) as MetricsRow[]

  if (typedRows.length < 3) {
    return emptyContext(startStr, endStr, days)
  }

  const byCampaign = groupBy(typedRows, r => r.campaign_id)

  const campaigns: CampaignSummary[] = Object.entries(byCampaign).map(([cid, crows]) => {
    const spend_30d       = sum(crows, r => r.spend)
    const leads_30d       = sum(crows, r => r.leads)
    const impressions_30d = sum(crows, r => r.impressions)
    const clicks_30d      = sum(crows, r => r.clicks)
    const cpl_avg         = spend_30d > 0 && leads_30d > 0 ? spend_30d / leads_30d : 0
    const ctr_avg         = impressions_30d > 0 ? (clicks_30d / impressions_30d) : 0
    return {
      campaign_id: cid,
      campaign_name: crows[0].campaign_name ?? cid,
      spend_30d, leads_30d, cpl_avg, ctr_avg, impressions_30d, clicks_30d,
    }
  })

  const total_spend       = sum(typedRows, r => r.spend)
  const total_leads       = sum(typedRows, r => r.leads)
  const impressions_total = sum(typedRows, r => r.impressions)
  const clicks_total      = sum(typedRows, r => r.clicks)
  const avg_cpl           = total_spend > 0 && total_leads > 0 ? total_spend / total_leads : 0
  const avg_ctr           = impressions_total > 0 ? (clicks_total / impressions_total) : 0

  const thisWeekStart = new Date(periodEnd)
  thisWeekStart.setDate(thisWeekStart.getDate() - 7)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)

  const thisWeekRows = typedRows.filter(r => r.date_start >= thisWeekStart.toISOString().split('T')[0])
  const lastWeekRows = typedRows.filter(r => {
    const d = r.date_start
    return d >= lastWeekStart.toISOString().split('T')[0] && d < thisWeekStart.toISOString().split('T')[0]
  })

  const thisWeekSpend  = sum(thisWeekRows, r => r.spend)
  const lastWeekSpend  = sum(lastWeekRows, r => r.spend)
  const thisWeekLeads  = sum(thisWeekRows, r => r.leads)
  const lastWeekLeads  = sum(lastWeekRows, r => r.leads)
  const thisWeekCpl    = thisWeekSpend > 0 && thisWeekLeads > 0 ? thisWeekSpend / thisWeekLeads : 0
  const lastWeekCpl    = lastWeekSpend > 0 && lastWeekLeads > 0 ? lastWeekSpend / lastWeekLeads : 0

  const wow_cpl_delta_pct   = lastWeekCpl > 0 ? ((thisWeekCpl - lastWeekCpl) / lastWeekCpl) * 100 : 0
  const wow_spend_delta_pct = lastWeekSpend > 0 ? ((thisWeekSpend - lastWeekSpend) / lastWeekSpend) * 100 : 0

  const byDow = groupBy(typedRows, r => new Date(r.date_start).getDay().toString())
  const day_of_week_performance: DayPerformance[] = Object.entries(byDow)
    .map(([dow, drows]) => {
      const dayNum = parseInt(dow, 10)
      const imp    = sum(drows, r => r.impressions)
      const clk    = sum(drows, r => r.clicks)
      return {
        day_of_week: dayNum,
        day_name:    DAY_NAMES[dayNum],
        avg_cpl:     avg(drows, r => r.cpl ?? 0),
        avg_ctr:     imp > 0 ? (clk / imp) : 0,
        avg_spend:   avg(drows, r => r.spend),
        data_points: drows.length,
      }
    })
    .sort((a, b) => a.day_of_week - b.day_of_week)

  const alerts: MetricAlert[] = []

  for (const [, crows] of Object.entries(byCampaign)) {
    const name   = crows[0].campaign_name ?? crows[0].campaign_id
    const cid    = crows[0].campaign_id
    const recent = crows.filter(r => r.date_start >= thisWeekStart.toISOString().split('T')[0])
    if (!recent.length) continue

    const cpl7d = avg(recent, r => r.cpl ?? 0)
    const cpl30d = avg(crows, r => r.cpl ?? 0)
    const cplThreshold = cpl30d * 1.5
    if (cpl30d > 0 && cpl7d > cplThreshold) {
      alerts.push({
        type: 'cpl_spike', severity: 'high', campaign_id: cid, campaign_name: name,
        message: `CPL spiked to ₹${Math.round(cpl7d)} (7d avg) vs ₹${Math.round(cpl30d)} (30d avg) — 1.5× threshold breached`,
        value: cpl7d, threshold: cplThreshold,
      })
    }

    const recentFreq = avg(recent, r => r.frequency)
    if (recentFreq > 2.5) {
      alerts.push({
        type: 'ad_fatigue', severity: 'medium', campaign_id: cid, campaign_name: name,
        message: `Ad fatigue: frequency ${recentFreq.toFixed(1)}× — audience has seen your ad too many times`,
        value: recentFreq, threshold: 2.5,
      })
    }

    const ctr7dImp = sum(recent, r => r.impressions)
    const ctr7dClk = sum(recent, r => r.clicks)
    const ctr7d    = ctr7dImp > 0 ? ctr7dClk / ctr7dImp : 0
    const ctrImp30 = sum(crows, r => r.impressions)
    const ctrClk30 = sum(crows, r => r.clicks)
    const ctr30d   = ctrImp30 > 0 ? ctrClk30 / ctrImp30 : 0
    const ctrThreshold = ctr30d * 0.7
    if (ctr30d > 0 && ctr7d < ctrThreshold) {
      alerts.push({
        type: 'ctr_drop', severity: 'medium', campaign_id: cid, campaign_name: name,
        message: `CTR dropped to ${(ctr7d * 100).toFixed(2)}% (7d) vs ${(ctr30d * 100).toFixed(2)}% (30d avg) — creative fatigue likely`,
        value: ctr7d, threshold: ctrThreshold,
      })
    }
  }

  const seen = new Set<string>()
  const deduped = alerts.filter(a => {
    const key = `${a.campaign_id}-${a.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const rankedByCpl = [...campaigns].filter(c => c.leads_30d > 0).sort((a, b) => a.cpl_avg - b.cpl_avg)
  const top          = rankedByCpl[0] ?? null
  const worst        = rankedByCpl[rankedByCpl.length - 1] ?? null
  const topRef       = top ? { campaign_id: top.campaign_id, campaign_name: top.campaign_name, why: `Lowest CPL at ₹${Math.round(top.cpl_avg)} with ${top.leads_30d} leads` } : null
  const worstRef     = worst && worst.campaign_id !== top?.campaign_id
    ? { campaign_id: worst.campaign_id, campaign_name: worst.campaign_name, why: `Highest CPL at ₹${Math.round(worst.cpl_avg)} with only ${worst.leads_30d} leads` } : null

  return {
    period: { start: startStr, end: endStr, days },
    campaigns,
    aggregates: {
      total_spend, total_leads, avg_cpl, avg_ctr,
      wow_cpl_delta_pct: round2(wow_cpl_delta_pct),
      wow_spend_delta_pct: round2(wow_spend_delta_pct),
      impressions_total, clicks_total,
    },
    alerts: deduped,
    day_of_week_performance,
    top_campaign: topRef,
    worst_campaign: worstRef,
    has_data: true,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyContext(start: string, end: string, days: number): MetricsContext {
  return {
    period: { start, end, days },
    campaigns: [],
    aggregates: { total_spend: 0, total_leads: 0, avg_cpl: 0, avg_ctr: 0, wow_cpl_delta_pct: 0, wow_spend_delta_pct: 0, impressions_total: 0, clicks_total: 0 },
    alerts: [], day_of_week_performance: [], top_campaign: null, worst_campaign: null, has_data: false,
  }
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item)
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {})
}

function sum<T>(arr: T[], fn: (item: T) => number): number {
  return arr.reduce((acc, item) => acc + fn(item), 0)
}

function avg<T>(arr: T[], fn: (item: T) => number): number {
  return arr.length ? sum(arr, fn) / arr.length : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

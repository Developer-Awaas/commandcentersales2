/**
 * DhruvInsightCards — dashboard alert cards, zero LLM cost.
 *
 * Calls buildMetricsContext() directly (client-side DB query, ~50ms).
 * No aarav-orchestrate call on load — Dhruv's LLM narration fires only
 * when the user clicks "Ask Dhruv" or types a question in the chat.
 *
 * Usage (in Dashboard.tsx):
 *   import DhruvInsightCards from '@/components/DhruvInsightCards'
 *   <DhruvInsightCards orgId={orgId} onAskDhruv={(msg) => sendToAarav(msg)} />
 */

import React, { useEffect, useState } from 'react'
import { AlertTriangle, TrendingUp, TrendingDown, Zap, RefreshCw } from 'lucide-react'
import { buildMetricsContext, type MetricsContext, type MetricAlert } from '../lib/metrics-query'
import { supabase } from '../lib/supabaseClient'

// ─── Card shape ───────────────────────────────────────────────────────────────

type CardSeverity = 'red' | 'amber' | 'green'

interface InsightCard {
  severity: CardSeverity
  title: string
  body: string
  askPrompt?: string    // pre-filled question for "Ask Dhruv" click
}

// ─── Pure mapping: MetricsContext → InsightCard[] ────────────────────────────
// No LLM — just thresholds and simple template strings.

function buildCards(ctx: MetricsContext): InsightCard[] {
  if (!ctx.has_data) {
    return [{
      severity: 'amber',
      title: 'No campaign data yet',
      body: 'Once your Meta campaigns run for a few days, Dhruv will surface insights here.',
    }]
  }

  const cards: InsightCard[] = []

  // High-severity alerts → red cards
  const highAlerts = ctx.alerts.filter((a: MetricAlert) => a.severity === 'high')
  for (const alert of highAlerts.slice(0, 2)) {
    cards.push({
      severity: 'red',
      title: alertTitle(alert),
      body: alert.message,
      askPrompt: `Dhruv, ${alert.campaign_name} has a ${alert.type.replace('_', ' ')} alert — what should I do?`,
    })
  }

  // Medium-severity alerts → amber cards
  const medAlerts = ctx.alerts.filter((a: MetricAlert) => a.severity === 'medium')
  for (const alert of medAlerts.slice(0, 2)) {
    cards.push({
      severity: 'amber',
      title: alertTitle(alert),
      body: alert.message,
      askPrompt: `Dhruv, explain the ${alert.type.replace('_', ' ')} for ${alert.campaign_name}`,
    })
  }

  // WoW improvement → green card
  if (ctx.aggregates.wow_cpl_delta_pct < -5) {
    const pct = Math.abs(Math.round(ctx.aggregates.wow_cpl_delta_pct))
    cards.push({
      severity: 'green',
      title: `CPL improved ${pct}% this week`,
      body: `Your avg cost per lead dropped from last week — the optimisations are paying off.`,
      askPrompt: `Dhruv, why did my CPL improve this week?`,
    })
  }

  // Top campaign → green card (only when no high alerts)
  if (ctx.top_campaign && highAlerts.length === 0) {
    cards.push({
      severity: 'green',
      title: `Best campaign: ${ctx.top_campaign.campaign_name}`,
      body: ctx.top_campaign.why,
      askPrompt: `Dhruv, what's making ${ctx.top_campaign.campaign_name} my top campaign?`,
    })
  }

  // Healthy overall — if still no cards at all
  if (cards.length === 0) {
    cards.push({
      severity: 'green',
      title: `${ctx.aggregates.total_leads} leads · ₹${Math.round(ctx.aggregates.avg_cpl)} avg CPL`,
      body: `No alerts — your campaigns are running within healthy thresholds.`,
      askPrompt: `Dhruv, give me a full analysis of my campaign performance.`,
    })
  }

  return cards.slice(0, 5)
}

function alertTitle(alert: MetricAlert): string {
  if (alert.type === 'cpl_spike')   return `CPL spike — ${alert.campaign_name}`
  if (alert.type === 'ad_fatigue')  return `Ad fatigue — ${alert.campaign_name}`
  if (alert.type === 'ctr_drop')    return `CTR drop — ${alert.campaign_name}`
  return alert.campaign_name
}

// ─── Severity colours (using project design tokens) ──────────────────────────

const SEVERITY_STYLES: Record<CardSeverity, { border: string; bg: string; icon: string; dot: string }> = {
  red:   { border: 'border-red-200',    bg: 'bg-red-50',    icon: 'text-red-500',    dot: 'bg-red-500' },
  amber: { border: 'border-amber-200',  bg: 'bg-amber-50',  icon: 'text-amber-500',  dot: 'bg-amber-500' },
  green: { border: 'border-green-200',  bg: 'bg-green-50',  icon: 'text-green-600',  dot: 'bg-green-500' },
}

function SeverityIcon({ severity }: { severity: CardSeverity }) {
  if (severity === 'red')   return <AlertTriangle className="h-4 w-4 text-red-500" />
  if (severity === 'amber') return <Zap className="h-4 w-4 text-amber-500" />
  return <TrendingUp className="h-4 w-4 text-green-600" />
}

// ─── Component ────────────────────────────────────────────────────────────────

interface DhruvInsightCardsProps {
  orgId: string
  onAskDhruv?: (message: string) => void
}

export default function DhruvInsightCards({ orgId, onAskDhruv }: DhruvInsightCardsProps) {
  const [cards, setCards]     = useState<InsightCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const ctx = await buildMetricsContext(supabase, orgId, 30)
      setCards(buildCards(ctx))
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (orgId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex-shrink-0 w-56 h-20 rounded-lg border border-border bg-surface animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <TrendingDown className="h-4 w-4" />
        <span>Metrics unavailable</span>
        <button onClick={load} className="text-xs underline hover:no-underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Campaign Signals</span>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={load}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {cards.map((card, i) => {
          const styles = SEVERITY_STYLES[card.severity]
          return (
            <div
              key={i}
              className={`flex-shrink-0 w-56 rounded-lg border p-3 ${styles.border} ${styles.bg} ${card.askPrompt && onAskDhruv ? 'cursor-pointer hover:shadow-sm transition-shadow' : ''}`}
              onClick={() => card.askPrompt && onAskDhruv?.(card.askPrompt)}
              title={card.askPrompt ? 'Click to ask Dhruv for analysis' : undefined}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex-shrink-0">
                  <SeverityIcon severity={card.severity} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground leading-tight truncate">{card.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">{card.body}</p>
                  {card.askPrompt && onAskDhruv && (
                    <p className="text-xs text-brand mt-1 font-medium">Ask Dhruv →</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

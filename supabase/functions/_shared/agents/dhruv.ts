/**
 * Dhruv — analyst specialist (metrics insights, trend narration, reports).
 *
 * INVARIANT: server-side only, invoked exclusively by aarav-orchestrate.
 * Never imported under src/, never a standalone routable Edge Function.
 *
 * Intent routing (caller sets RunDhruvInput.intent):
 *   'reactive'  → quick conversational insight (Sonnet, 2048 tokens)
 *   'report'    → full monthly narrative report (Sonnet, 4096 tokens)
 *   'dashboard' → 3-5 severity cards for dashboard header (Haiku, 512 tokens)
 *
 * Dhruv is read-only. He never modifies campaigns, budgets, or creatives.
 * When he identifies a needed change he sets delegate_suggestion to 'arjun'
 * or 'aanya' so Aarav can offer to loop in the right specialist.
 *
 * buildMetricsContext() (from _shared/metrics-query.ts) runs BEFORE this
 * module — Dhruv receives pre-computed MetricsContext, not raw DB rows.
 * This keeps the LLM call lean (structured JSON in, narrative JSON out)
 * and makes every cited number verifiable against the pre-computed context.
 */

import { loadAgentPrompt } from './prompts.ts'
import { parseJsonObject }  from './json-extract.ts'
import type { MetricsContext } from '../metrics-query.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

const DHRUV_REACTIVE_MODEL  = 'claude-sonnet-4-6'
const DHRUV_REPORT_MODEL    = 'claude-sonnet-4-6'
const DHRUV_DASHBOARD_MODEL = 'claude-haiku-4-5-20251001'

export type DhruvIntent = 'reactive' | 'report' | 'dashboard'

// ─── Output types ─────────────────────────────────────────────────────────────

export interface DhruvAlert {
  severity: 'high' | 'medium' | 'low'
  message: string
}

export interface DhruvReactiveOutput {
  summary: string
  details: string
  alerts: DhruvAlert[]
  recommendations: string[]
  delegate_suggestion: 'arjun' | 'aanya' | null
}

export interface DhruvReportSection {
  heading: string
  body: string
}

export interface DhruvReportOutput {
  title: string
  executive_summary: string
  sections: DhruvReportSection[]
}

export interface DhruvDashboardCard {
  severity: 'red' | 'amber' | 'green'
  title: string
  body: string
}

export interface DhruvDashboardOutput {
  cards: DhruvDashboardCard[]
}

export type DhruvOutput = DhruvReactiveOutput | DhruvReportOutput | DhruvDashboardOutput

// ─── I/O contracts ────────────────────────────────────────────────────────────

export interface RunDhruvInput {
  orgId: string
  projectId?: string
  intent: DhruvIntent
  message: string
  metricsContext: MetricsContext
  // Optional enrichment: project name, month label for reports, etc.
  context?: Record<string, unknown>
}

export interface RunDhruvResult {
  intent: DhruvIntent
  output: DhruvOutput
  model: string
  inputTokens: number
  outputTokens: number
}

// Carries usage so cost rows can be written even when LLM output is unparseable.
export class DhruvOutputError extends Error {
  usage?: { inputTokens: number; outputTokens: number }
  constructor(message: string, usage?: { inputTokens: number; outputTokens: number }) {
    super(message)
    this.name = 'DhruvOutputError'
    this.usage = usage
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runDhruv(input: RunDhruvInput): Promise<RunDhruvResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret is not set')

  const { text: systemPrompt, version } = loadAgentPrompt('dhruv')

  const model     = modelForIntent(input.intent)
  const maxTokens = maxTokensForIntent(input.intent)

  const userPrompt = [
    `Intent: ${input.intent}`,
    `Request: ${input.message}`,
    `metrics_context: ${JSON.stringify(input.metricsContext)}`,
    input.context ? `Additional context: ${JSON.stringify(input.context)}` : null,
  ].filter(Boolean).join('\n\n')

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: `${systemPrompt}\n\n[prompt_version: dhruv ${version}]`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`Dhruv LLM call failed (${res.status}): ${errText}`)
  }

  const data = await res.json()
  const inputTokens: number  = data?.usage?.input_tokens  ?? 0
  const outputTokens: number = data?.usage?.output_tokens ?? 0
  const rawText: string = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')

  let output: DhruvOutput
  try {
    output = parseJsonObject<DhruvOutput>(rawText)
  } catch (err) {
    throw new DhruvOutputError(
      err instanceof Error ? err.message : 'Dhruv returned unparseable output',
      { inputTokens, outputTokens },
    )
  }

  return { intent: input.intent, output, model, inputTokens, outputTokens }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function modelForIntent(intent: DhruvIntent): string {
  if (intent === 'dashboard') return DHRUV_DASHBOARD_MODEL
  if (intent === 'report')    return DHRUV_REPORT_MODEL
  return DHRUV_REACTIVE_MODEL
}

function maxTokensForIntent(intent: DhruvIntent): number {
  if (intent === 'dashboard') return 512
  if (intent === 'report')    return 4096
  return 2048
}

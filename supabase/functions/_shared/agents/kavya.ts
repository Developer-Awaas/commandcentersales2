/**
 * Kavya — content strategist specialist (SMM calendar plans, captions,
 * reel scripts). Produces structured JSON for social media content.
 *
 * INVARIANT: this module is SERVER-SIDE ONLY, invoked exclusively by
 * aarav-orchestrate (supabase/functions/aarav-orchestrate/index.ts):
 *   - never imported anywhere under src/
 *   - never exposed as its own routable Edge Function
 *
 * Intent routing (caller sets RunKavyaInput.intent):
 *   'plan'    → 30-entry SMM calendar (uses Sonnet — strategic arc + festival
 *               awareness requires reasoning; Haiku would produce shallow plans)
 *   'caption' → single platform-optimised caption + hashtags (Haiku — volume
 *               work; a 200-char caption doesn't need Sonnet's depth)
 *   'reel'    → 3-section reel script (Haiku — same volume rationale)
 *
 * DB writes (plan only): the caller (aarav-orchestrate) is responsible for
 * inserting KavyaPlanEntry[] into smm_calendar using its service-role client.
 * This module stays stateless — no Supabase client, no storage calls.
 */

import { loadAgentPrompt } from './prompts.ts'
import { parseJsonObject } from './json-extract.ts'
import { assertWithinTextBudget } from './text-budget.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

// Sonnet for plans (30-day arc reasoning), Haiku for captions/reels (volume).
const KAVYA_PLAN_MODEL    = 'claude-sonnet-4-6'
const KAVYA_CAPTION_MODEL = 'claude-haiku-4-5-20251001'

export type KavyaIntent = 'plan' | 'caption' | 'reel'

// ─── Output shape types ───────────────────────────────────────────────────────

export interface KavyaPlanEntry {
  day: number
  date: string
  platform: 'instagram' | 'facebook' | 'both'
  post_type: 'reel' | 'carousel' | 'static' | 'story' | 'video'
  category: string
  caption: string
  hashtags: string[]
  creative_brief: string
  posting_time: string
  week_theme: string
}

export interface KavyaPlan {
  plan: KavyaPlanEntry[]
  strategy_note: string
}

export interface KavyaCaption {
  caption: string
  hashtags: string[]
  platform: string
  char_count: number
}

export interface KavyaReelScript {
  hook: string
  body: string
  cta: string
  music_mood: string
  shot_list: string[]
}

// ─── I/O contracts ────────────────────────────────────────────────────────────

export interface RunKavyaInput {
  orgId: string
  projectId?: string
  intent: KavyaIntent
  message: string
  // Optional enrichment: project name/city/USPs, brand tone, festival month, etc.
  context?: Record<string, unknown>
  // CC-P4 Step 5 — anti-runaway ceiling for this turn (USD). When set, the call
  // is aborted before spending if its worst-case estimated cost exceeds it.
  costCeilingUsd?: number
}

export interface RunKavyaResult {
  intent: KavyaIntent
  output: KavyaPlan | KavyaCaption | KavyaReelScript
  model: string
  inputTokens: number
  outputTokens: number
}

// Carries token usage so the caller can bill for the attempt even when the
// LLM responded but its output couldn't be parsed as expected JSON.
export class KavyaOutputError extends Error {
  usage?: { inputTokens: number; outputTokens: number }
  constructor(message: string, usage?: { inputTokens: number; outputTokens: number }) {
    super(message)
    this.name = 'KavyaOutputError'
    this.usage = usage
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runKavya(input: RunKavyaInput): Promise<RunKavyaResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret is not set')

  const { text: systemPrompt, version } = loadAgentPrompt('kavya')
  const model     = input.intent === 'plan' ? KAVYA_PLAN_MODEL : KAVYA_CAPTION_MODEL
  // 'plan' generates a 30-entry structured JSON calendar — 4096 truncated it
  // mid-object every time (confirmed live: output_tokens always hit the cap,
  // then parseJsonObject threw on the unterminated JSON, after the call was
  // already billed). 16000 gives real headroom.
  const maxTokens = input.intent === 'plan' ? 16000 : 1024

  const userPrompt = [
    `Intent: ${input.intent}`,
    `Request: ${input.message}`,
    input.context ? `Context: ${JSON.stringify(input.context)}` : null,
  ].filter(Boolean).join('\n')

  // Anti-runaway guard (CC-P4 Step 5): abort before spending if the worst-case
  // cost of this call would exceed the tier ceiling.
  assertWithinTextBudget(input.costCeilingUsd, systemPrompt.length + userPrompt.length, maxTokens)

  // Hotfix: the 'plan' intent's 16000-token cap (raised from 4096 to stop
  // truncation-crashes) can genuinely take 150s+ to generate a full 30-entry
  // calendar (confirmed live: 8705 output tokens, stop_reason 'end_turn',
  // took 151s). With no timeout on this fetch, a slow call hung until
  // Supabase's own platform-level kill — by then runKavya() never returns,
  // the catch block in aarav-orchestrate never fires, and the turn is stuck
  // at status='working' forever (worse than the original truncation bug:
  // that at least failed fast and cleanly). AbortSignal.timeout matches the
  // same fix already applied to claude-proxy for the identical failure
  // class (bug #35) — converts a silent hang into a clean, retriable error.
  let res: Response
  try {
    res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: `${systemPrompt}\n\n[prompt_version: kavya ${version}]`,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    const isTimeout = err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new KavyaOutputError(
      isTimeout
        ? `${input.intent} generation timed out — please retry`
        : (err instanceof Error ? err.message : 'Kavya request failed'),
    )
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`Kavya LLM call failed (${res.status}): ${errText}`)
  }

  const data = await res.json()
  const inputTokens: number  = data?.usage?.input_tokens  ?? 0
  const outputTokens: number = data?.usage?.output_tokens ?? 0
  const rawText: string = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')

  // Catch truncation BEFORE attempting to parse — a max_tokens cutoff always
  // produces unterminated JSON, so parseJsonObject would throw anyway, but
  // this gives a clear, specific, retriable error instead of a generic
  // "unterminated JSON object" parse failure.
  if (data?.stop_reason === 'max_tokens') {
    throw new KavyaOutputError(
      'plan too large, regenerating',
      { inputTokens, outputTokens },
    )
  }

  let output: KavyaPlan | KavyaCaption | KavyaReelScript
  try {
    output = parseJsonObject<KavyaPlan | KavyaCaption | KavyaReelScript>(rawText)
  } catch (err) {
    throw new KavyaOutputError(
      err instanceof Error ? err.message : 'Kavya returned unparseable output',
      { inputTokens, outputTokens },
    )
  }

  return { intent: input.intent, output, model, inputTokens, outputTokens }
}

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
  const maxTokens = input.intent === 'plan' ? 4096 : 1024

  const userPrompt = [
    `Intent: ${input.intent}`,
    `Request: ${input.message}`,
    input.context ? `Context: ${JSON.stringify(input.context)}` : null,
  ].filter(Boolean).join('\n')

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
      system: `${systemPrompt}\n\n[prompt_version: kavya ${version}]`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

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

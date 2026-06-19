/**
 * Arjun — performance marketing specialist (budget split, targeting,
 * placements, expected CPL). Produces strategy JSON only, never
 * user-facing prose.
 *
 * INVARIANT: this module is SERVER-SIDE ONLY. It is invoked exclusively by
 * aarav-orchestrate (supabase/functions/aarav-orchestrate/index.ts) and
 * must never be:
 *   - imported anywhere under src/ (the client only ever talks to
 *     aarav-orchestrate, never to a specialist directly)
 *   - exposed as its own routable Edge Function (there is no
 *     supabase/functions/arjun/ directory — keep it that way)
 *
 * org_id flows in via RunArjunInput.orgId, which the caller (aarav-orchestrate)
 * must always populate with the value it resolved server-side from the
 * caller's JWT — never trust an org_id from client request input.
 */

import { loadAgentPrompt } from './prompts.ts'
import { parseJsonObject } from './json-extract.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

// Model assignment: no agent-to-model mapping was found in this repo's
// build spec (CLAUDE.md / docs/) at the time this was written. Defaulting
// to Claude Sonnet 4.6 per the fallback instruction — revisit if a spec
// later assigns Arjun a different model.
const ARJUN_MODEL = 'claude-sonnet-4-6'

export interface BudgetAllocation {
  awareness: number
  consideration: number
  conversion: number
}

export interface TargetingConfig {
  age_range: string
  locations: string[]
  interests: string[]
}

export interface ExpectedCplRange {
  min: number
  max: number
  currency: 'INR'
}

export interface StrategyConfig {
  platform: 'Meta Ads Manager' | 'AiSensy'
  primary_funnel_stage: 'awareness' | 'consideration' | 'conversion'
  budget_allocation: BudgetAllocation
  targeting: TargetingConfig
  placements: string[]
  expected_cpl_range: ExpectedCplRange
  notes: string
}

export interface RunArjunInput {
  orgId: string
  projectId?: string
  objective: string
  budget: string
  projectContext?: Record<string, unknown>
}

export interface RunArjunResult {
  strategy: StrategyConfig
  model: string
  inputTokens: number
  outputTokens: number
}

// Thrown when the LLM responded but its output couldn't be parsed as the
// expected JSON shape. Carries token usage (if the call itself succeeded)
// so the caller can still bill for the attempt accurately, distinct from a
// network/API failure where no usage exists at all.
export class ArjunOutputError extends Error {
  usage?: { inputTokens: number; outputTokens: number }
  constructor(message: string, usage?: { inputTokens: number; outputTokens: number }) {
    super(message)
    this.name = 'ArjunOutputError'
    this.usage = usage
  }
}

export async function runArjun(input: RunArjunInput): Promise<RunArjunResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret is not set')

  const { text: systemPrompt, version } = loadAgentPrompt('arjun')

  const userPrompt = [
    `Objective: ${input.objective}`,
    `Budget: ${input.budget}`,
    input.projectContext ? `Project context: ${JSON.stringify(input.projectContext)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ARJUN_MODEL,
      max_tokens: 1024,
      system: `${systemPrompt}\n\n[prompt_version: arjun ${version}]`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`Arjun LLM call failed (${res.status}): ${errText}`)
  }

  const data = await res.json()
  const inputTokens: number = data?.usage?.input_tokens ?? 0
  const outputTokens: number = data?.usage?.output_tokens ?? 0
  const rawText: string = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')

  let strategy: StrategyConfig
  try {
    strategy = parseStrategyJson(rawText)
  } catch (err) {
    throw new ArjunOutputError(
      err instanceof Error ? err.message : 'Arjun returned unparseable output',
      { inputTokens, outputTokens }
    )
  }

  return { strategy, model: ARJUN_MODEL, inputTokens, outputTokens }
}

function parseStrategyJson(raw: string): StrategyConfig {
  return parseJsonObject<StrategyConfig>(raw)
}

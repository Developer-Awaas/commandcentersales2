/**
 * recordApiCost (edge) — the server-side half of the single cost ledger. Writes
 * ONE agent_interactions row per external API call made server-side (image
 * gen/edit in generate-image, cron LLM calls, meta-insights-sync's Haiku
 * promotion vision). Mirror of src/lib/api-cost.ts.
 *
 * Fire-SAFE: never throws (a logging failure must not fail the user's real
 * call) — but it IS async and returns after the write, so tests can await it
 * and assert the terminal row landed (bug #47 class: a wrong column silently
 * no-ops, so the row must be asserted, not the invocation).
 *
 * The existing Aarav specialist inserts (aarav-orchestrate/index.ts) are left
 * as-is — those rows attribute via `agent`; these non-agent rows attribute via
 * `feature` + `provider`. A caller that already owns a service-role client
 * passes it as `client` to avoid a second connection.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from './database.types.ts'
import { textCostUsd } from './pricing.ts'

export type CostProvider = 'anthropic' | 'openai' | 'gemini'
export type CostCallType = 'text' | 'image_gen' | 'image_edit' | 'vision'

let _client: SupabaseClient<Database> | null = null
function getAdminClient(): SupabaseClient<Database> {
  if (_client) return _client
  _client = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  return _client
}

export interface EdgeApiCostInput {
  orgId: string
  userId?: string | null
  provider: CostProvider
  callType: CostCallType
  feature: string
  model: string
  inputTokens?: number
  outputTokens?: number
  imageCount?: number
  unitCostUsd?: number | null
  /** Precomputed cost — skips pricing.ts derivation when provided. */
  costUsd?: number | null
  projectId?: string | null
  traceId?: string | null
  client?: SupabaseClient<Database>
}

export async function recordApiCost(input: EdgeApiCostInput): Promise<void> {
  if (!input.orgId) return // no org context — cannot attribute (org_id is NOT NULL)

  const inputTokens = input.inputTokens ?? 0
  const outputTokens = input.outputTokens ?? 0
  const cost =
    input.costUsd !== undefined
      ? input.costUsd
      : input.callType === 'text' || input.callType === 'vision'
        ? textCostUsd(input.model, inputTokens, outputTokens)
        : (input.unitCostUsd ?? 0) * (input.imageCount ?? 1)

  try {
    const db = input.client ?? getAdminClient()
    const { error } = await db.from('agent_interactions').insert({
      org_id: input.orgId,
      user_id: input.userId ?? null,
      agent: null,
      provider: input.provider,
      call_type: input.callType,
      feature: input.feature,
      model: input.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      image_count: input.imageCount ?? null,
      unit_cost_usd: input.unitCostUsd ?? null,
      cost_usd: cost,
      project_id: input.projectId ?? null,
      trace_id: input.traceId ?? null,
    })
    if (error) console.error('recordApiCost: ledger insert failed:', error.message)
  } catch (err) {
    // Fire-safe: swallow so a logging failure never fails the real call.
    console.error('recordApiCost: unexpected error:', err instanceof Error ? err.message : String(err))
  }
}

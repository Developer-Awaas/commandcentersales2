/**
 * review-build only: server-enforced budget caps that must survive Edge
 * Function cold starts — unlike aanya.ts's BudgetTracker (in-memory,
 * per-invocation cost ceiling) or tier-config.ts's static per-tier
 * ceilings, neither of which persists across calls or days.
 *
 * Two independent caps:
 *   - Image generation: a single global counter (review_generation_budget,
 *     migration 20260721180000), hard stop at 300 images across the whole
 *     deployment. Enforced via an atomic Postgres UPDATE...RETURNING (see
 *     the migration) so concurrent callers can't both slip past the limit.
 *   - Arjun/Kavya turns per day: no new table needed — agent_interactions
 *     already has indexed org_id and created_at columns, so a plain COUNT
 *     answers "how many turns has this org used today" directly.
 *
 * Both throw a specific, catchable error type so callers can render a
 * clean "review budget reached" message instead of a 500 or an unhandled
 * generic Error.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from './database.types.ts'

export class ImageBudgetExceededError extends Error {
  constructor(public readonly imageCount: number, public readonly imageLimit: number) {
    super('review budget reached')
    this.name = 'ImageBudgetExceededError'
  }
}

export class TurnBudgetExceededError extends Error {
  constructor(public readonly turnsUsed: number, public readonly turnsPerDay: number) {
    super('review budget reached')
    this.name = 'TurnBudgetExceededError'
  }
}

// Lazily-constructed service-role client — kept separate from callers'
// own admin clients so this module works whether called from a
// standalone Edge Function (generate-image) or a specialist that already
// owns an adminClient (aanya.ts can pass its own via reserveImageBudget's
// optional `client` param instead of spinning up a second connection).
let _client: SupabaseClient<Database> | null = null
function getAdminClient(): SupabaseClient<Database> {
  if (_client) return _client
  _client = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  return _client
}

/**
 * Atomically increments the global image counter and throws
 * ImageBudgetExceededError if the deployment-wide cap (default 300) has
 * been reached. Must be called BEFORE the paid provider call, never after
 * — this is the whole point (never bill-then-reject).
 */
export async function reserveImageBudget(
  estimatedCostUsd: number,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const admin = client ?? getAdminClient()
  const { data, error } = await admin.rpc('increment_review_image_budget', {
    p_cost_usd: estimatedCostUsd,
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as
    | { new_count: number; was_allowed: boolean }
    | undefined
  if (!row || !row.was_allowed) {
    throw new ImageBudgetExceededError(row?.new_count ?? -1, 300)
  }
}

const DEFAULT_TURNS_PER_DAY = 50

/**
 * Counts today's Arjun+Kavya agent_interactions rows for an org and
 * throws TurnBudgetExceededError if at/over the daily cap. Call before
 * starting a new turn's specialist chain, not after.
 */
export async function assertTurnsPerDayNotExceeded(
  client: SupabaseClient<Database>,
  orgId: string,
  turnsPerDay: number = DEFAULT_TURNS_PER_DAY,
): Promise<void> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const { count, error } = await client
    .from('agent_interactions')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('agent', ['arjun', 'kavya'])
    .gte('created_at', todayStart.toISOString())

  if (error) throw error
  if ((count ?? 0) >= turnsPerDay) {
    throw new TurnBudgetExceededError(count ?? 0, turnsPerDay)
  }
}

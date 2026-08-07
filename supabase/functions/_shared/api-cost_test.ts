// Credential-free: passes a stub client so recordApiCost never touches the
// network. Asserts the TERMINAL row that lands (bug #47 rule: assert the row,
// not the invocation) + fire-safety (a failing insert never throws).
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { recordApiCost } from './api-cost.ts'
// deno-lint-ignore no-explicit-any
type AnyClient = any

function stubClient(sink: { row?: Record<string, unknown>; table?: string }, error: unknown = null): AnyClient {
  return {
    from(table: string) {
      sink.table = table
      return {
        insert(row: Record<string, unknown>) {
          sink.row = row
          return Promise.resolve({ error })
        },
      }
    },
  }
}

Deno.test('recordApiCost (edge): text row shape, agent=null, feature-attributed', async () => {
  const sink: { row?: Record<string, unknown>; table?: string } = {}
  await recordApiCost({
    orgId: 'org-1', userId: 'user-1', client: stubClient(sink),
    provider: 'anthropic', callType: 'vision', feature: 'arjun_promote_vision',
    model: 'claude-haiku-4-5-20251001', inputTokens: 1000, outputTokens: 500, projectId: 'p1',
  })
  assertEquals(sink.table, 'agent_interactions')
  const r = sink.row!
  assertEquals(r.org_id, 'org-1')
  assertEquals(r.agent, null)
  assertEquals(r.provider, 'anthropic')
  assertEquals(r.call_type, 'vision')
  assertEquals(r.feature, 'arjun_promote_vision')
  assertEquals(r.cost_usd, 0.0035) // haiku (1000*1 + 500*5)/1e6
  assertEquals(r.project_id, 'p1')
})

Deno.test('recordApiCost (edge): image row cost = unitCost * imageCount', async () => {
  const sink: { row?: Record<string, unknown> } = {}
  await recordApiCost({
    orgId: 'org-1', client: stubClient(sink) as AnyClient,
    provider: 'openai', callType: 'image_gen', feature: 'creatives',
    model: 'gpt-image-1', imageCount: 2, unitCostUsd: 0.042,
  })
  assertEquals(sink.row!.cost_usd, 0.084)
  assertEquals(sink.row!.image_count, 2)
})

Deno.test('recordApiCost (edge): no org -> no write', async () => {
  const sink: { row?: Record<string, unknown> } = {}
  await recordApiCost({
    orgId: '', client: stubClient(sink) as AnyClient,
    provider: 'anthropic', callType: 'text', feature: 'x', model: 'claude-sonnet-4-6',
  })
  assertEquals(sink.row, undefined)
})

Deno.test('recordApiCost (edge): fire-safe — a failing insert does not throw', async () => {
  const sink: { row?: Record<string, unknown> } = {}
  await recordApiCost({
    orgId: 'org-1', client: stubClient(sink, { message: 'boom' }) as AnyClient,
    provider: 'anthropic', callType: 'text', feature: 'x', model: 'claude-sonnet-4-6',
    inputTokens: 1, outputTokens: 1,
  })
  // Reaching here without a throw is the assertion; the row was still attempted.
  assertEquals(sink.row!.feature, 'x')
})

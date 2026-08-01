import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { estimateTextCostUsd, assertWithinTextBudget, TextBudgetCapError } from './text-budget.ts'

Deno.test('estimateTextCostUsd: input from chars/4 + output at max_tokens, $3/$15 per M', () => {
  // 4000 chars -> 1000 input tokens; 1000 max output tokens.
  // (1000*3 + 1000*15) / 1e6 = 0.018
  assertEquals(estimateTextCostUsd(4000, 1000), 0.018)
})

Deno.test('assertWithinTextBudget: no-op when ceiling undefined (legacy callers)', () => {
  // A huge call — must NOT throw when there is no ceiling.
  assertWithinTextBudget(undefined, 100_000, 16000)
})

Deno.test('assertWithinTextBudget: passes when estimate is under the ceiling', () => {
  // A Kavya caption-sized call (~1024 out) under a $0.50 ceiling.
  assertWithinTextBudget(0.5, 2000, 1024)
})

Deno.test('assertWithinTextBudget: aborts when the worst-case estimate exceeds the ceiling', () => {
  // Kavya plan (16000 out) ~= $0.24+ — well over a tiny $0.05 ceiling.
  assertThrows(() => assertWithinTextBudget(0.05, 2000, 16000), TextBudgetCapError)
})

Deno.test('assertWithinTextBudget: the generous default tier ceilings clear a Kavya plan call', () => {
  // profile_1 textAgentCostCeilingUsd = 0.50 must NOT block a real plan call.
  assertWithinTextBudget(0.5, 4000, 16000)
})

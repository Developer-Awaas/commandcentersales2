// Edge mirror of src/lib/pricing.test.ts — credential-free, runs under `deno test`.
// Keeps the edge pricing numbers pinned to the same known values as the client
// side so the two mirrors can't silently drift.
import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  textCostUsd, imageUnitCostUsd, MODEL_PRICING,
  OPENAI_IMAGE_COST_USD, GEMINI_IMAGE_COST_USD,
} from './pricing.ts'

Deno.test('textCostUsd: sonnet $3/$15, haiku $1/$5', () => {
  assertEquals(textCostUsd('claude-sonnet-4-6', 1000, 500), 0.0105)
  assertEquals(textCostUsd('claude-haiku-4-5-20251001', 1000, 500), 0.0035)
})

Deno.test('textCostUsd: unknown model -> null (row still logs)', () => {
  assertEquals(textCostUsd('mystery-model', 1000, 500), null)
})

Deno.test('imageUnitCostUsd: openai per-quality + gemini flat + unknown null', () => {
  assertEquals(imageUnitCostUsd('openai', 'high'), 0.167)
  assertEquals(imageUnitCostUsd('gemini', 'medium'), GEMINI_IMAGE_COST_USD)
  assertEquals(imageUnitCostUsd('midjourney', 'high'), null)
})

Deno.test('known values match the client mirror', () => {
  assertEquals(MODEL_PRICING['claude-sonnet-4-6'], { inPerM: 3, outPerM: 15 })
  assertEquals(MODEL_PRICING['claude-haiku-4-5-20251001'], { inPerM: 1, outPerM: 5 })
  assertEquals(OPENAI_IMAGE_COST_USD, { low: 0.011, medium: 0.042, high: 0.167 })
  assert(GEMINI_IMAGE_COST_USD === 0.039)
})

// RB-P6 — authoritative image-cost + model-resolution unit tests (credential-free,
// pure functions; no network). This is the source of truth the ledger uses.
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  resolveImageModel, openaiImageUnitCost, supportsInputFidelity,
  OPENAI_IMAGE_COST_USD, OPENAI_IMAGE_15_COST_USD, OPENAI_IMAGE_2_COST_USD,
  INPUT_FIDELITY_HIGH_SURCHARGE_USD, IMAGE_INPUT_REF_COST_USD,
} from './image-provider.ts'

Deno.test('resolveImageModel: request override > IMAGE_MODEL env > default (gpt-image-2)', () => {
  const prev = Deno.env.get('IMAGE_MODEL')
  Deno.env.delete('IMAGE_MODEL')
  assertEquals(resolveImageModel(), 'gpt-image-2')                 // RB-P7 default
  assertEquals(resolveImageModel('gpt-image-1'), 'gpt-image-1')    // request override (rollback)
  Deno.env.set('IMAGE_MODEL', 'gpt-image-1')
  assertEquals(resolveImageModel(), 'gpt-image-1')                 // env flag (instant rollback)
  assertEquals(resolveImageModel('gpt-image-2'), 'gpt-image-2')    // override still wins
  if (prev === undefined) Deno.env.delete('IMAGE_MODEL'); else Deno.env.set('IMAGE_MODEL', prev)
})

Deno.test('supportsInputFidelity: gpt-image-2 rejects it (omit); 1 / 1.5 take it', () => {
  assertEquals(supportsInputFidelity('gpt-image-2'), false)
  assertEquals(supportsInputFidelity('gpt-image-1'), true)
  assertEquals(supportsInputFidelity('gpt-image-1.5'), true)
})

Deno.test('openaiImageUnitCost: model-aware base + conditional fidelity surcharge', () => {
  assertEquals(openaiImageUnitCost('gpt-image-1', 'high'), OPENAI_IMAGE_COST_USD.high)
  assertEquals(openaiImageUnitCost('gpt-image-1.5', 'medium'), OPENAI_IMAGE_15_COST_USD.medium)
  assertEquals(openaiImageUnitCost('gpt-image-2', 'high'), OPENAI_IMAGE_2_COST_USD.high)      // 0.165 portrait
  assertEquals(openaiImageUnitCost('gpt-image-2', 'medium'), OPENAI_IMAGE_2_COST_USD.medium)  // 0.041 portrait
  // gpt-image-1 edit → surcharge applies
  assertEquals(
    openaiImageUnitCost('gpt-image-1', 'high', { inputFidelityHigh: true }),
    OPENAI_IMAGE_COST_USD.high + INPUT_FIDELITY_HIGH_SURCHARGE_USD,
  )
  // gpt-image-2 edit → NO surcharge even if requested (it rejects input_fidelity)
  assertEquals(openaiImageUnitCost('gpt-image-2', 'high', { inputFidelityHigh: true }), OPENAI_IMAGE_2_COST_USD.high)
})

Deno.test('openaiImageUnitCost: per-input-ref cost scales multi-view edits (RB-P9)', () => {
  // 1 input ref (single-view edit) vs 3 (multi-view) — cost scales with ref count.
  assertEquals(openaiImageUnitCost('gpt-image-2', 'medium', { inputRefs: 1 }), OPENAI_IMAGE_2_COST_USD.medium + IMAGE_INPUT_REF_COST_USD)
  assertEquals(openaiImageUnitCost('gpt-image-2', 'medium', { inputRefs: 3 }), OPENAI_IMAGE_2_COST_USD.medium + 3 * IMAGE_INPUT_REF_COST_USD)
  // gen (no refs) is unchanged
  assertEquals(openaiImageUnitCost('gpt-image-2', 'medium'), OPENAI_IMAGE_2_COST_USD.medium)
})

// RB-P6 — authoritative image-cost + model-resolution unit tests (credential-free,
// pure functions; no network). This is the source of truth the ledger uses.
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  resolveImageModel, openaiImageUnitCost,
  OPENAI_IMAGE_COST_USD, OPENAI_IMAGE_15_COST_USD, INPUT_FIDELITY_HIGH_SURCHARGE_USD,
} from './image-provider.ts'

Deno.test('resolveImageModel: request override > IMAGE_MODEL env > default', () => {
  const prev = Deno.env.get('IMAGE_MODEL')
  Deno.env.delete('IMAGE_MODEL')
  assertEquals(resolveImageModel(), 'gpt-image-1')                 // default
  assertEquals(resolveImageModel('gpt-image-1.5'), 'gpt-image-1.5') // request override
  Deno.env.set('IMAGE_MODEL', 'gpt-image-1.5')
  assertEquals(resolveImageModel(), 'gpt-image-1.5')               // env flag
  assertEquals(resolveImageModel('gpt-image-1'), 'gpt-image-1')    // override still wins
  if (prev === undefined) Deno.env.delete('IMAGE_MODEL'); else Deno.env.set('IMAGE_MODEL', prev)
})

Deno.test('openaiImageUnitCost: model-aware base + input_fidelity edit surcharge', () => {
  // gpt-image-1 gen (no surcharge)
  assertEquals(openaiImageUnitCost('gpt-image-1', 'high'), OPENAI_IMAGE_COST_USD.high)
  // gpt-image-1.5 gen
  assertEquals(openaiImageUnitCost('gpt-image-1.5', 'medium'), OPENAI_IMAGE_15_COST_USD.medium)
  // edit (input_fidelity high) adds the surcharge
  assertEquals(
    openaiImageUnitCost('gpt-image-1', 'high', { inputFidelityHigh: true }),
    OPENAI_IMAGE_COST_USD.high + INPUT_FIDELITY_HIGH_SURCHARGE_USD,
  )
})

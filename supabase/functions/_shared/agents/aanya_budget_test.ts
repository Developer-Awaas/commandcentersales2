/**
 * Unit tests for Aanya's per-interaction budget cap.
 *
 * These tests import _runAnglePipeline and BudgetCapError directly from
 * aanya.ts and inject mock generateFn / critiqueFn — no API keys or network
 * calls needed. They prove:
 *
 *   1. When the generateFn throws BudgetCapError after iteration 1 (simulating
 *      the sync-reserve check failing), the pipeline returns iteration-1's
 *      image as best-of-current WITHOUT throwing. The turn completes gracefully.
 *
 *   2. When BudgetCapError is thrown before ANY image is produced (no prior
 *      image for this angle), the error propagates so Promise.allSettled marks
 *      the angle as rejected — the orchestrator still has other angles' results.
 *
 * Run:
 *   deno test supabase/functions/_shared/agents/aanya_budget_test.ts --allow-env
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { _runAnglePipeline, BudgetCapError, type _AnglePipelineDeps } from './aanya.ts'

const STUB_IDEA = {
  angle: 'value' as const,
  headline: 'Test headline',
  primary_text: 'Test body',
  cta: 'Book Now',
  image_prompt: 'A luxury apartment at golden hour.',
  rationale: 'Price-led urgency.',
}

const FAKE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Critique that always rejects (score 40, pass:false) so the loop would
// normally keep retrying — budget cap must stop it instead.
const alwaysRejectCritique: _AnglePipelineDeps['critiqueFn'] = async () => ({
  score: 40, pass: false, feedback: 'needs more contrast',
})

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test(
  'budget cap: stops BEFORE the breaching gen and returns best-of-current without error',
  async () => {
    let totalCalls = 0
    let successfulGens = 0

    // First call succeeds; second throws BudgetCapError (simulates reserve() returning false).
    const cappedAfterFirst: _AnglePipelineDeps['generateFn'] = async (_prompt) => {
      totalCalls++
      if (totalCalls > 1) throw new BudgetCapError()
      successfulGens++
      return { imageBase64: FAKE_BASE64, mimeType: 'image/png', costUsd: 0.167 }
    }

    // alwaysRejectCritique means the loop wants to retry on iteration 2 —
    // budget cap must prevent that second gen from happening.
    const result = await _runAnglePipeline(STUB_IDEA, 'value', {
      generateFn: cappedAfterFirst,
      critiqueFn: alwaysRejectCritique,
    })

    // Only one image was actually produced.
    assertEquals(successfulGens, 1, 'exactly one successful gen before cap')
    // generateFn was called twice: first succeeded, second threw BudgetCapError.
    assertEquals(totalCalls, 2, 'generateFn attempted twice; second raised BudgetCapError')
    // Pipeline returns the iteration-1 image, not an error.
    assertEquals(result.bestImageBase64, FAKE_BASE64, 'returns iter-1 image as best-of-current')
    // iterationsUsed reflects completed iterations (one gen+critique cycle).
    assertEquals(result.iterationsUsed, 1, 'one completed iteration counted')
    // budgetCapped flag is set so runAanya can propagate capHit to the orchestrator.
    assertEquals(result.budgetCapped, true, 'budgetCapped flag must be true')
  },
)

Deno.test(
  'budget cap: propagates BudgetCapError when NO prior image exists (angle fails, not the whole turn)',
  async () => {
    // Cap is hit on the very first gen attempt — no best-so-far to return.
    const capImmediately: _AnglePipelineDeps['generateFn'] = async (_prompt) => {
      throw new BudgetCapError()
    }

    // _runAnglePipeline re-throws when it has nothing to fall back to.
    // In production this is caught by Promise.allSettled — other angles
    // may still succeed, so the turn doesn't fail entirely.
    await assertRejects(
      () => _runAnglePipeline(STUB_IDEA, 'value', {
        generateFn: capImmediately,
        critiqueFn: alwaysRejectCritique,
      }),
      BudgetCapError,
      'Interaction budget cap reached',
    )
  },
)

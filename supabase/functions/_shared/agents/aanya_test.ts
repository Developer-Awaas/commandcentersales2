/**
 * Unit tests for Aanya's per-angle critique loop.
 *
 * These tests import _runAnglePipeline and inject mock generateFn /
 * critiqueFn so no real API keys or network calls are needed. They test
 * the ACTUAL production code path — not a reimplementation — which is what
 * "the code says 3 isn't proof" requires.
 *
 * Run:
 *   deno test supabase/functions/_shared/agents/aanya_test.ts --allow-env
 *
 * (--allow-env is required because aanya.ts reads Deno.env at module load
 * time for ANTHROPIC_API_KEY and SUPABASE_* — the tests never invoke those
 * branches, but the env permission is needed to import the module.)
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { _runAnglePipeline, type _AnglePipelineDeps } from './aanya.ts'

// Minimal IdeatedVariant sufficient for _runAnglePipeline.
const STUB_IDEA = {
  angle: 'value' as const,
  headline: 'Test headline',
  primary_text: 'Test body',
  cta: 'Book Now',
  image_prompt: 'A luxury apartment in Mumbai at golden hour.',
  rationale: 'Price-led urgency for BOFU audience.',
}

// Minimal fake base64 image (1×1 transparent PNG, base64-encoded).
const FAKE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Factory: image gen mock that returns the fake image and tracks call count.
function makeImageMock(): { fn: _AnglePipelineDeps['generateFn']; callCount: () => number } {
  let calls = 0
  return {
    fn: async (_prompt: string) => {
      calls++
      return { imageBase64: FAKE_BASE64, mimeType: 'image/png', costUsd: 0.167 }
    },
    callCount: () => calls,
  }
}

// Critique mock that always rejects (score 40, pass: false) — never converges.
const alwaysRejectCritique: _AnglePipelineDeps['critiqueFn'] = async (_userPrompt: string) => ({
  score: 40,
  pass: false,
  feedback: 'Add more contrast and brighter accent color.',
})

// Critique mock that always passes on first attempt.
const alwaysPassCritique: _AnglePipelineDeps['critiqueFn'] = async (_userPrompt: string) => ({
  score: 90,
  pass: true,
  feedback: '',
})

// Critique mock that throws (simulates analyzer API failure).
const throwingCritique: _AnglePipelineDeps['critiqueFn'] = async (_userPrompt: string) => {
  throw new Error('Simulated critique API failure')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('iteration cap: loop stops at exactly MAX_ITERATIONS=3 when analyzer always rejects', async () => {
  const img = makeImageMock()
  const result = await _runAnglePipeline(STUB_IDEA, 'value', {
    generateFn: img.fn,
    critiqueFn: alwaysRejectCritique,
  })

  // The loop must stop at 3 — not at 2, not continue to 4.
  assertEquals(result.iterationsUsed, 3, 'must run exactly MAX_ITERATIONS=3 when always-reject')
  // All 3 attempts' image costs are accumulated, not just the final pass.
  assertEquals(result.imageCostUsd, 3 * 0.167, 'cost must include ALL iterations, not just last')
  // Image gen called 3 times (once per iteration).
  assertEquals(img.callCount(), 3)
})

Deno.test('iteration cap: loop exits early on first pass', async () => {
  const img = makeImageMock()
  const result = await _runAnglePipeline(STUB_IDEA, 'value', {
    generateFn: img.fn,
    critiqueFn: alwaysPassCritique,
  })

  assertEquals(result.iterationsUsed, 1, 'must exit on first pass')
  assertEquals(img.callCount(), 1, 'must call image gen exactly once')
})

Deno.test('iteration cap: critique throwing stops loop at that attempt, returns best-so-far image', async () => {
  const img = makeImageMock()
  // Reject on attempt 1, then throw on attempt 2.
  let calls = 0
  const failOnSecond: _AnglePipelineDeps['critiqueFn'] = async () => {
    calls++
    if (calls >= 2) throw new Error('API down')
    return { score: 40, pass: false, feedback: 'needs work' }
  }

  const result = await _runAnglePipeline(STUB_IDEA, 'value', {
    generateFn: img.fn,
    critiqueFn: failOnSecond,
  })

  // Loop ran attempt 1 (reject, continue) + attempt 2 (critique throws, break).
  assertEquals(result.iterationsUsed, 2, 'must stop at the attempt where critique throws')
  // Image was still generated on attempt 2 before the critique threw —
  // cost for both images must be accounted.
  assertEquals(result.imageCostUsd, 2 * 0.167, 'both image gen costs must be counted')
})

Deno.test('all-fail: _runAnglePipeline propagates image-gen failure immediately', async () => {
  // When generateFn throws, the error propagates straight out of the loop —
  // the !bestImageBase64 guard (which wraps into AanyaOutputError) is never
  // reached. In production, Promise.allSettled catches either error type, so
  // the distinction doesn't matter to the aggregation layer.
  let imageAttempts = 0
  const failingImage: _AnglePipelineDeps['generateFn'] = async () => {
    imageAttempts++
    throw new Error('Simulated OpenAI outage')
  }

  await assertRejects(
    () => _runAnglePipeline(STUB_IDEA, 'value', {
      generateFn: failingImage,
      critiqueFn: alwaysPassCritique,
    }),
    Error,
    'Simulated OpenAI outage',
  )
  // Retry logic lives in generateImage() (the real provider wrapper), NOT in
  // _runAnglePipeline. A mock that throws immediately is attempted once only.
  assertEquals(imageAttempts, 1)
})

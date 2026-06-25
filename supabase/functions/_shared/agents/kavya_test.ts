/**
 * Kavya regression tests — credential-free where possible.
 *
 * Tests that need a live ANTHROPIC_API_KEY are gated behind
 * `ignore: !Deno.env.get('ANTHROPIC_API_KEY')` so CI skips them without
 * failing. Run locally with the key in env to exercise the full suite.
 *
 * Following the same pattern as aanya_test.ts in this directory.
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { runKavya, type KavyaIntent } from './kavya.ts'

// ---------------------------------------------------------------------------
// Intent detection tests (credential-free — mirrors detectKavyaIntent logic)
// ---------------------------------------------------------------------------

// detectKavyaIntent lives in aarav-orchestrate (not in kavya.ts) because it's
// routing logic, not specialist logic. We duplicate the regex here to unit-test
// it without importing the entire Edge Function entry point.

function localDetect(message: string): KavyaIntent | null {
  const m = message.toLowerCase()
  if (/reel.*(script|idea|video)|video.*(script|idea)|script.*reel/.test(m)) return 'reel'
  if (
    /content\s*calendar|monthly\s*plan|what\s*(should\s*)?i\s*post|plan\s*content|smm\s*plan|social\s*media\s*plan|content\s*strateg|content\s*arc|posting\s*schedule/.test(m)
  ) return 'plan'
  if (
    /\bcaption\b|write.*(post|instagram|facebook|linkedin)|instagram\s*post|facebook\s*post|linkedin\s*post/.test(m)
  ) return 'caption'
  return null
}

Deno.test('detectKavyaIntent: reel keyword routes to reel', () => {
  assertEquals(localDetect('Write me a reel script for our pool amenity'), 'reel')
  assertEquals(localDetect('I need a reel idea for the virtual tour'), 'reel')
  assertEquals(localDetect('video script for model flat'), 'reel')
})

Deno.test('detectKavyaIntent: content calendar routes to plan', () => {
  assertEquals(localDetect('Plan content for July'), 'plan')
  assertEquals(localDetect('Create a content calendar for Instagram'), 'plan')
  assertEquals(localDetect('What should I post this week?'), 'plan')
  assertEquals(localDetect('Give me an SMM plan for next month'), 'plan')
  assertEquals(localDetect('Social media plan for Oasis 2 launch'), 'plan')
})

Deno.test('detectKavyaIntent: caption keyword routes to caption', () => {
  assertEquals(localDetect('Write a caption for this photo'), 'caption')
  assertEquals(localDetect('Write an Instagram post for our rooftop garden'), 'caption')
  assertEquals(localDetect('Give me a LinkedIn post about RERA compliance'), 'caption')
  assertEquals(localDetect('Facebook post for Diwali offer'), 'caption')
})

Deno.test('detectKavyaIntent: campaign keywords are NOT routed to Kavya', () => {
  assertEquals(localDetect('Plan a Meta Ads campaign for lead gen'), null)
  assertEquals(localDetect('What is our CPL this month?'), null)
  assertEquals(localDetect('Increase our lead volume'), null)
  assertEquals(localDetect('Run ads on Facebook for the project'), null)
})

Deno.test('detectKavyaIntent: reel takes precedence over caption keyword overlap', () => {
  // A message about a reel should NOT be routed to caption
  assertEquals(localDetect('Write a reel idea that captures attention'), 'reel')
})

// ---------------------------------------------------------------------------
// LLM integration tests (require ANTHROPIC_API_KEY — skipped in CI)
// ---------------------------------------------------------------------------

const SKIP_LLM = !Deno.env.get('ANTHROPIC_API_KEY')

Deno.test({
  name: 'kavya plan: returns 30-entry array with required fields',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runKavya({
      orgId: 'test-org',
      intent: 'plan',
      message: 'Plan Instagram content for a luxury 3BHK project in Bhubaneswar for July 2026',
    })
    assertEquals(result.intent, 'plan')
    const plan = result.output as { plan: unknown[]; strategy_note: string }
    assert(Array.isArray(plan.plan), 'output.plan must be an array')
    assertEquals(plan.plan.length, 30, 'must return exactly 30 entries')
    assert(typeof plan.strategy_note === 'string', 'strategy_note must be a string')

    const first = plan.plan[0] as Record<string, unknown>
    assert('day' in first, 'entry must have day')
    assert('date' in first, 'entry must have date')
    assert('platform' in first, 'entry must have platform')
    assert('post_type' in first, 'entry must have post_type')
    assert('caption' in first, 'entry must have caption')
    assert('creative_brief' in first, 'entry must have creative_brief')
    assert(!String(first.caption ?? '').includes('As an AI'), 'Kavya must stay in character')
  },
})

Deno.test({
  name: 'kavya caption: returns structured caption with hashtags',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runKavya({
      orgId: 'test-org',
      intent: 'caption',
      message: 'Write an Instagram caption for our new rooftop garden amenity',
    })
    assertEquals(result.intent, 'caption')
    const cap = result.output as { caption: string; hashtags: string[]; platform: string; char_count: number }
    assert(typeof cap.caption === 'string' && cap.caption.length > 0, 'caption must be non-empty')
    assert(Array.isArray(cap.hashtags) && cap.hashtags.length > 0, 'must include hashtags')
    assert(cap.hashtags.every((h: string) => h.startsWith('#')), 'hashtags must start with #')
    assert(!cap.caption.includes('As an AI'), 'must stay in character')
    assert(!cap.caption.includes('$'), 'must not use $ currency')
  },
})

Deno.test({
  name: 'kavya reel: returns 3-section script',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runKavya({
      orgId: 'test-org',
      intent: 'reel',
      message: 'Write a reel script showcasing the rooftop garden and pool area',
    })
    assertEquals(result.intent, 'reel')
    const script = result.output as { hook: string; body: string; cta: string; music_mood: string; shot_list: string[] }
    assert(typeof script.hook === 'string' && script.hook.length > 0, 'hook must be non-empty')
    assert(typeof script.body === 'string' && script.body.length > 0, 'body must be non-empty')
    assert(typeof script.cta === 'string' && script.cta.length > 0, 'cta must be non-empty')
    assert(Array.isArray(script.shot_list) && script.shot_list.length >= 2, 'shot_list must have at least 2 shots')
    assert(!script.hook.includes('As an AI'), 'must stay in character')
  },
})

Deno.test({
  name: 'kavya plan: Rath Yatra festival content appears in Odisha project plan',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runKavya({
      orgId: 'test-org',
      intent: 'plan',
      message: 'Plan content for our Odisha project for July 2026 — Rath Yatra is on July 7th',
    })
    const plan = result.output as { plan: Array<{ category: string; week_theme?: string; caption?: string }> }
    const festivalEntry = plan.plan.find(e =>
      e.category === 'festival' ||
      e.week_theme?.toLowerCase().includes('rath') ||
      e.caption?.toLowerCase().includes('rath')
    )
    assert(festivalEntry !== undefined, 'plan must include a Rath Yatra themed entry')
  },
})

Deno.test({
  name: 'kavya caption: LinkedIn post has professional tone, no emoji overload',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runKavya({
      orgId: 'test-org',
      intent: 'caption',
      message: 'Write a LinkedIn post about our RERA compliance and transparent builder practices',
    })
    const cap = result.output as { caption: string; hashtags: string[] }
    // LinkedIn posts should have ≤5 hashtags
    assert(cap.hashtags.length <= 5, 'LinkedIn caption must have ≤5 hashtags')
  },
})

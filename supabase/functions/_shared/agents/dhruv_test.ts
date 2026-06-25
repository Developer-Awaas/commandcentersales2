/**
 * Dhruv regression tests — credential-free where possible.
 *
 * Intent detection tests run in CI (no API key needed).
 * LLM integration tests are gated behind ANTHROPIC_API_KEY — set locally
 * to run the full suite: `deno test --allow-env supabase/functions/_shared/agents/`.
 *
 * Pattern mirrors kavya_test.ts: local intent detection mirrors
 * aarav-orchestrate's detectDhruvIntent regex so routing logic is
 * independently verified without importing the edge-function entry point.
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { runDhruv, type DhruvIntent, type DhruvReactiveOutput, type DhruvReportOutput, type DhruvDashboardOutput } from './dhruv.ts'
import type { MetricsContext } from '../metrics-query.ts'

// ─── Local intent detection mirror ───────────────────────────────────────────
// detectDhruvIntent is private to aarav-orchestrate (routing logic).
// Duplicate the regex here so we can unit-test it without importing the
// entire edge-function entry point (which requires live env vars).

function localDetect(message: string): DhruvIntent | null {
  const m = message.toLowerCase()

  if (/monthly\s*report|marketing\s*report|generate\s*report|quarterly\s*report/.test(m)) return 'report'

  const analyticsPattern = new RegExp(
    'how\\s*(is|are|was|were)\\s*(my|our|the)\\s*(campaign|campaigns|ads?|performance|results|numbers)|' +
    'campaign\\s*performance|my\\s*cpl|cpl\\s*(this|last|week|month)|ctr\\s*(this|last|week|month)|' +
    'ad\\s*(spend|budget|performance|results|stats|metrics|fatigue)|' +
    'how\\s*are\\s*(things|we|my\\s*ads)|\\bmetrics\\b|\\banalytics\\b|' +
    'which\\s*(campaign|ad|creative)\\s*(is|are|work|perform)|' +
    'best\\s*(campaign|ad|creative)|worst\\s*(campaign|ad|creative)|' +
    '\\broas\\b|\\bctr\\b|\\bcpm\\b|impressions'
  )
  if (analyticsPattern.test(m)) return 'reactive'

  return null
}

// ─── Shared fixture: a minimal MetricsContext with realistic numbers ──────────

const MOCK_CONTEXT: MetricsContext = {
  period: { start: '2026-06-01', end: '2026-06-25', days: 30 },
  campaigns: [
    {
      campaign_id: 'camp-001', campaign_name: 'Oasis 2 Awareness',
      spend_30d: 45000, leads_30d: 150, cpl_avg: 300, ctr_avg: 0.025,
      impressions_30d: 60000, clicks_30d: 1500,
    },
    {
      campaign_id: 'camp-002', campaign_name: 'Oasis 2 Conversion',
      spend_30d: 30000, leads_30d: 50, cpl_avg: 600, ctr_avg: 0.018,
      impressions_30d: 40000, clicks_30d: 720,
    },
  ],
  aggregates: {
    total_spend: 75000, total_leads: 200, avg_cpl: 375, avg_ctr: 0.022,
    wow_cpl_delta_pct: -18.2, wow_spend_delta_pct: 5.1,
    impressions_total: 100000, clicks_total: 2220,
  },
  alerts: [
    {
      type: 'ad_fatigue', severity: 'medium',
      campaign_id: 'camp-002', campaign_name: 'Oasis 2 Conversion',
      message: 'Ad fatigue: frequency 2.8× — audience has seen your ad too many times',
      value: 2.8, threshold: 2.5,
    },
  ],
  day_of_week_performance: [
    { day_of_week: 1, day_name: 'Monday',   avg_cpl: 350, avg_ctr: 0.024, avg_spend: 2500, data_points: 4 },
    { day_of_week: 5, day_name: 'Friday',   avg_cpl: 290, avg_ctr: 0.029, avg_spend: 2800, data_points: 4 },
    { day_of_week: 0, day_name: 'Sunday',   avg_cpl: 410, avg_ctr: 0.018, avg_spend: 1900, data_points: 4 },
  ],
  top_campaign:   { campaign_id: 'camp-001', campaign_name: 'Oasis 2 Awareness',   why: 'Lowest CPL at ₹300 with 150 leads' },
  worst_campaign: { campaign_id: 'camp-002', campaign_name: 'Oasis 2 Conversion', why: 'Highest CPL at ₹600 with only 50 leads' },
  has_data: true,
}

const EMPTY_CONTEXT: MetricsContext = {
  period: { start: '2026-06-01', end: '2026-06-25', days: 30 },
  campaigns: [], alerts: [], day_of_week_performance: [],
  aggregates: { total_spend: 0, total_leads: 0, avg_cpl: 0, avg_ctr: 0, wow_cpl_delta_pct: 0, wow_spend_delta_pct: 0, impressions_total: 0, clicks_total: 0 },
  top_campaign: null, worst_campaign: null, has_data: false,
}

// ─── Intent detection tests (credential-free) ─────────────────────────────────

Deno.test('detectDhruvIntent: marketing report routes to report', () => {
  assertEquals(localDetect('Generate my monthly marketing report'), 'report')
  assertEquals(localDetect('Create a quarterly report for the board'), 'report')
  assertEquals(localDetect('I need my marketing report for June'), 'report')
})

Deno.test('detectDhruvIntent: campaign analytics routes to reactive', () => {
  assertEquals(localDetect('How is my campaign doing?'), 'reactive')
  assertEquals(localDetect('How are our ads performing this week?'), 'reactive')
  assertEquals(localDetect('What is my CPL this month?'), 'reactive')
  assertEquals(localDetect('Which campaign is working best?'), 'reactive')
  assertEquals(localDetect('Show me the metrics'), 'reactive')
  assertEquals(localDetect('campaign performance last month'), 'reactive')
})

Deno.test('detectDhruvIntent: ad fatigue and spend route to reactive', () => {
  assertEquals(localDetect('My ad spend is too high this week'), 'reactive')
  assertEquals(localDetect('I think there might be ad fatigue'), 'reactive')
  assertEquals(localDetect('What is our ROAS?'), 'reactive')
  assertEquals(localDetect('CTR dropped this week'), 'reactive')
})

Deno.test('detectDhruvIntent: SMM and creative messages are NOT Dhruv', () => {
  assertEquals(localDetect('Write me a caption for Instagram'), null)
  assertEquals(localDetect('Plan content for July'), null)
  assertEquals(localDetect('Create a reel script'), null)
  assertEquals(localDetect('Run Meta Ads for our project'), null)
})

Deno.test('detectDhruvIntent: report takes precedence over analytics keywords', () => {
  // A message about a report should not be 'reactive'
  assertEquals(localDetect('Generate my monthly marketing report for the board'), 'report')
})

// ─── LLM integration tests (require ANTHROPIC_API_KEY — skipped in CI) ───────

const SKIP_LLM = !Deno.env.get('ANTHROPIC_API_KEY')

Deno.test({
  name: 'dhruv reactive: references actual CPL from metrics_context, not hallucinated',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runDhruv({
      orgId: 'test-org',
      intent: 'reactive',
      message: 'How is my Oasis 2 campaign doing this month?',
      metricsContext: MOCK_CONTEXT,
    })
    assertEquals(result.intent, 'reactive')
    const out = result.output as DhruvReactiveOutput
    assert(typeof out.summary === 'string' && out.summary.length > 0, 'summary must be non-empty')
    assert(typeof out.details === 'string' && out.details.length > 0, 'details must be non-empty')
    assert(Array.isArray(out.recommendations) && out.recommendations.length > 0, 'must include recommendations')
    assert(!out.summary.includes('As an AI'), 'must stay in character')
    // Dhruv must reference actual numbers, not invent them
    const text = out.summary + ' ' + out.details
    assert(!text.includes('$'), 'must not use $ currency')
    // Should mention some actual number from context (CPL 375, leads 200, etc.)
    assert(
      /₹|300|375|600|150|200|18/.test(text),
      'must reference actual numbers from metrics_context'
    )
    // delegate_suggestion must be valid or null
    assert(
      out.delegate_suggestion === null || out.delegate_suggestion === 'arjun' || out.delegate_suggestion === 'aanya',
      'delegate_suggestion must be arjun, aanya, or null'
    )
  },
})

Deno.test({
  name: 'dhruv report: all required sections present',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runDhruv({
      orgId: 'test-org',
      intent: 'report',
      message: 'Generate my June 2026 marketing report',
      metricsContext: MOCK_CONTEXT,
    })
    assertEquals(result.intent, 'report')
    const out = result.output as DhruvReportOutput
    assert(typeof out.title === 'string' && out.title.length > 0, 'title required')
    assert(typeof out.executive_summary === 'string' && out.executive_summary.length > 50, 'executive_summary must be substantial')
    assert(Array.isArray(out.sections) && out.sections.length >= 3, 'must have at least 3 sections')
    for (const section of out.sections) {
      assert(typeof section.heading === 'string', 'each section needs a heading')
      assert(typeof section.body === 'string' && section.body.length > 20, 'each section needs substantial body')
    }
    assert(!out.executive_summary.includes('As an AI'), 'must stay in character')
  },
})

Deno.test({
  name: 'dhruv dashboard: returns 3-5 severity cards',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runDhruv({
      orgId: 'test-org',
      intent: 'dashboard',
      message: 'Dashboard metrics summary',
      metricsContext: MOCK_CONTEXT,
    })
    assertEquals(result.intent, 'dashboard')
    const out = result.output as DhruvDashboardOutput
    assert(Array.isArray(out.cards), 'cards must be an array')
    assert(out.cards.length >= 3 && out.cards.length <= 5, 'must return 3-5 cards')
    for (const card of out.cards) {
      assert(['red', 'amber', 'green'].includes(card.severity), 'severity must be red/amber/green')
      assert(typeof card.title === 'string' && card.title.length > 0, 'card title required')
      assert(typeof card.body === 'string' && card.body.length > 0, 'card body required')
    }
    // Must include at least one green card when metrics show positive data (CPL dropped 18%)
    const hasGreen = out.cards.some(c => c.severity === 'green')
    assert(hasGreen, 'must have at least one green card when positive signals exist')
  },
})

Deno.test({
  name: 'dhruv reactive: empty metrics triggers honest "not enough data" response',
  ignore: SKIP_LLM,
  async fn() {
    const result = await runDhruv({
      orgId: 'test-org',
      intent: 'reactive',
      message: 'How are my campaigns doing?',
      metricsContext: EMPTY_CONTEXT,
    })
    const out = result.output as DhruvReactiveOutput
    const allText = (out.summary + ' ' + out.details).toLowerCase()
    assert(
      allText.includes('not enough') || allText.includes('no data') || allText.includes('few days') || allText.includes('haven'),
      'must acknowledge lack of data honestly'
    )
  },
})

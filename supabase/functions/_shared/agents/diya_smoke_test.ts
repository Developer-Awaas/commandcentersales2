/**
 * Diya brand-discrimination smoke test.
 *
 * Feeds one clearly on-brand and one clearly off-brand creative to
 * runBrandCheck and asserts they get DIFFERENT verdicts (pass vs flag).
 * If both get the same verdict, it's a mechanism bug (Diya is rubber-
 * stamping or blanket-flagging regardless of input) — fix before shipping.
 *
 * This is an integration test: it calls the real Anthropic API with a
 * real vision request. You need a real image URL (public, reachable from
 * the Edge Function runtime) and real API keys set in the environment.
 *
 * Prerequisites:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   export SUPABASE_URL=https://your-project.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Run:
 *   deno test supabase/functions/_shared/agents/diya_smoke_test.ts \
 *     --allow-env --allow-net
 *
 * ON-BRAND image: use a creatives url from brand-assets that matches your
 * brand kit colors. Replace ON_BRAND_IMAGE_URL and OFF_BRAND_IMAGE_URL
 * with real public URLs before running.
 *
 * What "pass vs flag" means here:
 *   - on-brand creative: colors match primary/accent from the brand kit,
 *     no competitor logos, professional quality → Diya should return 'pass'
 *   - off-brand creative: wrong color palette (e.g. competitor brand colors),
 *     or a clearly unsuitable image → Diya should return 'flag'
 *
 * If this test fails because Diya flags the on-brand image too:
 *   1. Check if the brand kit in brand_kits table for this org has the
 *      correct colors.
 *   2. Review the DIYA_PROMPT in prompts.ts — it is intentionally conservative
 *      ("default to flag on uncertainty"). If the image is ambiguous, that's
 *      expected behavior, not a mechanism bug. Use a more clearly on-brand image.
 *   3. If Diya passes the off-brand image, THAT is the mechanism bug to fix —
 *      check that vision is actually receiving the image URL correctly and that
 *      the prompt is strict enough.
 */

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { runBrandCheck, type BrandKitRow } from './diya.ts'

// ─── Configuration — fill in before running ──────────────────────────────────

// A generated creative that matches the brand kit below.
// Must be a public URL reachable from the Deno runtime (not localhost).
// Example: a stored URL from generated-creatives/ in brand-assets bucket.
const ON_BRAND_IMAGE_URL = Deno.env.get('SMOKE_ON_BRAND_URL') ?? ''

// An image that clearly violates the brand kit — e.g. competitor logo,
// wrong color scheme (bright red when the kit is navy/gold), stock photo
// that contradicts the design aesthetic.
const OFF_BRAND_IMAGE_URL = Deno.env.get('SMOKE_OFF_BRAND_URL') ?? ''

// The org to run the check against. If set, runBrandCheck loads the real
// kit from brand_kits. If not set, MANUAL_KIT below is injected directly.
const ORG_ID = Deno.env.get('SMOKE_ORG_ID') ?? 'smoke-test-org'

// Fallback kit used when SMOKE_ORG_ID is not set — lets the test run
// without a real org in the DB, at the cost of needing the right colors
// to match your test images.
const MANUAL_KIT: BrandKitRow = {
  primary_color: '#1A3A5C',    // deep navy
  secondary_color: '#2C5282',
  accent_color: '#C9A961',     // gold
  text_color: '#FFFFFF',
  background_color: '#0F2035',
  primary_font: 'Montserrat',
  brand_voice: 'Premium, aspirational, trustworthy',
  design_aesthetic: 'Luxury real estate — dark backgrounds, gold accents, clean typography',
  cultural_motifs: [],
  logo_color_url: '',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test({
  name: 'Diya smoke: on-brand creative passes, off-brand creative flags',
  ignore: !ON_BRAND_IMAGE_URL || !OFF_BRAND_IMAGE_URL,
  async fn() {
    const traceId = `smoke-${crypto.randomUUID()}`

    const onBrandVariant = {
      id: 'on-brand-id',
      label: 'On-brand test',
      angle: 'value' as const,
      preview_color: '#1A3A5C',
      image_url: ON_BRAND_IMAGE_URL,
      copy: { headline: 'Premium 2BHK from ₹85L', primary_text: 'Book now', cta: 'Enquire' },
    }
    const offBrandVariant = {
      id: 'off-brand-id',
      label: 'Off-brand test',
      angle: 'lifestyle' as const,
      preview_color: '#FF0000',
      image_url: OFF_BRAND_IMAGE_URL,
      copy: { headline: 'Cheap homes', primary_text: 'Discount deal', cta: 'Click' },
    }

    const result = await runBrandCheck({
      orgId: ORG_ID,
      variants: [onBrandVariant, offBrandVariant],
      traceId,
      // Inject manual kit if no real org; otherwise Diya loads it from DB.
      kit: Deno.env.get('SMOKE_ORG_ID') ? undefined : MANUAL_KIT,
    })

    const onBrandVerdict  = result.verdict.per_variant?.['on-brand-id']
    const offBrandVerdict = result.verdict.per_variant?.['off-brand-id']

    console.log('On-brand verdict: ', JSON.stringify(onBrandVerdict))
    console.log('Off-brand verdict:', JSON.stringify(offBrandVerdict))

    // The two verdicts must be DIFFERENT — if both are 'flag' or both 'pass',
    // Diya is not discriminating and the mechanism needs investigation.
    assertNotEquals(
      onBrandVerdict?.status,
      offBrandVerdict?.status,
      `Expected on-brand="${onBrandVerdict?.status}" and off-brand="${offBrandVerdict?.status}" to differ. ` +
      `If both are "flag": the on-brand image or kit may be ambiguous. ` +
      `If both are "pass": Diya is rubber-stamping — check the vision URL and prompt.`
    )

    // On-brand should pass, off-brand should flag.
    assertEquals(onBrandVerdict?.status,  'pass', `On-brand creative should pass. Diya note: "${onBrandVerdict?.note}"`)
    assertEquals(offBrandVerdict?.status, 'flag', `Off-brand creative should be flagged. Diya note: "${offBrandVerdict?.note}"`)
  },
})

Deno.test({
  name: 'Diya smoke: no-kit org flags all variants without LLM spend',
  async fn() {
    const result = await runBrandCheck({
      orgId: 'no-kit-org',
      variants: [{
        id: 'v1', label: 'test', angle: 'value' as const, preview_color: '#000',
        image_url: 'https://example.com/image.png',
        copy: { headline: 'h', primary_text: 'p', cta: 'c' },
      }],
      traceId: `smoke-nokit-${crypto.randomUUID()}`,
      kit: null, // explicitly no kit
    })

    assertEquals(result.model, 'none', 'no LLM model should be invoked when kit is null')
    assertEquals(result.inputTokens, 0)
    assertEquals(result.outputTokens, 0)
    assertEquals(result.totalCostUsd, 0)
    assertEquals(result.verdict.per_variant?.['v1']?.status, 'flag')
  },
})

import { describe, it, expect } from 'vitest';
import { assertMetricSeedAllowed, SeedTargetRefused, ZZ_INTERNAL_TEST_ORG_ID } from '../../scripts/lib/seed-guard';

// The review org on CC-TEST — the one a Meta reviewer logs into, and the one
// that was carrying 90 fabricated campaign_metrics rows next to real synced
// ones with nothing in the UI able to tell them apart.
const REVIEW_ORG = '1a0f7ac3-8053-4aee-824c-75f27681ce64';

describe('seed guard — synthetic metrics allowlist', () => {
  it('allows ZZ-INTERNAL-TEST without ceremony', () => {
    expect(() => assertMetricSeedAllowed(ZZ_INTERNAL_TEST_ORG_ID, {})).not.toThrow();
  });

  it('REFUSES the review org by default — the regression this exists to stop', () => {
    expect(() => assertMetricSeedAllowed(REVIEW_ORG, {})).toThrow(SeedTargetRefused);
  });

  it('refuses any unknown org by default', () => {
    expect(() => assertMetricSeedAllowed('00000000-0000-0000-0000-000000000123', {})).toThrow(SeedTargetRefused);
  });

  it('allows an explicitly named org via SEED_ALLOW_ORG', () => {
    expect(() => assertMetricSeedAllowed(REVIEW_ORG, { SEED_ALLOW_ORG: REVIEW_ORG })).not.toThrow();
  });

  it('requires an EXACT match — naming a different org does not unlock this one', () => {
    // A blanket "yes" flag would be satisfied by any value; the id must be the
    // one actually being written to.
    expect(() => assertMetricSeedAllowed(REVIEW_ORG, { SEED_ALLOW_ORG: ZZ_INTERNAL_TEST_ORG_ID }))
      .toThrow(SeedTargetRefused);
    expect(() => assertMetricSeedAllowed(REVIEW_ORG, { SEED_ALLOW_ORG: 'true' })).toThrow(SeedTargetRefused);
    expect(() => assertMetricSeedAllowed(REVIEW_ORG, { SEED_ALLOW_ORG: '' })).toThrow(SeedTargetRefused);
  });

  it('tolerates whitespace around the opt-in value', () => {
    expect(() => assertMetricSeedAllowed(REVIEW_ORG, { SEED_ALLOW_ORG: `  ${REVIEW_ORG}  ` })).not.toThrow();
  });

  it('names the org and the opt-in in the error, so the fix is obvious', () => {
    try {
      assertMetricSeedAllowed(REVIEW_ORG, {});
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain(REVIEW_ORG);
      expect(msg).toContain('SEED_ALLOW_ORG');
    }
  });
});

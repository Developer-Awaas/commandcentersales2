import { describe, it, expect } from 'vitest';
import {
  publishOptions,
  canOfferPublish,
  buildDefaultCaption,
  EMPTY_TARGETS,
  type PublishTargets,
} from './publish-targets';

const FB_ONLY: PublishTargets = {
  pageId: '111111111111111', pageName: 'AWAAS CC Test Page', igUserId: null, igUsername: null,
};
const FB_AND_IG: PublishTargets = {
  ...FB_ONLY, igUserId: '17841456204713794', igUsername: 'awaas_test',
};

describe('publishOptions', () => {
  it('offers nothing when no Page target is configured', () => {
    expect(publishOptions(EMPTY_TARGETS)).toEqual([]);
  });

  it('offers Facebook by NAME, not by id, when a name is known', () => {
    expect(publishOptions(FB_ONLY)).toEqual([
      { platform: 'facebook', name: 'AWAAS CC Test Page' },
    ]);
  });

  it('falls back to the id only when there is no name to show', () => {
    expect(publishOptions({ ...FB_ONLY, pageName: null })[0].name).toBe('111111111111111');
  });

  it('offers Instagram only alongside a Page — an IG publish rides the Page token', () => {
    // IG configured but no Page: cannot work, must not be offered.
    expect(publishOptions({ ...FB_AND_IG, pageId: null })).toEqual([]);
    expect(publishOptions(FB_AND_IG).map((o) => o.platform)).toEqual(['facebook', 'instagram']);
  });

  it('prefixes an IG handle so the target reads as an account, not a Page', () => {
    expect(publishOptions(FB_AND_IG)[1].name).toBe('@awaas_test');
  });
});

describe('canOfferPublish', () => {
  it('requires BOTH a configured target and a persisted image', () => {
    expect(canOfferPublish(FB_ONLY, true)).toBe(true);
    expect(canOfferPublish(FB_ONLY, false)).toBe(false);
    expect(canOfferPublish(EMPTY_TARGETS, true)).toBe(false);
    expect(canOfferPublish(EMPTY_TARGETS, false)).toBe(false);
  });
});

describe('buildDefaultCaption', () => {
  it('joins the parts it has, in post order, with blank lines', () => {
    expect(buildDefaultCaption({ headline: '3BHK from Rs 85L', body: 'Ready to move.', cta: 'Book a visit' }))
      .toBe('3BHK from Rs 85L\n\nReady to move.\n\nBook a visit');
  });

  it('skips missing and whitespace-only parts rather than leaving gaps', () => {
    expect(buildDefaultCaption({ headline: 'Only this', body: '   ', cta: null })).toBe('Only this');
  });

  it('returns empty when there is nothing to prefill, so the user must write one', () => {
    expect(buildDefaultCaption({})).toBe('');
  });
});

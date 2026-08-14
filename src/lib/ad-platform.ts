// src/lib/ad-platform.ts
//
// P2.13 PART C — one vocabulary for "which ad platform is this for".
//
// Before this, the answer was a display string ('AiSensy' | 'Meta Ads Manager')
// duplicated as a literal union in eight places: three page-local option lists,
// four prompt-builder signatures, and leadgen-v2's contracts. Adding a platform
// meant finding all of them, and comparisons were done against human-facing
// text that a copy edit could silently invalidate.
//
// AiSensy is gone from the selectors. It is a WhatsApp/CTWA delivery tool, not
// an ad platform sitting alongside Meta — a Click-to-WhatsApp ad IS a Meta ad,
// bought in Meta Ads Manager, that happens to land in AiSensy. Offering it as a
// third peer made "platform" mean two different things at once. The CTWA
// rendering scaffolding is deliberately retained (see StrategyResult.tsx) for
// when Click-to-WhatsApp is modelled properly as a Meta ad TYPE.
//
// Stored values are these lowercase codes, matching the CHECK on
// campaigns.platform / tool_outputs.platform (migration 20260814120000).
// Display text lives in adPlatformLabel and is never persisted.

export type AdPlatform = 'meta' | 'google';

export const DEFAULT_AD_PLATFORM: AdPlatform = 'meta';

const LABELS: Record<AdPlatform, string> = {
  meta: 'Meta Ads Manager',
  google: 'Google Ads',
};

export function adPlatformLabel(platform: AdPlatform): string {
  return LABELS[platform] ?? LABELS[DEFAULT_AD_PLATFORM];
}

/** Option list for every <Select>, so the pickers cannot drift apart. */
export const AD_PLATFORM_OPTIONS: { value: AdPlatform; label: string }[] = [
  { value: 'meta', label: LABELS.meta },
  { value: 'google', label: LABELS.google },
];

/**
 * Coerce anything historical into the current vocabulary.
 *
 * Reads hit three generations of value: the new codes, the old display strings
 * ('Meta Ads Manager'), and 'AiSensy'. AiSensy maps to 'meta' rather than being
 * dropped, because a Click-to-WhatsApp ad genuinely was bought on Meta — that
 * is the accurate answer, not a fallback.
 *
 * Returns null for absent/unrecognised input rather than defaulting to Meta:
 * the column is nullable precisely so "not recorded" stays distinguishable
 * from "recorded as Meta", and inventing a value here would erase that.
 */
export function normalizeAdPlatform(value: unknown): AdPlatform | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v === 'meta' || v.includes('meta') || v === 'aisensy' || v.includes('whatsapp')) return 'meta';
  if (v === 'google' || v.includes('google')) return 'google';
  return null;
}

/**
 * Per-platform ad-copy limits, stated once and injected into the prompt
 * builders. These are the platform's own published field limits — the reason
 * generated copy has to differ at all.
 */
export interface AdCopyLimits {
  headline: string;
  primaryText: string;
  description: string;
}

export const AD_COPY_LIMITS: Record<AdPlatform, AdCopyLimits> = {
  meta: {
    headline: 'headline must be <= 40 characters',
    primaryText: 'the first 125 characters of primary_text must stand alone as a complete hook (Meta truncates there)',
    description: 'description must be <= 30 characters',
  },
  google: {
    // Responsive Search / Performance Max field limits.
    headline: 'headline must be <= 30 characters (Google Ads headline asset limit)',
    primaryText: 'primary_text is the long description asset: <= 90 characters, one complete benefit-led sentence',
    description: 'description must be <= 30 characters, usable as a short sitelink/callout label',
  },
};

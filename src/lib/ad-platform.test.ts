import { describe, it, expect } from 'vitest';
import { normalizeAdPlatform, adPlatformLabel, AD_PLATFORM_OPTIONS, AD_COPY_LIMITS, DEFAULT_AD_PLATFORM } from './ad-platform';

describe('normalizeAdPlatform', () => {
  it('passes through the current vocabulary', () => {
    expect(normalizeAdPlatform('meta')).toBe('meta');
    expect(normalizeAdPlatform('google')).toBe('google');
  });

  it('maps the legacy display strings the DB already holds', () => {
    // campaigns.platform has existed since 20260409123924 and was written with
    // these; the migration normalises them with the same mapping as this.
    expect(normalizeAdPlatform('Meta Ads Manager')).toBe('meta');
    expect(normalizeAdPlatform('Meta')).toBe('meta');
    expect(normalizeAdPlatform('Google Ads')).toBe('google');
  });

  it("maps AiSensy to meta rather than dropping it", () => {
    // A Click-to-WhatsApp ad IS a Meta ad — that is the accurate answer, not a
    // fallback. CTWA-ness is carried by campaigns.ad_type, not by platform.
    expect(normalizeAdPlatform('AiSensy')).toBe('meta');
    expect(normalizeAdPlatform('AiSensy (WhatsApp)')).toBe('meta');
  });

  it('returns null for absent/unknown input instead of guessing meta', () => {
    // The column is nullable precisely so "not recorded" stays distinguishable
    // from "recorded as Meta". Defaulting here would erase that distinction.
    expect(normalizeAdPlatform('')).toBeNull();
    expect(normalizeAdPlatform('   ')).toBeNull();
    expect(normalizeAdPlatform(null)).toBeNull();
    expect(normalizeAdPlatform(undefined)).toBeNull();
    expect(normalizeAdPlatform(42)).toBeNull();
    expect(normalizeAdPlatform('LinkedIn')).toBeNull();
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeAdPlatform('  META ADS MANAGER  ')).toBe('meta');
    expect(normalizeAdPlatform('google ads')).toBe('google');
  });
});

describe('ad platform vocabulary', () => {
  it('offers exactly meta and google, defaulting to meta', () => {
    expect(AD_PLATFORM_OPTIONS.map((o) => o.value)).toEqual(['meta', 'google']);
    expect(DEFAULT_AD_PLATFORM).toBe('meta');
  });

  it('every option value round-trips through normalize and has a label', () => {
    // Guards the pickers against ever offering a value the CHECK constraint
    // would reject on save.
    for (const opt of AD_PLATFORM_OPTIONS) {
      expect(normalizeAdPlatform(opt.value)).toBe(opt.value);
      expect(adPlatformLabel(opt.value)).toBe(opt.label);
      expect(AD_COPY_LIMITS[opt.value]).toBeTruthy();
    }
  });

  it('states different copy limits per platform', () => {
    // If these ever match, the platform choice has stopped changing anything.
    expect(AD_COPY_LIMITS.meta.headline).not.toBe(AD_COPY_LIMITS.google.headline);
    expect(AD_COPY_LIMITS.meta.primaryText).not.toBe(AD_COPY_LIMITS.google.primaryText);
  });
});

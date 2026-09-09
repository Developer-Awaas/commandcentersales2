import { describe, it, expect } from 'vitest';
import { normalizeHashtags, formatHashtag, formatHashtags } from './hashtags';

describe('normalizeHashtags', () => {
  it('strips the leading # the model already added', () => {
    expect(normalizeHashtags(['#Patia', '#BhubaneswarHomes'])).toEqual(['Patia', 'BhubaneswarHomes']);
  });

  it('leaves already-canonical tags alone', () => {
    expect(normalizeHashtags(['Patia', 'Rooftop'])).toEqual(['Patia', 'Rooftop']);
  });

  it('collapses a doubled ## from a previous buggy round trip', () => {
    expect(normalizeHashtags(['##Patia'])).toEqual(['Patia']);
  });

  it('accepts a single delimited string, which the model sometimes returns', () => {
    expect(normalizeHashtags('#a #b, #c')).toEqual(['a', 'b', 'c']);
  });

  it('drops empties and bare # rather than emitting a dead tag', () => {
    expect(normalizeHashtags(['#', '', '   ', '#real'])).toEqual(['real']);
  });

  it('dedupes case-insensitively — Instagram treats them as one tag', () => {
    expect(normalizeHashtags(['#Patia', '#patia', 'PATIA'])).toEqual(['Patia']);
  });

  it('is total on junk input', () => {
    expect(normalizeHashtags(null)).toEqual([]);
    expect(normalizeHashtags(undefined)).toEqual([]);
    expect(normalizeHashtags(42)).toEqual([]);
  });

  it('round-trips through the formatter with exactly one #', () => {
    expect(formatHashtags(normalizeHashtags(['##Patia', '#Rooftop']))).toBe('#Patia #Rooftop');
  });
});

describe('formatHashtag', () => {
  it('adds exactly one # to a canonical tag', () => {
    expect(formatHashtag('Patia')).toBe('#Patia');
  });

  it('is idempotent — applying it twice cannot produce ##', () => {
    const once = formatHashtag('Patia');
    expect(formatHashtag(once)).toBe(once);
    expect(formatHashtag(formatHashtag(formatHashtag('Patia')))).toBe('#Patia');
  });

  it('repairs a legacy row that was stored WITH the # (pre-normalizer writes)', () => {
    expect(formatHashtag('#Patia')).toBe('#Patia');
    expect(formatHashtag('##Patia')).toBe('#Patia');
  });

  it('renders nothing for input that normalises away, never a bare #', () => {
    expect(formatHashtag('#')).toBe('');
    expect(formatHashtag('   ')).toBe('');
  });

  it('preserves case — the project dedupes case-insensitively but stores as written', () => {
    expect(formatHashtag('#BhubaneswarHomes')).toBe('#BhubaneswarHomes');
  });
});

describe('formatHashtags (list)', () => {
  it('is idempotent over a mixed legacy/canonical list', () => {
    const mixed = ['#Patia', 'Rooftop', '##Kalinga'];
    expect(formatHashtags(mixed)).toBe('#Patia #Rooftop #Kalinga');
    // The fixture in src/mocks/ai-fixtures.ts stores tags WITH '#', which is
    // exactly the legacy shape a render site cannot distinguish.
    expect(formatHashtags(['#Bhubaneswar', '#RealEstate'])).toBe('#Bhubaneswar #RealEstate');
  });

  it('dedupes while formatting, so a caption never carries the same tag twice', () => {
    expect(formatHashtags(['#Patia', 'patia'])).toBe('#Patia');
  });
});

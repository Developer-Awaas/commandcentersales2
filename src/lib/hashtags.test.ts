import { describe, it, expect } from 'vitest';
import { normalizeHashtags, formatHashtags } from './hashtags';

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

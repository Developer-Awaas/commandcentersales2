import { describe, it, expect } from 'vitest';
import { isValidReferenceAnalysis, sanitizePalette, buildReferenceStyleBlock, referenceMode, isValidReferenceZone, clampBbox, dedupeZones, type ReferenceAnalysis, type ReferenceZone } from './reference-style';

const valid: ReferenceAnalysis = {
  palette: ['#0A2540', '#F5F5F5'],
  layout: 'Hero image on top, color band with copy at bottom.',
  text_treatment: 'Bold uppercase headline, accent-color price.',
};

describe('isValidReferenceAnalysis', () => {
  it('accepts a well-formed analysis', () => {
    expect(isValidReferenceAnalysis(valid)).toBe(true);
  });
  it('rejects non-objects', () => {
    expect(isValidReferenceAnalysis(null)).toBe(false);
    expect(isValidReferenceAnalysis('x')).toBe(false);
    expect(isValidReferenceAnalysis(42)).toBe(false);
  });
  it('rejects a non-array palette', () => {
    expect(isValidReferenceAnalysis({ ...valid, palette: '#fff' })).toBe(false);
  });
  it('rejects a palette with non-string entries', () => {
    expect(isValidReferenceAnalysis({ ...valid, palette: ['#fff', 123] })).toBe(false);
  });
  it('rejects missing/typed-wrong layout or text_treatment', () => {
    expect(isValidReferenceAnalysis({ ...valid, layout: undefined })).toBe(false);
    expect(isValidReferenceAnalysis({ ...valid, text_treatment: 5 })).toBe(false);
  });
  it('accepts both valid modes and a mode-less (legacy) analysis', () => {
    expect(isValidReferenceAnalysis({ ...valid, mode: 'style_hints' })).toBe(true);
    expect(isValidReferenceAnalysis({ ...valid, mode: 'replicate_layout' })).toBe(true);
    expect(isValidReferenceAnalysis(valid)).toBe(true); // no mode = legacy, still valid
  });
  it('rejects an unknown mode value', () => {
    expect(isValidReferenceAnalysis({ ...valid, mode: 'freehand' })).toBe(false);
  });
});

describe('referenceMode', () => {
  it("defaults a mode-less analysis to 'style_hints'", () => {
    expect(referenceMode(valid)).toBe('style_hints');
  });
  it('returns the explicit mode when set', () => {
    expect(referenceMode({ ...valid, mode: 'replicate_layout' })).toBe('replicate_layout');
  });
});

const zone = (role: ReferenceZone['role'], bbox: [number, number, number, number]): ReferenceZone =>
  ({ role, bbox, align: 'left', fontScale: 0.05, weight: 'bold', color: '#fff' });

describe('isValidReferenceZone', () => {
  it('accepts a well-formed zone', () => {
    expect(isValidReferenceZone(zone('headline', [0.1, 0.1, 0.8, 0.1]))).toBe(true);
  });
  it('rejects unknown roles, malformed bbox, bad align', () => {
    expect(isValidReferenceZone({ ...zone('headline', [0, 0, 1, 0.1]), role: 'nope' })).toBe(false);
    expect(isValidReferenceZone({ ...zone('headline', [0, 0, 1] as never) })).toBe(false);
    expect(isValidReferenceZone({ ...zone('headline', [0, 0, 1, 0.1]), align: 'middle' })).toBe(false);
  });
});

describe('clampBbox', () => {
  it('clamps into the unit square and shrinks overflow', () => {
    expect(clampBbox([-0.1, 0.2, 1.5, 0.3])).toEqual([0, 0.2, 1, 0.3]);
    const r = clampBbox([0.8, 0.9, 0.5, 0.5]);
    expect(r[0]).toBeCloseTo(0.8); expect(r[1]).toBeCloseTo(0.9);
    expect(r[2]).toBeCloseTo(0.2); expect(r[3]).toBeCloseTo(0.1);
  });
});

describe('dedupeZones', () => {
  it('merges two vertically-adjacent headline fragments into one spanning box', () => {
    const merged = dedupeZones([zone('headline', [0.1, 0.10, 0.8, 0.06]), zone('headline', [0.1, 0.16, 0.8, 0.08])]);
    expect(merged.filter((z) => z.role === 'headline')).toHaveLength(1);
    expect(merged[0].bbox[3]).toBeCloseTo(0.14); // 0.10 -> 0.24
  });
  it('keeps distinct badge cells and a checklist separate (not merged)', () => {
    const zones = [zone('badge', [0.05, 0.5, 0.25, 0.06]), zone('badge', [0.375, 0.5, 0.25, 0.06]), zone('checklist', [0.05, 0.6, 0.4, 0.2])];
    expect(dedupeZones(zones)).toHaveLength(3);
  });
});

describe('sanitizePalette', () => {
  it('keeps only valid hex and trims', () => {
    expect(sanitizePalette([' #0A2540 ', '#fff', 'navy', 'rgb(0,0,0)', '#12345'])).toEqual(['#0A2540', '#fff']);
  });
  it('caps at 8 colours', () => {
    const many = Array.from({ length: 12 }, (_, i) => `#0000${(i % 10)}${(i % 10)}`);
    expect(sanitizePalette(many).length).toBe(8);
  });
});

describe('buildReferenceStyleBlock', () => {
  it('states the hard no-subject rule', () => {
    const block = buildReferenceStyleBlock(valid, [], null);
    expect(block).toMatch(/HARD RULE/);
    expect(block).toMatch(/DO NOT copy/i);
    expect(block).toMatch(/depict THIS project/i);
  });
  it('includes sanitized palette, layout and text treatment', () => {
    const block = buildReferenceStyleBlock({ ...valid, palette: ['#0A2540', 'notahex'] }, [], null);
    expect(block).toMatch(/#0A2540/);
    expect(block).not.toMatch(/notahex/);
    expect(block).toMatch(/Hero image on top/);
    expect(block).toMatch(/Bold uppercase headline/);
  });
  it('lists project media descriptions and the logo when present', () => {
    const block = buildReferenceStyleBlock(valid, ['A cream mid-rise tower'], 'https://x/logo.png');
    expect(block).toMatch(/A cream mid-rise tower/);
    expect(block).toMatch(/logo/i);
    expect(block).toMatch(/https:\/\/x\/logo\.png/);
  });
  it('omits the media/logo lines when absent', () => {
    const block = buildReferenceStyleBlock(valid, [], null);
    expect(block).not.toMatch(/Depict THIS project, per/);
    expect(block).not.toMatch(/Include the brand logo/);
  });
});

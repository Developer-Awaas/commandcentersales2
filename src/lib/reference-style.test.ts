import { describe, it, expect } from 'vitest';
import { isValidReferenceAnalysis, sanitizePalette, buildReferenceStyleBlock, referenceMode, type ReferenceAnalysis } from './reference-style';

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

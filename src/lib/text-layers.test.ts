import { describe, it, expect } from 'vitest';
import { buildDefaultLayers, layerType, isImageLayer, isVisible, layerAlpha, type TextLayer } from './text-layers';

const mk = (o: Partial<TextLayer>): TextLayer =>
  ({ id: 'x', text: '', xPct: 0, yPct: 0, fontSizePx: 0, fontWeight: 'normal', color: '#000', align: 'left', ...o });

describe('layer model (RB-P5 back-compat + predicates)', () => {
  it('layerType: explicit type wins; legacy kind:logo ⇒ image; default text', () => {
    expect(layerType(mk({ type: 'image' }))).toBe('image');
    expect(layerType(mk({ kind: 'logo' }))).toBe('image');       // old creatives still load as image
    expect(layerType(mk({}))).toBe('text');
    expect(layerType(mk({ text: 'hi' }))).toBe('text');
  });

  it('isImageLayer covers both new type:image and legacy kind:logo', () => {
    expect(isImageLayer(mk({ type: 'image' }))).toBe(true);
    expect(isImageLayer(mk({ kind: 'logo' }))).toBe(true);
    expect(isImageLayer(mk({ text: 'hi' }))).toBe(false);
  });

  it('isVisible excludes unplaced suggestions AND hidden layers', () => {
    expect(isVisible(mk({ text: 'a' }))).toBe(true);
    expect(isVisible(mk({ placed: false }))).toBe(false);
    expect(isVisible(mk({ hidden: true }))).toBe(false);
  });

  it('layerAlpha: absent = 1, clamps 5..100 → 0.05..1', () => {
    expect(layerAlpha(mk({}))).toBe(1);
    expect(layerAlpha(mk({ opacity: 40 }))).toBeCloseTo(0.4, 6);
    expect(layerAlpha(mk({ opacity: 0 }))).toBeCloseTo(0.05, 6);  // clamped up to 5%
    expect(layerAlpha(mk({ opacity: 250 }))).toBe(1);              // clamped down to 100%
  });
});



describe('buildDefaultLayers', () => {
  it('produces one layer per populated ad-copy field', () => {
    const layers = buildDefaultLayers('feed', {
      headline: 'Only 4 Premium 2BHK Units Left',
      primaryText: '₹75 Lakhs | Nayapali, Bhubaneswar',
      cta: 'View Availability',
    });
    expect(layers).toHaveLength(3);
    expect(layers.map((l) => l.text)).toEqual([
      'Only 4 Premium 2BHK Units Left',
      '₹75 Lakhs | Nayapali, Bhubaneswar',
      'View Availability  →',
    ]);
  });

  it('omits layers for missing ad-copy fields rather than emitting empty text', () => {
    const layers = buildDefaultLayers('feed', { headline: 'Headline only' });
    expect(layers).toHaveLength(1);
    expect(layers[0].text).toBe('Headline only');
  });

  it('returns no layers when ad copy is entirely empty', () => {
    expect(buildDefaultLayers('story', {})).toHaveLength(0);
  });

  it('positions the story layout headline higher and larger than feed/portrait', () => {
    const [storyHeadline] = buildDefaultLayers('story', { headline: 'Big reveal' });
    const [feedHeadline] = buildDefaultLayers('feed', { headline: 'Big reveal' });
    expect(storyHeadline.yPct).toBeLessThan(feedHeadline.yPct);
    expect(storyHeadline.fontSizePx).toBeGreaterThan(feedHeadline.fontSizePx);
  });

  it('gives the CTA a badge background by default so it reads as a button', () => {
    const layers = buildDefaultLayers('portrait', { cta: 'Enquire Now' });
    expect(layers[0].backgroundColor).toBeTruthy();
  });

  it('keeps every layer within the 0-100 percent coordinate space', () => {
    for (const layout of ['feed', 'portrait', 'story'] as const) {
      const layers = buildDefaultLayers(layout, {
        headline: 'H', primaryText: 'P', cta: 'C',
      });
      for (const layer of layers) {
        expect(layer.xPct).toBeGreaterThanOrEqual(0);
        expect(layer.xPct).toBeLessThanOrEqual(100);
        expect(layer.yPct).toBeGreaterThanOrEqual(0);
        expect(layer.yPct).toBeLessThanOrEqual(100);
      }
    }
  });
});

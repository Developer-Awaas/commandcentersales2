import { describe, it, expect } from 'vitest';
import { buildDefaultLayers } from './text-layers';

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

import { describe, it, expect } from 'vitest';
import { planPatch, colorVariance, type Rgb, type RingSamples } from './zone-patch';

const rep = (c: Rgb, n = 6): Rgb[] => Array.from({ length: n }, () => ({ ...c }));
const noisy = (n = 12): Rgb[] =>
  Array.from({ length: n }, (_, i) => ({ r: (i * 53) % 256, g: (i * 97) % 256, b: (i * 191) % 256 }));

const ring = (edge: Rgb, inside: Rgb[]): RingSamples =>
  ({ top: rep(edge), bottom: rep(edge), left: rep(edge), right: rep(edge), inside });

describe('colorVariance', () => {
  it('is ~0 for a uniform cloud and large for a noisy one', () => {
    expect(colorVariance(rep({ r: 100, g: 120, b: 140 }))).toBeLessThan(1);
    expect(colorVariance(noisy())).toBeGreaterThan(850);
  });
});

describe('planPatch', () => {
  it('skips a clean flat zone (inside matches a calm background)', () => {
    const c = { r: 200, g: 210, b: 220 };
    expect(planPatch(ring(c, rep(c))).mode).toBe('skip');
  });

  it('gradients when the background is calm but ghost detail sits inside', () => {
    const bg = { r: 200, g: 210, b: 220 };
    // Inside has dark "glyph" pixels mixed with bg ⇒ high inside variance, calm ring.
    const inside = [...rep(bg, 4), ...rep({ r: 20, g: 20, b: 20 }, 4)];
    expect(planPatch(ring(bg, inside)).mode).toBe('gradient');
  });

  it('chips when the surrounding background is busy (photo/detail)', () => {
    const s: RingSamples = { top: noisy(), bottom: noisy(), left: noisy(), right: noisy(), inside: noisy() };
    expect(planPatch(s).mode).toBe('chip');
  });

  it('derives the gradient from the top/bottom edges (sky lerp)', () => {
    const s: RingSamples = {
      top: rep({ r: 120, g: 170, b: 235 }),      // lighter sky up top
      bottom: rep({ r: 40, g: 90, b: 160 }),     // darker toward horizon
      left: rep({ r: 80, g: 130, b: 200 }),
      right: rep({ r: 80, g: 130, b: 200 }),
      inside: [...rep({ r: 80, g: 130, b: 200 }, 4), ...rep({ r: 10, g: 10, b: 10 }, 4)],
    };
    const plan = planPatch(s);
    expect(plan.mode).toBe('gradient');
    expect(plan.topColor.b).toBeGreaterThan(plan.bottomColor.b); // top lighter than bottom
  });
});

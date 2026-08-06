import { describe, it, expect } from 'vitest';
import { planPatch, colorVariance, decidePatches, bboxesIntersect, PATCH_AREA_CAP, GLOBAL_PATCH_CAP, type Rgb, type RingSamples, type ZoneRecord } from './zone-patch';

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

// STEP 5 — conservative policy verdicts, frozen from the real failing creative
// (0e2e2886, replayed offline). See scripts/replay-out/…/decisions_before.json.
const C: Rgb = { r: 80, g: 147, b: 190 };
const rec = (role: string, areaFrac: number, occupied: boolean, intersectsPhoto: boolean, baseMode: 'skip' | 'gradient' | 'chip'): ZoneRecord =>
  ({ role, areaFrac, occupied, intersectsPhoto, base: { mode: baseMode, topColor: C, bottomColor: C } });

describe('decidePatches — frozen from creative 0e2e2886 (the butchering case)', () => {
  // The exact 8 text-zone records that produced the blue slabs before the fix.
  const CREATIVE: ZoneRecord[] = [
    rec('headline', 0.084, true, false, 'skip'),
    rec('subheadline', 0.112, false, false, 'gradient'), // the 11.2% sky-slab
    rec('badge', 0.013, false, false, 'chip'),
    rec('badge', 0.012, false, false, 'chip'),
    rec('badge', 0.014, false, false, 'gradient'),
    rec('checklist', 0.0672, false, true, 'skip'),
    rec('cta', 0.015, true, false, 'chip'),
    rec('footer', 0.0275, true, false, 'chip'),
  ];

  it('never patches an unoccupied zone — the subheadline slab is skipped', () => {
    const { zones } = decidePatches(CREATIVE);
    expect(zones[1]).toMatchObject({ mode: 'skip', reason: 'unoccupied' }); // was gradient
    // every empty (unoccupied) zone → skip
    CREATIVE.forEach((r, i) => { if (!r.occupied) expect(zones[i].mode).toBe('skip'); });
  });

  it('chips the occupied cta/footer (busy bg) so their text stays legible', () => {
    const { zones } = decidePatches(CREATIVE);
    expect(zones[6].mode).toBe('chip');
    expect(zones[7].mode).toBe('chip');
  });

  it('collapses total patched area (only the 2 occupied chips survive)', () => {
    const { zones, globalPatchingDisabled } = decidePatches(CREATIVE);
    expect(zones.filter((z) => z.mode !== 'skip')).toHaveLength(2);
    expect(globalPatchingDisabled).toBe(false);
  });
});

describe('decidePatches — individual rules', () => {
  it('rule c: an occupied zone intersecting the photo is chipped, never painted', () => {
    const { zones } = decidePatches([rec('headline', 0.05, true, true, 'gradient')]);
    expect(zones[0]).toMatchObject({ mode: 'chip', reason: 'photo-intersect' });
  });

  it('rule b: an occupied zone over the area cap is chipped, never painted', () => {
    const { zones } = decidePatches([rec('headline', PATCH_AREA_CAP + 0.01, true, false, 'gradient')]);
    expect(zones[0]).toMatchObject({ mode: 'chip', reason: 'area-cap' });
  });

  it('an occupied, small, calm-bg zone gets a real gradient', () => {
    const { zones } = decidePatches([rec('headline', 0.05, true, false, 'gradient')]);
    expect(zones[0].mode).toBe('gradient');
  });

  it('rule e: total gradient area over the global cap ⇒ chips only + flag', () => {
    // 3 occupied small gradients each 0.4×cap ⇒ 1.2×cap total ⇒ all demoted to chip.
    const a = GLOBAL_PATCH_CAP * 0.4;
    const many = [rec('a', a, true, false, 'gradient'), rec('b', a, true, false, 'gradient'), rec('c', a, true, false, 'gradient')];
    const { zones, globalPatchingDisabled } = decidePatches(many);
    expect(globalPatchingDisabled).toBe(true);
    expect(zones.every((z) => z.mode === 'chip' && z.reason === 'global-failsafe')).toBe(true);
  });
});

describe('bboxesIntersect', () => {
  it('detects overlap and disjoint boxes', () => {
    expect(bboxesIntersect([0, 0, 0.5, 0.5], [0.4, 0.4, 0.5, 0.5])).toBe(true);
    expect(bboxesIntersect([0, 0, 0.3, 0.3], [0.5, 0.5, 0.3, 0.3])).toBe(false);
  });
});

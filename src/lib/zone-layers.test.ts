import { describe, it, expect } from 'vitest';
import { anchorXPct, fontPxForZone, refHeightFor, buildLayersFromZones, logoZone, fitBodyText, ellipsizeAtBoundary, estimateLines, pickZoneForChip } from './zone-layers';
import type { ReferenceZone } from './reference-style';

const z = (role: ReferenceZone['role'], bbox: [number, number, number, number], align: ReferenceZone['align'] = 'left', fontScale = 0.05): ReferenceZone =>
  ({ role, bbox, align, fontScale, weight: 'bold', color: '#fff' });

describe('anchorXPct', () => {
  it('anchors by align: left=x, center=x+w/2, right=x+w', () => {
    const b: [number, number, number, number] = [0.1, 0.2, 0.6, 0.1];
    expect(anchorXPct(b, 'left')).toBeCloseTo(10);
    expect(anchorXPct(b, 'center')).toBeCloseTo(40);
    expect(anchorXPct(b, 'right')).toBeCloseTo(70);
  });
});

describe('Fix 4 — copy fits without mid-phrase truncation', () => {
  // The exact failing class from live review: body copy overflowing a small zone.
  const copy = '62 homes with 3-bedroom and 4-bedroom configurations across two towers';

  it('ellipsizeAtBoundary never cuts mid-word and ends with …', () => {
    const out = ellipsizeAtBoundary(copy, 24);
    expect(out.endsWith('…')).toBe(true);
    const body = out.slice(0, -1).trimEnd();
    // The kept text must be a whole-word prefix of the original (no partial word).
    expect(copy.startsWith(body)).toBe(true);
    expect(copy[body.length] === undefined || copy[body.length] === ' ').toBe(true);
    expect(out).not.toMatch(/3-bedroo…|bedroo…|configuratio…/); // no mid-word cut
  });

  it('step-down keeps full copy when the box can hold it (no overflow flag)', () => {
    // Generous box: 90% width, 30% of a tall canvas → font steps down, text intact.
    const fit = fitBodyText(copy, 0.9, 0.3, 1920, 60);
    expect(fit.overflow).toBe(false);
    expect(fit.text).toBe(copy);
    expect(fit.fontSizePx).toBeGreaterThanOrEqual(14);
  });

  it('tiny box → shortens at a boundary and flags overflow', () => {
    const fit = fitBodyText(copy, 0.2, 0.03, 1080, 40);
    expect(fit.overflow).toBe(true);
    expect(fit.text.endsWith('…')).toBe(true);
    expect(copy.startsWith(fit.text.slice(0, -1).trimEnd())).toBe(true); // whole-word prefix
    expect(fit.fontSizePx).toBe(14);
  });

  it('buildLayersFromZones flags the overflowing subheadline layer', () => {
    const zones: ReferenceZone[] = [z('subheadline', [0.05, 0.85, 0.2, 0.03], 'left')];
    const layers = buildLayersFromZones(zones, { subheadline: copy }, { refHeight: refHeightFor(1080, 1080) });
    expect(layers).toHaveLength(1);
    expect(layers[0].overflow).toBe(true);
    expect(layers[0].text.endsWith('…')).toBe(true);
  });

  it('estimateLines grows as the box narrows', () => {
    expect(estimateLines(copy, 40, 200)).toBeGreaterThan(estimateLines(copy, 40, 1000));
  });
});

describe('fontPxForZone', () => {
  it('scales with box height and reference height', () => {
    expect(fontPxForZone(0.1, 1620)).toBeGreaterThan(fontPxForZone(0.05, 1620));
    expect(fontPxForZone(0.1, 1620)).toBeGreaterThan(fontPxForZone(0.1, 1080));
  });
  it('splits the budget across stacked lines', () => {
    expect(fontPxForZone(0.2, 1620, 5)).toBeLessThan(fontPxForZone(0.2, 1620, 1));
  });
  it('never returns below the 14px floor', () => {
    expect(fontPxForZone(0.001, 100)).toBe(14);
  });
});

describe('refHeightFor', () => {
  it('is 1080 for square and taller for portrait', () => {
    expect(refHeightFor(1024, 1024)).toBe(1080);
    expect(refHeightFor(1024, 1536)).toBe(1620);
  });
});

describe('buildLayersFromZones', () => {
  const opts = { refHeight: 1620 };
  it('emits one layer per single-text zone and skips logo/photo/other', () => {
    const zones = [z('headline', [0.1, 0.1, 0.8, 0.1]), z('price', [0.1, 0.25, 0.4, 0.05]),
      z('logo', [0.4, 0.02, 0.2, 0.06]), z('photo', [0, 0.4, 1, 0.5]), z('other', [0.8, 0.9, 0.1, 0.05])];
    const layers = buildLayersFromZones(zones, { headline: 'H', price: 'P' }, opts);
    expect(layers.map((l) => l.text)).toEqual(['H', 'P']);
  });
  it('consumes badges in order, one per badge zone', () => {
    const zones = [z('badge', [0.05, 0.5, 0.25, 0.06], 'center'), z('badge', [0.375, 0.5, 0.25, 0.06], 'center'), z('badge', [0.7, 0.5, 0.25, 0.06], 'center')];
    const layers = buildLayersFromZones(zones, { badges: ['A', 'B', 'C'] }, opts);
    expect(layers.map((l) => l.text)).toEqual(['A', 'B', 'C']);
  });
  it('expands a checklist zone to one layer per item, stacked downward', () => {
    const zones = [z('checklist', [0.05, 0.4, 0.4, 0.2])];
    const layers = buildLayersFromZones(zones, { checklist: ['one', 'two', 'three'] }, opts);
    expect(layers).toHaveLength(3);
    expect(layers[0].text).toContain('one');
    expect(layers[1].yPct).toBeGreaterThan(layers[0].yPct);
    expect(layers[2].yPct).toBeGreaterThan(layers[1].yPct);
  });
  it('gives the CTA a badge background so it reads as a button', () => {
    const layers = buildLayersFromZones([z('cta', [0.1, 0.9, 0.3, 0.06])], { cta: 'Book' }, opts);
    expect(layers[0].backgroundColor).toBeTruthy();
  });
  it('positions a left-aligned layer at the box left edge', () => {
    const layers = buildLayersFromZones([z('headline', [0.2, 0.1, 0.6, 0.1], 'left')], { headline: 'H' }, opts);
    expect(layers[0].xPct).toBeCloseTo(20);
    expect(layers[0].widthPct).toBeCloseTo(60);
  });
  it('FIX 3 — auto-places name/headline/price/cta/footer, leaves details unplaced', () => {
    const zones = [
      z('headline', [0.1, 0.1, 0.8, 0.1]), z('price', [0.1, 0.25, 0.4, 0.05]),
      z('cta', [0.1, 0.9, 0.3, 0.06]), z('footer', [0.05, 0.95, 0.9, 0.04]),
      z('subheadline', [0.1, 0.2, 0.8, 0.05]),
      z('badge', [0.05, 0.5, 0.25, 0.06]),
      z('checklist', [0.05, 0.6, 0.4, 0.2]),
    ];
    const copy = { headline: 'H', price: 'P', cta: 'Book', footer: 'call us', subheadline: 'body', badges: ['A'], checklist: ['x', 'y'] };
    const layers = buildLayersFromZones(zones, copy, opts);
    const placed = (t: string) => layers.filter((l) => l.text.includes(t)).every((l) => l.placed !== false);
    const unplaced = (t: string) => layers.filter((l) => l.text.includes(t)).every((l) => l.placed === false);
    expect(placed('H') && placed('P') && placed('Book') && placed('call us')).toBe(true);
    expect(unplaced('body') && unplaced('A') && unplaced('x') && unplaced('y')).toBe(true);
  });

  it('FIX 3 — no layer carries the old dark scrim backing on body text', () => {
    const layers = buildLayersFromZones([z('headline', [0.1, 0.1, 0.8, 0.1]), z('price', [0.1, 0.3, 0.4, 0.06])], { headline: 'H', price: 'P' }, opts);
    expect(layers.every((l) => !l.backgroundColor)).toBe(true); // scrim removed (FIX 2)
  });

  it('produces JSON-serializable layers (persistence round-trip is lossless)', () => {
    const layers = buildLayersFromZones([z('headline', [0.1, 0.1, 0.8, 0.1]), z('cta', [0.1, 0.9, 0.3, 0.06])], { headline: 'H', cta: 'Book' }, opts);
    expect(JSON.parse(JSON.stringify(layers))).toEqual(layers);
  });
});

describe('RB-P8 — zone-anchored suggestion chips', () => {
  const opts = { refHeight: 1620 };

  it('pickZoneForChip: top-large→headline, footer→contact, bottom-non-contact→location', () => {
    const zones = [z('headline', [0.1, 0.05, 0.8, 0.12]), z('price', [0.1, 0.4, 0.4, 0.06]), z('footer', [0.05, 0.92, 0.9, 0.05])];
    expect(pickZoneForChip('headline', zones, new Set())).toBe(0); // top + largest area
    expect(pickZoneForChip('contact', zones, new Set())).toBe(2);  // the footer zone
    expect(pickZoneForChip('location', zones, new Set())).toBe(1); // bottom-most non-footer/cta text zone
    expect(pickZoneForChip('price', zones, new Set([0, 1, 2]))).toBe(-1); // nothing free
  });

  it('adds a location chip (placed:false) anchored to an unclaimed zone', () => {
    // headline gets claimed; the empty subheadline zone (no copy) stays free for location.
    const zones = [z('headline', [0.1, 0.05, 0.8, 0.1]), z('subheadline', [0.08, 0.82, 0.6, 0.05])];
    const layers = buildLayersFromZones(zones, { headline: 'Grand Mark', location: 'Patia, Bhubaneswar' }, opts);
    const loc = layers.find((l) => l.text === 'Patia, Bhubaneswar');
    expect(loc).toBeTruthy();
    expect(loc!.placed).toBe(false);
    expect(loc!.yPct).toBeGreaterThan(70); // anchored to the bottom subheadline zone, not the top headline
  });

  it('location falls back to a bottom default position when no zone is free', () => {
    const layers = buildLayersFromZones([z('headline', [0.1, 0.05, 0.8, 0.1])], { headline: 'H', location: 'Patia' }, opts);
    const loc = layers.find((l) => l.text === 'Patia');
    expect(loc?.placed).toBe(false);
    expect(loc!.yPct).toBeGreaterThan(70); // FALLBACK_BBOX.location ≈ 80%
  });

  it('never duplicates an essential the zone loop already placed (even when ellipsized)', () => {
    const long = 'A very long headline that will be shortened to fit a tiny zone box neatly';
    const layers = buildLayersFromZones([z('headline', [0.05, 0.05, 0.2, 0.03])], { headline: long }, opts);
    // Exactly one headline layer — no duplicate full-text chip from the ensure-pass.
    expect(layers).toHaveLength(1);
  });
});

describe('logoZone', () => {
  it('returns the first logo zone or null', () => {
    expect(logoZone([z('headline', [0, 0, 1, 0.1]), z('logo', [0.4, 0.02, 0.2, 0.06])])?.role).toBe('logo');
    expect(logoZone([z('headline', [0, 0, 1, 0.1])])).toBeNull();
  });
});

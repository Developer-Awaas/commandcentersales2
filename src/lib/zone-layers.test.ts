import { describe, it, expect } from 'vitest';
import { anchorXPct, fontPxForZone, refHeightFor, buildLayersFromZones, logoZone } from './zone-layers';
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
  it('produces JSON-serializable layers (persistence round-trip is lossless)', () => {
    const layers = buildLayersFromZones([z('headline', [0.1, 0.1, 0.8, 0.1]), z('cta', [0.1, 0.9, 0.3, 0.06])], { headline: 'H', cta: 'Book' }, opts);
    expect(JSON.parse(JSON.stringify(layers))).toEqual(layers);
  });
});

describe('logoZone', () => {
  it('returns the first logo zone or null', () => {
    expect(logoZone([z('headline', [0, 0, 1, 0.1]), z('logo', [0.4, 0.02, 0.2, 0.06])])?.role).toBe('logo');
    expect(logoZone([z('headline', [0, 0, 1, 0.1])])).toBeNull();
  });
});

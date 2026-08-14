import { describe, it, expect } from 'vitest';
import { isValidReferenceAnalysis, sanitizePalette, buildReferenceStyleBlock, referenceMode, isValidReferenceZone, clampBbox, dedupeZones, orderPhotoPanels, isValidPhotoPanel, primaryPanelIndex, buildDefaultSlots, unresolvedPanels, slotsResolved, slotMediaInOrder, panelTileScore, autoMatchSlots, replicateCaptionState, type ReferenceAnalysis, type ReferenceZone, type PhotoPanel, type MediaTile } from './reference-style';

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

// ---------------------------------------------------------------------------
// V5 — photo-panel detection + per-panel assignment.
//
// The behaviour under test is the one RB-P10 STEP 3 proved the MODEL will not
// honour on its own: with no image left for a photo section it invented a
// plausible amenity photo instead of emptying the block. V5 makes each
// section's fate explicit, so these tests pin the ordering, the slot state
// machine, and the payload/directive agreement that make that possible.
// ---------------------------------------------------------------------------
describe('photo panels — ordering and validation', () => {
  const panel = (bbox: [number, number, number, number], extra: Partial<PhotoPanel> = {}): PhotoPanel => ({
    index: 0, bbox, shapeHint: 'rect', approxArea: bbox[2] * bbox[3], ...extra,
  });

  it('orders reading-order: top-left → bottom-right, re-indexing from 1', () => {
    const ordered = orderPhotoPanels([
      panel([0.6, 0.7, 0.3, 0.2]),  // bottom-right
      panel([0.1, 0.1, 0.5, 0.3]),  // top-left
      panel([0.1, 0.7, 0.3, 0.2]),  // bottom-left
    ]);
    expect(ordered.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(ordered[0].bbox[1]).toBeCloseTo(0.1);
    expect(ordered[1].bbox[0]).toBeCloseTo(0.1);
    expect(ordered[2].bbox[0]).toBeCloseTo(0.6);
  });

  it('treats a small vertical offset as the SAME row and sorts by x', () => {
    // Without the row tolerance these would number top-to-bottom, and the
    // badges would disagree with how a human reads the ad.
    const ordered = orderPhotoPanels([
      panel([0.55, 0.42, 0.3, 0.2]),
      panel([0.10, 0.40, 0.3, 0.2]),
    ]);
    expect(ordered[0].bbox[0]).toBeCloseTo(0.10);
    expect(ordered[1].bbox[0]).toBeCloseTo(0.55);
  });

  it('rejects a panel with a bad shape hint but keeps valid siblings', () => {
    expect(isValidPhotoPanel(panel([0, 0, 1, 1]))).toBe(true);
    expect(isValidPhotoPanel({ ...panel([0, 0, 1, 1]), shapeHint: 'blob' })).toBe(false);
    expect(isValidPhotoPanel({ bbox: [0, 0, 1], shapeHint: 'rect' })).toBe(false);
  });

  it('picks the tagged building panel as primary, not merely the largest', () => {
    const panels = orderPhotoPanels([
      panel([0.0, 0.0, 1.0, 0.5], { approxArea: 0.5 }),
      panel([0.1, 0.6, 0.2, 0.2], { approxArea: 0.04, isBuilding: true }),
    ]);
    const primary = primaryPanelIndex(panels);
    expect(panels.find((p) => p.index === primary)?.isBuilding).toBe(true);
  });
});

describe('panel slots — the Generate gate', () => {
  const panels = orderPhotoPanels([
    { index: 0, bbox: [0, 0, 1, 0.5], shapeHint: 'rect', approxArea: 0.5, isBuilding: true },
    { index: 0, bbox: [0, 0.6, 0.4, 0.2], shapeHint: 'circle', approxArea: 0.08 },
    { index: 0, bbox: [0.5, 0.6, 0.4, 0.2], shapeHint: 'wedge', approxArea: 0.08 },
  ]);

  it('auto-binds the hero to the building panel and leaves the rest unassigned', () => {
    const slots = buildDefaultSlots(panels);
    expect(slots.filter((s) => s.source === 'hero')).toHaveLength(1);
    expect(slots.find((s) => s.source === 'hero')?.panelIndex).toBe(1);
    expect(unresolvedPanels(slots)).toEqual([2, 3]);
    expect(slotsResolved(slots)).toBe(false);
  });

  it('counts an explicit "leave empty" as resolved — it is a real choice', () => {
    const slots = buildDefaultSlots(panels).map((s) =>
      s.source === 'unassigned' ? { ...s, source: 'empty' as const } : s);
    expect(slotsResolved(slots)).toBe(true);
    expect(unresolvedPanels(slots)).toEqual([]);
  });

  it('treats a media slot with no url as still unresolved', () => {
    const slots = buildDefaultSlots(panels).map((s) =>
      s.panelIndex === 2 ? { ...s, source: 'media' as const } : s);
    expect(unresolvedPanels(slots)).toContain(2);
  });

  it('emits media in panel order, excluding hero and empty slots', () => {
    // This ordering IS the contract with the directive's "section N → IMAGE k"
    // mapping — if it drifts, images land in the wrong sections silently.
    const slots = [
      { panelIndex: 3, source: 'media' as const, mediaUrl: 'https://x/three.png' },
      { panelIndex: 1, source: 'hero' as const },
      { panelIndex: 2, source: 'empty' as const },
    ];
    expect(slotMediaInOrder(slots)).toEqual(['https://x/three.png']);

    const both = [
      { panelIndex: 3, source: 'media' as const, mediaUrl: 'https://x/three.png' },
      { panelIndex: 2, source: 'media' as const, mediaUrl: 'https://x/two.png' },
      { panelIndex: 1, source: 'hero' as const },
    ];
    expect(slotMediaInOrder(both)).toEqual(['https://x/two.png', 'https://x/three.png']);
  });
});

describe('label auto-match (P2.13)', () => {
  const panel = (index: number, contentHint?: string, isBuilding = false): PhotoPanel => ({
    index,
    bbox: [0.1 * index, 0.1 * index, 0.2, 0.2],
    shapeHint: 'rect',
    approxArea: 0.04,
    isBuilding,
    contentHint,
  });
  const tile = (id: string, assetType: string): MediaTile => ({ id, url: `https://x/${id}.png`, assetType });

  it('scores a hint against the asset_type it describes, and only that one', () => {
    expect(panelTileScore(panel(2, 'swimming pool'), 'amenity_pool')).toBeGreaterThan(0);
    expect(panelTileScore(panel(2, 'swimming pool'), 'amenity_gym')).toBe(0);
    expect(panelTileScore(panel(2, 'modular kitchen'), 'interior_kitchen')).toBeGreaterThan(0);
  });

  it('scores 0 when the hint is missing or uninformative', () => {
    // The vision pass is told to fall back to "photo" when it cannot tell.
    expect(panelTileScore(panel(2, undefined), 'amenity_pool')).toBe(0);
    expect(panelTileScore(panel(2, 'photo'), 'amenity_pool')).toBe(0);
  });

  it('binds each section to the photo that matches it, not to picker order', () => {
    // Tiles are deliberately supplied in the WRONG order for a positional fill:
    // order-based assignment would put the gym in the pool's section.
    const panels = [panel(1, 'building exterior', true), panel(2, 'swimming pool'), panel(3, 'gym')];
    const tiles = [tile('gym', 'amenity_gym'), tile('pool', 'amenity_pool')];
    const slots = autoMatchSlots(panels, tiles, null, []);
    expect(slots.find((s) => s.panelIndex === 1)?.source).toBe('hero');
    expect(slots.find((s) => s.panelIndex === 2)?.mediaUrl).toBe('https://x/pool.png');
    expect(slots.find((s) => s.panelIndex === 3)?.mediaUrl).toBe('https://x/gym.png');
  });

  it('leaves a section unassigned rather than filling it with a leftover', () => {
    // The whole point of the gate: a decided-looking slot must mean someone
    // decided it. A wrong-but-plausible binding is the RB-P10 failure again.
    const panels = [panel(1, 'building exterior', true), panel(2, 'swimming pool'), panel(3, 'kids play area')];
    const slots = autoMatchSlots(panels, [tile('pool', 'amenity_pool')], null, []);
    expect(slots.find((s) => s.panelIndex === 3)?.source).toBe('unassigned');
    expect(unresolvedPanels(slots)).toEqual([3]);
  });

  it('never reuses one photo for two sections', () => {
    const panels = [panel(1, 'building exterior', true), panel(2, 'swimming pool'), panel(3, 'pool deck')];
    const slots = autoMatchSlots(panels, [tile('pool', 'amenity_pool')], null, []);
    const used = slots.filter((s) => s.source === 'media').map((s) => s.mediaUrl);
    expect(new Set(used).size).toBe(used.length);
  });

  it('never overwrites a choice the user already made', () => {
    const panels = [panel(1, 'building exterior', true), panel(2, 'swimming pool')];
    const prior = [
      { panelIndex: 1, source: 'hero' as const },
      { panelIndex: 2, source: 'empty' as const },
    ];
    const slots = autoMatchSlots(panels, [tile('pool', 'amenity_pool')], null, prior);
    expect(slots.find((s) => s.panelIndex === 2)?.source).toBe('empty');
  });
});

describe('replicateCaptionState (P2.13 PART B)', () => {
  const p = (index: number): PhotoPanel => ({ index, bbox: [0, 0, 0.2, 0.2], shapeHint: 'rect', approxArea: 0.04 });

  it('is pending while detecting, and before any analysis has run', () => {
    expect(replicateCaptionState(undefined, false)).toBe('pending');
    expect(replicateCaptionState([p(1), p(2)], true)).toBe('pending');
  });

  it('distinguishes "not analysed yet" from "analysed, found nothing"', () => {
    // The whole reason the two are separate: guessing 'single' pre-analysis
    // shows the hero-only promise to someone whose reference has four panels.
    expect(replicateCaptionState(undefined, false)).toBe('pending');
    expect(replicateCaptionState([], false)).toBe('single');
  });

  it('treats zero and one panel as the hero-only case', () => {
    expect(replicateCaptionState([], false)).toBe('single');
    expect(replicateCaptionState([p(1)], false)).toBe('single');
  });

  it('only promises section assignment at two or more panels', () => {
    expect(replicateCaptionState([p(1), p(2)], false)).toBe('multi');
    expect(replicateCaptionState([p(1), p(2), p(3)], false)).toBe('multi');
  });
});

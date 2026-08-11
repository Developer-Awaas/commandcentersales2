import { describe, it, expect } from 'vitest';
import { buildingAngleDirective, buildPhotoReplacementDirective, buildReplicateLayoutPrompt, buildReplicatePrompt, buildPanelAssignmentDirective } from './senior-designer-prompts';
import { orderPhotoPanels, type PhotoPanel } from './reference-style';

describe('RB-P9 — two-tier building-angle policy', () => {
  it('1 view → ANGLE-LOCK (exact viewpoint, never invent unseen sides)', () => {
    const d = buildingAngleDirective(1);
    expect(d).toMatch(/ANGLE-LOCK/);
    expect(d).toMatch(/EXACT viewpoint/i);
    expect(d).toMatch(/IMAGE 2/);
    expect(d).not.toMatch(/VIEW-BOUNDED/);
  });

  it('2+ views → VIEW-BOUNDED (pick best-fit, never blend, never invent), robust to mixed media', () => {
    const d = buildingAngleDirective(3);
    expect(d).toMatch(/VIEW-BOUNDED/);
    expect(d).toMatch(/IMAGE 2 is the building/);
    expect(d).toMatch(/additional exterior views/i); // doesn't claim ALL images are the building
    expect(d).toMatch(/best fits/i);
    expect(d).toMatch(/do not blend/i);
    expect(d).toMatch(/never invent/i);
  });

  it('replace-all-photography directive: never retain image-1 imagery, run-out → emptied blocks', () => {
    const d = buildPhotoReplacementDirective();
    expect(d).toMatch(/REPLACE ALL PHOTOGRAPHY/);
    expect(d).toMatch(/NEVER retain/i);
    expect(d).toMatch(/person|face|human/i);
    expect(d).toMatch(/EMPTIED design blocks/i);
    // both directives embed it
    expect(buildReplicateLayoutPrompt(1)).toMatch(/REPLACE ALL PHOTOGRAPHY/);
    expect(buildReplicatePrompt({ headline: 'H' }, 1)).toMatch(/REPLACE ALL PHOTOGRAPHY/);
  });

  it('AI copy map carries subheadline/contact/amenities and dissolves uncopied zones', () => {
    const p = buildReplicatePrompt({ headline: 'H', subheadline: 'Sub', contact: '+91 98x', amenities: ['Pool', 'Gym'] }, 1);
    expect(p).toMatch(/"Sub"/);
    expect(p).toMatch(/"\+91 98x"/);
    expect(p).toMatch(/"Pool", "Gym"/);
    expect(p).toMatch(/DISSOLVE it/); // AI empty rule: remove uncopied containers
  });

  it('both replicate directives embed the angle policy and switch on view count', () => {
    expect(buildReplicateLayoutPrompt(1)).toMatch(/ANGLE-LOCK/);
    expect(buildReplicateLayoutPrompt(3)).toMatch(/VIEW-BOUNDED/);
    expect(buildReplicatePrompt({ headline: 'H' }, 1)).toMatch(/ANGLE-LOCK/);
    expect(buildReplicatePrompt({ headline: 'H' }, 2)).toMatch(/VIEW-BOUNDED/);
    // default (no count) is the safe angle-lock
    expect(buildReplicateLayoutPrompt()).toMatch(/ANGLE-LOCK/);
  });

  it('AI directive still enforces copy integrity + exact strings', () => {
    const p = buildReplicatePrompt({ headline: 'Grand Mark', location: 'Patia' }, 2);
    expect(p).toMatch(/COPY INTEGRITY/);
    expect(p).toMatch(/"Grand Mark"/);
    expect(p).toMatch(/"Patia"/);
  });
});

// ---------------------------------------------------------------------------
// V5 — explicit per-panel assignment directive.
//
// The image numbering here is a CONTRACT with the payload built by
// slotMediaInOrder(): IMAGE 1 = layout ref, IMAGE 2 = hero, then slot-ordered
// media from IMAGE 3. If these drift apart, images silently land in the wrong
// photo sections and nothing errors.
// ---------------------------------------------------------------------------
describe('buildPanelAssignmentDirective', () => {
  const panels: PhotoPanel[] = orderPhotoPanels([
    { index: 0, bbox: [0, 0, 1, 0.5], shapeHint: 'rect', approxArea: 0.5, isBuilding: true },
    { index: 0, bbox: [0, 0.6, 0.4, 0.2], shapeHint: 'circle', approxArea: 0.08 },
    { index: 0, bbox: [0.5, 0.6, 0.4, 0.2], shapeHint: 'wedge', approxArea: 0.08 },
  ]);

  it('numbers images to match the slot-ordered payload', () => {
    const out = buildPanelAssignmentDirective(panels, [
      { panelIndex: 1, source: 'hero' },
      { panelIndex: 2, source: 'media', mediaUrl: 'https://x/a.png' },
      { panelIndex: 3, source: 'media', mediaUrl: 'https://x/b.png' },
    ]);
    expect(out).toMatch(/photo section 1 .*→ IMAGE 2 \(the building\)/);
    expect(out).toMatch(/photo section 2 .*→ IMAGE 3/);
    expect(out).toMatch(/photo section 3 .*→ IMAGE 4/);
  });

  it('does not consume an image number for an empty section', () => {
    // Section 2 empty must NOT shift section 3 to IMAGE 4 — the payload only
    // carries the media that was actually assigned.
    const out = buildPanelAssignmentDirective(panels, [
      { panelIndex: 1, source: 'hero' },
      { panelIndex: 2, source: 'empty' },
      { panelIndex: 3, source: 'media', mediaUrl: 'https://x/b.png' },
    ]);
    expect(out).toMatch(/photo section 3 .*→ IMAGE 3/);
    expect(out).not.toMatch(/IMAGE 4/);
  });

  it('states the empty rule as a hard requirement, not a preference', () => {
    // RB-P10's soft run-out rule is exactly what the model ignored.
    const out = buildPanelAssignmentDirective(panels, [
      { panelIndex: 1, source: 'hero' },
      { panelIndex: 2, source: 'empty' },
      { panelIndex: 3, source: 'empty' },
    ]);
    expect(out).toMatch(/sections #2, #3 are marked EMPTY/);
    expect(out).toMatch(/do NOT invent, generate, imagine, or substitute ANY photograph/);
    expect(out).toMatch(/hard requirement, not a preference/);
  });

  it('treats an unassigned slot as empty rather than inventing a photo', () => {
    const out = buildPanelAssignmentDirective(panels, [{ panelIndex: 1, source: 'hero' }]);
    expect(out).toMatch(/photo section 2 .*→ EMPTY/);
    expect(out).toMatch(/photo section 3 .*→ EMPTY/);
  });

  it('replaces the generic photo-replacement rule inside the replicate prompt', () => {
    const withAssignment = buildReplicatePrompt({ headline: 'X' }, 1, {
      panels,
      slots: [{ panelIndex: 1, source: 'hero' }, { panelIndex: 2, source: 'empty' }, { panelIndex: 3, source: 'empty' }],
    });
    expect(withAssignment).toMatch(/PHOTO SECTION ASSIGNMENT/);
    expect(withAssignment).not.toMatch(/If the provided images run out/);

    const without = buildReplicatePrompt({ headline: 'X' }, 1);
    expect(without).toMatch(/REPLACE ALL PHOTOGRAPHY/);
    expect(without).not.toMatch(/PHOTO SECTION ASSIGNMENT/);
  });
});

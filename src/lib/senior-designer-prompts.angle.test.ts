import { describe, it, expect } from 'vitest';
import { buildingAngleDirective, buildPhotoReplacementDirective, buildReplicateLayoutPrompt, buildReplicatePrompt } from './senior-designer-prompts';

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

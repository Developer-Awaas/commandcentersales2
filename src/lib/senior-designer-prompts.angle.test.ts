import { describe, it, expect } from 'vitest';
import { buildingAngleDirective, buildReplicateLayoutPrompt, buildReplicatePrompt } from './senior-designer-prompts';

describe('RB-P9 — two-tier building-angle policy', () => {
  it('1 view → ANGLE-LOCK (exact viewpoint, never invent unseen sides)', () => {
    const d = buildingAngleDirective(1);
    expect(d).toMatch(/ANGLE-LOCK/);
    expect(d).toMatch(/EXACT viewpoint/i);
    expect(d).toMatch(/IMAGE 2/);
    expect(d).not.toMatch(/VIEW-BOUNDED/);
  });

  it('2+ views → VIEW-BOUNDED (pick best-fit, never blend, never invent), labels 2..N', () => {
    const d3 = buildingAngleDirective(3); // hero + 2 extra → IMAGES 2..4
    expect(d3).toMatch(/VIEW-BOUNDED/);
    expect(d3).toMatch(/IMAGES 2 through 4/);
    expect(d3).toMatch(/best fits/i);
    expect(d3).toMatch(/do not blend/i);
    expect(d3).toMatch(/never invent/i);

    const d2 = buildingAngleDirective(2); // hero + 1 extra → IMAGES 2..3
    expect(d2).toMatch(/IMAGES 2 through 3/);
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

import { describe, it, expect } from 'vitest';
import { nearestAspect } from './reference-edit';

describe('nearestAspect', () => {
  it('snaps square to 1:1', () => {
    expect(nearestAspect(1080, 1080)).toBe('1:1');
    expect(nearestAspect(1024, 1024)).toBe('1:1');
  });
  it('snaps 4:5 portrait feed', () => {
    expect(nearestAspect(1080, 1350)).toBe('4:5');
  });
  it('snaps tall story to 9:16', () => {
    expect(nearestAspect(1080, 1920)).toBe('9:16');
    expect(nearestAspect(1024, 1536)).toBe('9:16'); // r=0.667 → nearer 9:16 (0.104) than 4:5 (0.133)
  });
  it('picks the closest of the three, not exact', () => {
    // 2:3 (0.667) is between 4:5 (0.8) and 9:16 (0.5625) — nearer 9:16 by 0.104 vs 0.133
    expect(nearestAspect(1000, 1500)).toBe('9:16');
    // slightly-wide landscape falls back toward 1:1 (nearest of the three)
    expect(nearestAspect(1600, 900)).toBe('1:1');
  });
  it('fails safe to 1:1 on bad dimensions', () => {
    expect(nearestAspect(0, 0)).toBe('1:1');
    expect(nearestAspect(-5, 10)).toBe('1:1');
  });
});

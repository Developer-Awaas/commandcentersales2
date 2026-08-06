import { describe, it, expect } from 'vitest';
import { resolveHeroRef, toHeroImageRef } from './gemini-service';

// Fix 1 regression: replicate (and normal) generation must use EXACTLY the
// asset the user flagged ★ Hero at generate-click time, not a hardcoded
// hero_exterior fallback. Toggling the flag must swap the payload's hero.
describe('resolveHeroRef — flagged hero drives the payload', () => {
  const refs = [
    { id: 'brown', base64: '', mimeType: '', preview_url: 'https://x/brown-hero-exterior.jpg' },
    { id: 'white', base64: '', mimeType: '', preview_url: 'https://x/white-building.jpg' },
  ];

  it('resolves the flagged asset (white), not the first/hero_exterior (brown)', () => {
    expect(resolveHeroRef(refs, 'white')).toEqual({ url: 'https://x/white-building.jpg' });
  });

  it('toggling the flag to the other asset swaps the payload hero', () => {
    expect(resolveHeroRef(refs, 'brown')).toEqual({ url: 'https://x/brown-hero-exterior.jpg' });
  });

  it('no flag → undefined (caller then falls back to hero_exterior)', () => {
    expect(resolveHeroRef(refs, null)).toBeUndefined();
    expect(resolveHeroRef(refs, undefined)).toBeUndefined();
  });

  it('unknown key → undefined (asset deselected between flag and generate)', () => {
    expect(resolveHeroRef(refs, 'ghost')).toBeUndefined();
  });

  it('a fresh upload (real base64) passes as bytes, a project-asset as url', () => {
    expect(toHeroImageRef({ base64: 'AAAA', mimeType: 'image/png', preview_url: 'blob:x' }))
      .toEqual({ base64: 'AAAA', mimeType: 'image/png' });
    expect(toHeroImageRef({ base64: '', mimeType: '', preview_url: 'https://x/a.jpg' }))
      .toEqual({ url: 'https://x/a.jpg' });
  });
});

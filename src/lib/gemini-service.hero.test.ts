import { describe, it, expect } from 'vitest';
import { resolveHeroRef, toHeroImageRef, findStyleReference } from './gemini-service';

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

// RB-P2 Step 3 / H1 regression: the role-selector refactor must NOT disconnect the
// style reference from the replicate/generation payload. The role model writes
// role_hint='replicate_creative' for the "Style reference" role; findStyleReference
// is what the payload path resolves — assert the id survives the round-trip.
describe('findStyleReference — style ref reaches the replicate payload', () => {
  // Shape mirrors what CreativeInputs.setRole('style_reference') produces: exactly
  // one ref flipped to 'replicate_creative', the rest 'reference_design'/'amenity'.
  const refs = [
    { id: 'up1', role_hint: 'reference_design', base64: 'AAAA' },
    { id: 'up2', role_hint: 'replicate_creative', base64: 'BBBB' }, // the Style reference
    { id: 'up3', role_hint: 'amenity', base64: 'CCCC' },
  ];

  it('finds exactly the style-reference asset id from the role model', () => {
    const found = findStyleReference(refs);
    expect(found?.id).toBe('up2');
    expect(found?.base64).toBe('BBBB'); // its bytes are what reach IMAGE 1 of the edit call
  });

  it('no style-reference role → undefined (replicate never triggers, no free-compose surprise)', () => {
    expect(findStyleReference([
      { id: 'a', role_hint: 'reference_design' },
      { id: 'b', role_hint: 'amenity' },
    ])).toBeUndefined();
  });

  it('moving the role to another ref moves the payload style ref with it', () => {
    const moved = refs.map((r) =>
      r.id === 'up2' ? { ...r, role_hint: 'reference_design' } : r.id === 'up3' ? { ...r, role_hint: 'replicate_creative' } : r,
    );
    expect(findStyleReference(moved)?.id).toBe('up3');
  });
});

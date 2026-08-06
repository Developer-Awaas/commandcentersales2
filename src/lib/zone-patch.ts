// zone-patch.ts — background-aware ghost-text erasure decision (FIX 2). Pure, no
// canvas: renderTextLayers samples pixels and delegates the *decision* here so it's
// unit-testable. Replaces the old single-flat-colour fill that produced dark opaque
// patches over gradients/photos.
//
// Given a ring of pixels sampled just OUTSIDE a text zone (per edge) plus a grid
// sampled INSIDE it, decide how to erase any baked ghost text:
//   • skip     — the zone is already a clean flat block (no ghost to erase).
//   • gradient — simple background (e.g. sky): fill with a top→bottom colour lerp
//                sampled from the ring, feathered at the edges (done by the caller).
//   • chip     — background too complex to fake (photo/detail): don't erase; the
//                caller instead backs the overlay text with a design chip.

export interface Rgb { r: number; g: number; b: number }

export interface RingSamples {
  top: Rgb[];
  bottom: Rgb[];
  left: Rgb[];
  right: Rgb[];
  inside: Rgb[];
}

export interface PatchPlan {
  mode: 'skip' | 'gradient' | 'chip';
  topColor: Rgb;    // gradient start (top edge)
  bottomColor: Rgb; // gradient end (bottom edge)
}

// ponytail: heuristic thresholds tuned against the Kolosus/Grand-Mark cases —
// expose as consts so they're one place to retune if a new reference misbehaves.
const RING_COMPLEX_VAR = 850;  // ring variance above this ⇒ busy bg ⇒ chip, don't fill
const INSIDE_CLEAN_VAR = 320;  // inside variance below this AND close to ring ⇒ nothing baked
const CLEAN_MEAN_DELTA = 20;   // |insideMean − ringMean| below this ⇒ inside matches bg ⇒ skip

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function mean(px: Rgb[]): Rgb {
  if (!px.length) return BLACK;
  let r = 0, g = 0, b = 0;
  for (const p of px) { r += p.r; g += p.g; b += p.b; }
  return { r: r / px.length, g: g / px.length, b: b / px.length };
}

/** Mean per-channel variance (spread of the sample cloud), 0 = perfectly uniform. */
export function colorVariance(px: Rgb[]): number {
  if (px.length < 2) return 0;
  const m = mean(px);
  let vr = 0, vg = 0, vb = 0;
  for (const p of px) { vr += (p.r - m.r) ** 2; vg += (p.g - m.g) ** 2; vb += (p.b - m.b) ** 2; }
  return (vr + vg + vb) / (3 * px.length);
}

function dist(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export function planPatch(s: RingSamples): PatchPlan {
  const ring = [...s.top, ...s.bottom, ...s.left, ...s.right];
  const topColor = s.top.length ? mean(s.top) : mean(ring);
  const bottomColor = s.bottom.length ? mean(s.bottom) : mean(ring);

  // Busy surrounding background (photo, dense detail): a flat/gradient fill would
  // look like a smear — back the text with a chip instead of erasing.
  if (colorVariance(ring) > RING_COMPLEX_VAR) return { mode: 'chip', topColor, bottomColor };

  // Inside already matches the calm background and has no internal detail ⇒ the model
  // left the zone clean (no ghost). Don't touch it — avoids the pointless dark patch.
  const ringMean = mean(ring);
  if (colorVariance(s.inside) < INSIDE_CLEAN_VAR && dist(mean(s.inside), ringMean) < CLEAN_MEAN_DELTA) {
    return { mode: 'skip', topColor, bottomColor };
  }

  // Simple background but detail (ghost glyphs) inside ⇒ erase with a background-matched
  // vertical gradient (handles skies), feathered by the caller.
  return { mode: 'gradient', topColor, bottomColor };
}

export function rgbCss({ r, g, b }: Rgb): string {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

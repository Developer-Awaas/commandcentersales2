// zone-layers.ts — maps vision-located ReferenceZones + project copy onto
// TextLayers positioned per zone (replicate_layout composite). Pure/testable:
// no DOM, no canvas. The actual pixel composite is renderTextLayers (text-layers.ts).
import type { ReferenceZone } from './reference-style';
import { TEXT_LAYER_REFERENCE_WIDTH, type TextLayer, type AdColors, DEFAULT_AD_COLORS } from './text-layers';

export interface ReplicateCopy {
  headline?: string;
  subheadline?: string;
  price?: string;
  cta?: string;
  footer?: string;
  badges?: string[];    // consumed in order, one per 'badge' zone
  checklist?: string[]; // stacked as one layer per item within the 'checklist' zone
}

export interface ZoneLayerOptions {
  /** Reference canvas height the TextLayer coords are authored against.
   *  = TEXT_LAYER_REFERENCE_WIDTH * (imageHeight / imageWidth). */
  refHeight: number;
  colors?: AdColors;
}

// FIX 3 — minimal-text placement policy. Only these roles are auto-composited by
// default; everything else (subheadline/body, badge stat-cells, amenity checklist)
// is emitted UNPLACED (placed:false) — a suggested chip the user taps to place.
// The logo is composited separately from the brand kit (never a text layer).
const UNPLACED_ROLES = new Set<ReferenceZone['role']>(['subheadline', 'badge', 'checklist']);

/**
 * Font size that fits a zone's height AND approximate width, capped so a short
 * headline in a large box doesn't blow up. Width is estimated (no canvas here);
 * renderTextLayers still word-wraps to the box, this only prevents gross oversizing.
 */
export function fitFontPx(text: string, boxWFrac: number, boxHFrac: number, refHeight: number, lines = 1, fill = 0.55): number {
  const heightFit = (boxHFrac * refHeight * fill) / Math.max(1, lines);
  const widthFit = (boxWFrac * TEXT_LAYER_REFERENCE_WIDTH) / Math.max(3, text.length * 0.56);
  const cap = refHeight * 0.10;
  return Math.max(14, Math.min(heightFit, widthFit, cap));
}

/** Roles that carry no overlaid text (handled elsewhere or left as background). */
const NON_TEXT_ROLES = new Set(['logo', 'photo', 'other']);

const CHAR_W = 0.56;        // avg glyph advance as a fraction of font px (matches fitFontPx)
const LINE_SPACING = 1.25;  // matches renderTextLayers' lineHeight

/** Greedy word-wrap line count for `text` at `fontPx` within `boxWPx` (heuristic,
 *  no canvas — mirrors renderTextLayers' wrap closely enough for fit decisions). */
export function estimateLines(text: string, fontPx: number, boxWPx: number): number {
  const charsPerLine = Math.max(1, Math.floor(boxWPx / (fontPx * CHAR_W)));
  let lines = 1, len = 0;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const add = (len ? 1 : 0) + w.length;
    if (len && len + add > charsPerLine) { lines++; len = w.length; }
    else len += add;
  }
  return lines;
}

/** Trim `text` to fit `budget` chars, cutting at a clause (`, ; :`) or word
 *  boundary — NEVER mid-word — and append an ellipsis. */
export function ellipsizeAtBoundary(text: string, budget: number): string {
  if (budget <= 1 || text.length <= budget) return text.length <= budget ? text : '…';
  const slice = text.slice(0, budget);
  const clause = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf('; '), slice.lastIndexOf(': '));
  const word = slice.lastIndexOf(' ');
  // Prefer a clause boundary if it keeps at least half the budget, else last word.
  const cut = clause >= budget * 0.5 ? clause : (word > 0 ? word : slice.length);
  return text.slice(0, cut).replace(/[\s,;:.–—-]+$/, '') + '…';
}

/**
 * Fit body text into a zone box WITHOUT ever cutting mid-phrase (Fix 4):
 *  1. step the font size down from `startFont` until the wrapped text fits the
 *     box height; then
 *  2. if it still overflows at the minimum font, ellipsize at a clause/word
 *     boundary and flag `overflow` so the user is prompted to edit.
 * Pure/heuristic (no canvas) so it's unit-testable with real copy.
 */
export function fitBodyText(
  text: string,
  boxWFrac: number,
  boxHFrac: number,
  refHeight: number,
  startFont: number,
  minFont = 14,
): { text: string; fontSizePx: number; overflow: boolean } {
  const boxWPx = Math.max(1, boxWFrac * TEXT_LAYER_REFERENCE_WIDTH);
  const boxHPx = Math.max(1, boxHFrac * refHeight) * 0.94; // small safety margin
  for (let f = Math.max(minFont, Math.round(startFont)); f >= minFont; f -= 1) {
    if (estimateLines(text, f, boxWPx) * f * LINE_SPACING <= boxHPx) {
      return { text, fontSizePx: f, overflow: false };
    }
  }
  // Doesn't fit even at minFont — shorten to what the box can hold, at a boundary.
  const maxLines = Math.max(1, Math.floor(boxHPx / (minFont * LINE_SPACING)));
  const charsPerLine = Math.max(1, Math.floor(boxWPx / (minFont * CHAR_W)));
  const budget = Math.max(1, maxLines * charsPerLine - 1); // leave room for '…'
  return { text: ellipsizeAtBoundary(text, budget), fontSizePx: minFont, overflow: true };
}

/**
 * Font size (authored against the 1080-ref width) that fits a zone's box height.
 * renderTextLayers scales fontSizePx by canvasW/1080 at draw time, so authoring
 * against refHeight makes the rendered cap-height ≈ `fill` × the zone's height
 * regardless of the actual output resolution. `lines` splits the budget for
 * stacked content (checklist items).
 */
export function fontPxForZone(boxHeightFraction: number, refHeight: number, lines = 1, fill = 0.62): number {
  return Math.max(14, (boxHeightFraction * refHeight * fill) / Math.max(1, lines));
}

/** Anchor x% for renderTextLayers, whose meaning depends on align. */
export function anchorXPct(bbox: readonly [number, number, number, number], align: 'left' | 'center' | 'right'): number {
  const [x, , w] = bbox;
  if (align === 'center') return (x + w / 2) * 100;
  if (align === 'right') return (x + w) * 100;
  return x * 100;
}

function textForRole(role: ReferenceZone['role'], copy: ReplicateCopy): string | undefined {
  switch (role) {
    case 'headline': return copy.headline;
    case 'subheadline': return copy.subheadline;
    case 'price': return copy.price;
    case 'cta': return copy.cta;
    case 'footer': return copy.footer;
    default: return undefined;
  }
}

/**
 * Build the overlay layers for a replicate composite. One layer per single-text
 * zone; badges consume `copy.badges` in order; a checklist zone expands to one
 * stacked layer per `copy.checklist` item. logo/photo/other zones are skipped
 * (the logo is composited separately from the brand kit, never as text).
 */
export function buildLayersFromZones(
  zones: ReferenceZone[],
  copy: ReplicateCopy,
  opts: ZoneLayerOptions,
): TextLayer[] {
  const colors = opts.colors ?? DEFAULT_AD_COLORS;
  const refH = opts.refHeight;
  const layers: TextLayer[] = [];
  const flow: TextLayer[] = []; // vertically-stacked body text, for the non-overlap pass
  let badgeIdx = 0;

  for (const z of zones) {
    if (NON_TEXT_ROLES.has(z.role)) continue;
    const [x, y, w, h] = z.bbox;
    const xPct = anchorXPct(z.bbox, z.align);
    const widthPct = Math.max(4, w * 100);

    if (z.role === 'badge') {
      const text = copy.badges?.[badgeIdx];
      badgeIdx++;
      if (!text) continue;
      layers.push({
        id: crypto.randomUUID(), text,
        xPct, yPct: (y + h * 0.28) * 100, widthPct,
        fontSizePx: fitFontPx(text, w, h, refH, 1, 0.42),
        fontWeight: 'bold', color: '#ffffff', align: z.align,
        placed: false, // badge/stat-cell — suggested, tap to place (FIX 3)
      });
      continue;
    }

    if (z.role === 'checklist') {
      const items = copy.checklist ?? [];
      if (!items.length) continue;
      const fontSizePx = Math.min(
        fitFontPx(`•  ${items[0]}`, w, h, refH, items.length, 0.8),
        (h * refH) / (items.length * 1.3),
      );
      const stepPct = (h * 100) / items.length;
      items.forEach((item, i) => layers.push({
        id: crypto.randomUUID(), text: `•  ${item}`,
        xPct: x * 100, yPct: (y * 100) + i * stepPct, widthPct,
        fontSizePx: Math.max(14, fontSizePx), fontWeight: 'normal', color: '#ffffff', align: 'left',
        placed: false, // amenity checklist — suggested, tap to place (FIX 3)
      }));
      continue;
    }

    const text = textForRole(z.role, copy);
    if (!text) continue;

    if (z.role === 'cta') {
      layers.push({
        id: crypto.randomUUID(), text,
        xPct, yPct: (y + h * 0.22) * 100, widthPct,
        fontSizePx: fitFontPx(text, w, h, refH, 1, 0.5),
        fontWeight: 'bold', color: colors.primary, align: z.align,
        backgroundColor: colors.accent, paddingPx: 18, borderRadiusPx: 28,
      });
      continue;
    }

    // Fit to the zone box without mid-phrase truncation: step font down, then
    // ellipsize at a boundary and flag for the user to edit (Fix 4).
    const startFont = fitFontPx(text, w, h, refH, 1, z.role === 'headline' ? 0.5 : 0.52);
    const fit = fitBodyText(text, w, h, refH, startFont);
    const layer: TextLayer = {
      id: crypto.randomUUID(), text: fit.text,
      xPct, yPct: (y + h * 0.1) * 100, widthPct,
      fontSizePx: fit.fontSizePx,
      fontWeight: z.role === 'footer' ? 'normal' : (z.weight ?? 'bold'),
      color: '#ffffff', align: z.align,
      ...(fit.overflow ? { overflow: true } : {}),
      ...(UNPLACED_ROLES.has(z.role) ? { placed: false } : {}), // subheadline/body → suggested (FIX 3)
    };
    layers.push(layer);
    if (z.role === 'headline' || z.role === 'subheadline' || z.role === 'price') flow.push(layer);
  }

  // Non-overlap: nudge each stacked body-text layer below the previous one's bottom.
  flow.sort((a, b) => a.yPct - b.yPct);
  let lastBottom = -Infinity;
  for (const l of flow) {
    if (l.yPct < lastBottom + 1) l.yPct = lastBottom + 1;
    lastBottom = l.yPct + (l.fontSizePx / refH) * 100 * 1.35;
  }

  return layers;
}

/** The first logo zone (for programmatic brand-kit logo placement), or null. */
export function logoZone(zones: ReferenceZone[]): ReferenceZone | null {
  return zones.find((z) => z.role === 'logo') ?? null;
}

const PLATE_ROLES = new Set(['headline', 'subheadline', 'price', 'cta', 'badge', 'checklist', 'footer']);

/** Bboxes of the text-bearing zones — filled with the local background at composite
 *  time (renderTextLayers `cleanPlates`) to erase any ghost text the generation baked. */
export function textZonePlates(zones: ReferenceZone[]): [number, number, number, number][] {
  return zones.filter((z) => PLATE_ROLES.has(z.role)).map((z) => z.bbox);
}

/** Reference canvas height for a given output aspect (width fixed at 1080-ref). */
export function refHeightFor(imageWidth: number, imageHeight: number): number {
  return Math.round(TEXT_LAYER_REFERENCE_WIDTH * (imageHeight / imageWidth));
}

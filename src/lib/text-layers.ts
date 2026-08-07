/**
 * text-layers.ts
 * App-controlled, editable text overlay for generated ad creatives — replaces
 * relying on the image-generation model to render headline/price/CTA text
 * directly into the pixels (unreliable at the rendering level, e.g. currency
 * symbol substitution). Layers are stored per creative_assets row and
 * rendered either as a live CSS preview (TextLayerOverlay component) or
 * baked into a final flat image via renderTextLayers (canvas, download-time).
 *
 * Supersedes the old, unused ad-compositor.ts — this is now the only
 * text-compositing path in the app.
 */

export interface TextLayer {
  id: string;
  text: string;
  /** Anchor point as % of canvas width/height. Meaning depends on `align`
   *  (left edge / center point / right edge of the text block). */
  xPct: number;
  yPct: number;
  /** Optional wrap width as % of canvas width. Defaults to remaining width from xPct. */
  widthPct?: number;
  /** Defined relative to a 1080px-wide reference canvas; scaled at render/preview time. */
  fontSizePx: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  align: 'left' | 'center' | 'right';
  backgroundColor?: string;
  paddingPx?: number;
  borderRadiusPx?: number;
  /** Set by the zone-fit routine when copy had to be shortened to fit its box —
   *  surfaced to the user as an "edit this" flag (Fix 4). Purely advisory; the
   *  renderer ignores it. */
  overflow?: boolean;
  /** FIX 3 (minimal-text placement): `false` = a SUGGESTED but not-yet-placed layer
   *  — shown in the Edit Text panel as a tap-to-place chip, NOT baked into the image
   *  or shown in the read-only preview. Undefined/true = placed (rendered). */
  placed?: boolean;
  /** RB-P5: layer kind. `'image'` renders `imageUrl` (fit into the box) instead of
   *  text; `'text'`/absent = a text layer. Schema-versioned for back-compat — absent
   *  `type` on old creatives is resolved via `layerType()` (legacy `kind:'logo'` ⇒
   *  image), so no migration is needed. Use `layerType()`/`isImageLayer()`, not raw
   *  `.type`, when reading. */
  type?: 'text' | 'image';
  /** DEPRECATED alias kept for back-compat with pre-RB-P5 creatives. `layerType()`
   *  maps `kind:'logo'` → image. New code writes `type`, not `kind`. */
  kind?: 'text' | 'logo';
  imageUrl?: string;
  /** Image layers: box height as % of canvas height (text layers ignore this). */
  heightPct?: number;
  /** Image layers: when false, the image stretches to fill w×h; default/true keeps
   *  aspect (contain within the box). The editor's "unlock" toggle sets this false. */
  aspectLocked?: boolean;
  /** Per-layer opacity 5–100 (percent). Absent = 100 (fully opaque). Applies to the
   *  WHOLE layer (text + its chip backing, or the image); the chip backing keeps its
   *  own base alpha in `backgroundColor`, multiplied by this. */
  opacity?: number;
  /** Layer list: temporarily hidden — excluded from the composite and preview while
   *  true. Distinct from `placed:false` (a suggestion chip). */
  hidden?: boolean;
  /** Optional display name for the layer list (falls back to text/'Logo'/'Image'). */
  name?: string;
}

/** Resolves a layer's kind with back-compat: explicit `type` wins, else legacy
 *  `kind:'logo'` ⇒ image, else text. THE canonical accessor — read this, not `.type`. */
export const layerType = (l: TextLayer): 'text' | 'image' =>
  l.type ?? (l.kind === 'logo' ? 'image' : 'text');

/** An image layer (logo or any other picked/uploaded image). */
export const isImageLayer = (l: TextLayer): boolean => layerType(l) === 'image';

/** DEPRECATED — legacy logo predicate. Retained for callers not yet migrated; new
 *  code should use `isImageLayer`. A logo is just an image layer today. */
export const isLogoLayer = (l: TextLayer): boolean => l.kind === 'logo' || l.type === 'image';

/** A layer participates in the composite only when placed AND not hidden. */
export const isVisible = (l: TextLayer): boolean => l.placed !== false && !l.hidden;

/** Layer opacity as a 0..1 alpha (5–100% clamped; absent = 1). */
export const layerAlpha = (l: TextLayer): number =>
  l.opacity == null ? 1 : Math.min(100, Math.max(5, l.opacity)) / 100;

/** A layer is baked/previewed unless it's an explicit unplaced suggestion (FIX 3). */
export const isPlaced = (l: TextLayer): boolean => l.placed !== false;

export interface AdColors {
  primary: string;
  accent: string;
}

export const DEFAULT_AD_COLORS: AdColors = {
  primary: '#1a2332',
  accent: '#c9a961',
};

/** All TextLayer numeric fields (fontSizePx, paddingPx, borderRadiusPx) are
 *  authored against this reference width, then scaled to the actual
 *  preview/export width — so a layer looks proportionally the same anywhere. */
export const TEXT_LAYER_REFERENCE_WIDTH = 1080;

export function buildDefaultLayers(
  layout: 'feed' | 'portrait' | 'story',
  adCopy: { headline?: string; primaryText?: string; cta?: string },
  colors: AdColors = DEFAULT_AD_COLORS,
): TextLayer[] {
  const layers: TextLayer[] = [];
  const isStory = layout === 'story';

  if (adCopy.headline) {
    layers.push({
      id: crypto.randomUUID(),
      text: adCopy.headline,
      xPct: 8,
      yPct: isStory ? 10 : 66,
      widthPct: 84,
      fontSizePx: isStory ? 72 : 54,
      fontWeight: 'bold',
      color: '#ffffff',
      align: 'left',
    });
  }

  if (adCopy.primaryText) {
    layers.push({
      id: crypto.randomUUID(),
      text: adCopy.primaryText,
      xPct: 8,
      yPct: isStory ? 26 : 80,
      widthPct: 84,
      fontSizePx: 30,
      fontWeight: 'normal',
      color: '#e5e7eb',
      align: 'left',
    });
  }

  if (adCopy.cta) {
    layers.push({
      id: crypto.randomUUID(),
      text: `${adCopy.cta}  →`,
      xPct: 8,
      yPct: 90,
      fontSizePx: 28,
      fontWeight: 'bold',
      color: colors.primary,
      align: 'left',
      backgroundColor: colors.accent,
      paddingPx: 18,
      borderRadiusPx: 30,
    });
  }

  return layers;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Splits text into wrapped lines without drawing — caller positions/draws each line. */
function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Loads `imageSrc` (the clean model template) and composites, in strict z-order:
 *   template  <  logo layers  <  text layers
 * and returns a flat base64 JPEG data URL. NO patching/erasure/scrims — the
 * template pixels are never altered (the automated ghost-patching layer was
 * removed; stray AI text is handled by the user via Regenerate or a text layer).
 */
export async function renderTextLayers(
  imageSrc: string,
  layers: TextLayer[],
  canvasW: number,
  canvasH: number,
  logo?: { src: string; bbox: [number, number, number, number] },
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    if (!src.startsWith('data:')) im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Could not load image for text-layer composition'));
    im.src = src;
  });

  // Draw an image into a box at a given alpha. `contain` (default) preserves
  // aspect within the box; otherwise the image stretches to fill w×h.
  const drawImageBox = async (src: string, bx: number, by: number, bw: number, bh: number, alpha: number, contain: boolean) => {
    try {
      const limg = await loadImage(src);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (contain) {
        const s = Math.min(bw / limg.naturalWidth, bh / limg.naturalHeight) || 1;
        const dw = limg.naturalWidth * s, dh = limg.naturalHeight * s;
        ctx.drawImage(limg, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
      } else {
        ctx.drawImage(limg, bx, by, bw, bh);
      }
      ctx.restore();
    } catch { /* image optional — skip on failure */ }
  };

  // z-order layer 0 — the clean model template, never altered.
  const img = await loadImage(imageSrc);
  ctx.drawImage(img, 0, 0, canvasW, canvasH);

  // z-order layer 1a — legacy logo param (old creatives whose layers carry no image).
  if (logo && !layers.some(isImageLayer)) {
    const [lx, ly, lw, lh] = logo.bbox;
    await drawImageBox(logo.src, lx * canvasW, ly * canvasH, lw * canvasW, lh * canvasH, 1, true);
  }

  const scale = canvasW / TEXT_LAYER_REFERENCE_WIDTH;
  const FONT = `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;

  // z-order layer 1b — image layers (logo or any picked/uploaded image). Under text.
  // NOTE: array order within the image/text groups is the z-order the layer-list
  // panel reorders; images always sit under text (template < images < text).
  for (const layer of layers) {
    if (!isVisible(layer) || !isImageLayer(layer) || !layer.imageUrl) continue;
    const bw = ((layer.widthPct ?? 20) / 100) * canvasW;
    const bh = ((layer.heightPct ?? layer.widthPct ?? 20) / 100) * canvasH;
    await drawImageBox(layer.imageUrl, (layer.xPct / 100) * canvasW, (layer.yPct / 100) * canvasH, bw, bh, layerAlpha(layer), layer.aspectLocked !== false);
  }

  // z-order layer 2 — text layers (with optional user-chosen chip backing).
  for (const layer of layers) {
    if (!isVisible(layer) || isImageLayer(layer)) continue; // hidden/unplaced/image handled above
    if (!layer.text.trim()) continue;

    ctx.save();
    ctx.globalAlpha = layerAlpha(layer);
    const x = (layer.xPct / 100) * canvasW;
    const y = (layer.yPct / 100) * canvasH;
    const fontSize = layer.fontSizePx * scale;
    const padding = (layer.paddingPx ?? 0) * scale;
    const maxWidth = layer.widthPct
      ? (layer.widthPct / 100) * canvasW
      : canvasW - x - 40 * scale;

    ctx.font = `${layer.fontWeight === 'bold' ? 'bold ' : ''}${fontSize}px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = layer.align;

    const lines = wrapTextLines(ctx, layer.text, maxWidth);
    const lineHeight = fontSize * 1.25;
    const blockHeight = lines.length * lineHeight;

    if (layer.backgroundColor) {
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      let bgX: number;
      if (layer.align === 'center') bgX = x - widest / 2 - padding;
      else if (layer.align === 'right') bgX = x - widest - padding * 2;
      else bgX = x - padding;

      ctx.fillStyle = layer.backgroundColor; // any CSS color (hex / rgb / rgba chip)
      roundRect(ctx, bgX, y - padding, widest + padding * 2, blockHeight + padding * 2, (layer.borderRadiusPx ?? 0) * scale);
      ctx.fill();
    }

    ctx.fillStyle = layer.color;
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
    ctx.restore(); // pop globalAlpha for this layer
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  return canvas.toDataURL('image/jpeg', 0.93);
}

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
import { planPatch, rgbCss, type Rgb, type RingSamples } from './zone-patch';

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
}

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

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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

function rgbAt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): Rgb | null {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}

/** Sample a ring just OUTSIDE a pixel box (per edge) + a grid INSIDE it (FIX 2). */
function sampleRing(ctx: CanvasRenderingContext2D, bx: number, by: number, bw: number, bh: number, W: number, H: number, off: number): RingSamples {
  const push = (arr: Rgb[], p: Rgb | null) => { if (p) arr.push(p); };
  const s: RingSamples = { top: [], bottom: [], left: [], right: [], inside: [] };
  for (let i = 1; i <= 5; i++) {
    const fx = bx + (bw * i) / 6, fy = by + (bh * i) / 6;
    push(s.top, rgbAt(ctx, fx, by - off, W, H));
    push(s.bottom, rgbAt(ctx, fx, by + bh + off, W, H));
    push(s.left, rgbAt(ctx, bx - off, fy, W, H));
    push(s.right, rgbAt(ctx, bx + bw + off, fy, W, H));
  }
  for (let iy = 1; iy <= 3; iy++) for (let ix = 1; ix <= 3; ix++) {
    push(s.inside, rgbAt(ctx, bx + (bw * ix) / 4, by + (bh * iy) / 4, W, H));
  }
  return s;
}

/** Feathered vertical-gradient patch: an offscreen buffer filled top→bottom, masked
 *  to fade its outer `feather`-px ring to transparent so there's no hard rectangle. */
function drawFeatheredGradient(ctx: CanvasRenderingContext2D, bx: number, by: number, bw: number, bh: number, W: number, H: number, top: Rgb, bottom: Rgb, feather: number) {
  const f = Math.max(1, Math.round(feather));
  const ex = Math.max(0, bx - f), ey = Math.max(0, by - f);
  const ew = Math.min(W - ex, bw + 2 * f), eh = Math.min(H - ey, bh + 2 * f);
  if (ew <= 0 || eh <= 0) return;
  const buf = document.createElement('canvas'); buf.width = ew; buf.height = eh;
  const bctx = buf.getContext('2d'); if (!bctx) return;
  const grad = bctx.createLinearGradient(0, 0, 0, eh);
  grad.addColorStop(0, rgbCss(top)); grad.addColorStop(1, rgbCss(bottom));
  bctx.fillStyle = grad; bctx.fillRect(0, 0, ew, eh);

  // Alpha mask: opaque core (the original zone) fading to 0 over the f-px margin.
  const mask = document.createElement('canvas'); mask.width = ew; mask.height = eh;
  const mctx = mask.getContext('2d'); if (!mctx) return;
  mctx.fillStyle = '#fff'; mctx.fillRect(f, f, Math.max(0, ew - 2 * f), Math.max(0, eh - 2 * f));
  mctx.globalCompositeOperation = 'lighter';
  const band = (x0: number, y0: number, x1: number, y1: number, w: number, h: number, from0: boolean) => {
    const g = mctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, from0 ? 'rgba(255,255,255,0)' : '#fff');
    g.addColorStop(1, from0 ? '#fff' : 'rgba(255,255,255,0)');
    mctx.fillStyle = g; mctx.fillRect(x0, y0, w, h);
  };
  band(0, 0, 0, f, ew, f, true);            // top edge
  band(0, eh - f, 0, eh, ew, f, false);     // bottom edge
  band(0, 0, f, 0, f, eh, true);            // left edge
  band(ew - f, 0, ew, 0, f, eh, false);     // right edge
  bctx.globalCompositeOperation = 'destination-in';
  bctx.drawImage(mask, 0, 0);
  ctx.drawImage(buf, ex, ey);
}

/**
 * Loads `imageSrc`, draws each layer at its scaled position/size, and returns
 * a flat base64 JPEG data URL — used for the "Download" action once a
 * creative has text_layers, replacing a plain raw-image download.
 */
export async function renderTextLayers(
  imageSrc: string,
  layers: TextLayer[],
  canvasW: number,
  canvasH: number,
  logo?: { src: string; bbox: [number, number, number, number] },
  cleanPlates?: [number, number, number, number][],
  chipColor = '#0f172a',
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

  const img = await loadImage(imageSrc);
  ctx.drawImage(img, 0, 0, canvasW, canvasH);

  // Brand logo — composited programmatically into its zone (never model-rendered),
  // fit into the bbox preserving aspect, centered. Non-fatal if it fails to load.
  if (logo) {
    try {
      const limg = await loadImage(logo.src);
      const [lx, ly, lw, lh] = logo.bbox;
      const bx = lx * canvasW, by = ly * canvasH, bw = lw * canvasW, bh = lh * canvasH;
      const s = Math.min(bw / limg.naturalWidth, bh / limg.naturalHeight) || 1;
      const dw = limg.naturalWidth * s, dh = limg.naturalHeight * s;
      ctx.drawImage(limg, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
    } catch { /* logo optional — skip on failure */ }
  }

  // Clean-plates — background-aware ghost-text erasure (FIX 2). Instead of stamping
  // one flat colour over every zone (which left dark opaque patches on skies/photos),
  // sample the ring around each zone, decide per zone (planPatch), and either:
  //   skip     — zone already clean, leave the pixels alone;
  //   gradient — feathered top→bottom fill matched to the local background;
  //   chip     — background too busy to fake: don't erase; if overlay text lands here,
  //              back it with a design chip (~85% opacity) so the text stays legible.
  const feather = Math.max(8, Math.min(12, Math.round(canvasW / 100))); // 8–12px falloff
  if (cleanPlates?.length) {
    for (const [px, py, pw, ph] of cleanPlates) {
      const bx = px * canvasW, by = py * canvasH, bw = pw * canvasW, bh = ph * canvasH;
      const plan = planPatch(sampleRing(ctx, bx, by, bw, bh, canvasW, canvasH, feather));
      if (plan.mode === 'gradient') {
        drawFeatheredGradient(ctx, bx, by, bw, bh, canvasW, canvasH, plan.topColor, plan.bottomColor, feather);
      } else if (plan.mode === 'chip') {
        // Only chip a zone that a PLACED layer actually sits on (avoid floating chips).
        const occupied = layers.some((l) => l.placed !== false && l.text.trim()
          && (l.xPct / 100) * canvasW >= bx - bw * 0.15 && (l.xPct / 100) * canvasW <= bx + bw * 1.15
          && (l.yPct / 100) * canvasH >= by - bh * 0.5 && (l.yPct / 100) * canvasH <= by + bh * 1.5);
        if (occupied) {
          ctx.fillStyle = hexToRgba(chipColor, 0.85);
          roundRect(ctx, bx, by, bw, bh, Math.min(bw, bh) * 0.18);
          ctx.fill();
        }
      }
      // plan.mode === 'skip' → intentionally leave the zone untouched.
    }
  }

  const scale = canvasW / TEXT_LAYER_REFERENCE_WIDTH;
  const FONT = `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;

  for (const layer of layers) {
    if (layer.placed === false) continue; // unplaced suggestion — not baked (FIX 3)
    if (!layer.text.trim()) continue;

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

      ctx.fillStyle = layer.backgroundColor.startsWith('#')
        ? layer.backgroundColor
        : hexToRgba(layer.backgroundColor, 1);
      roundRect(ctx, bgX, y - padding, widest + padding * 2, blockHeight + padding * 2, (layer.borderRadiusPx ?? 0) * scale);
      ctx.fill();
    }

    ctx.fillStyle = layer.color;
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  return canvas.toDataURL('image/jpeg', 0.93);
}

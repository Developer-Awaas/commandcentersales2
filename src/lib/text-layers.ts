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
}

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

  // Clean-plates — erase any ghost text the generation baked into a text zone by
  // filling the zone with the template's own local background colour (sampled just
  // outside the box, median-averaged), so overlay text sits on a clean surface.
  // The client-side equivalent of masking the text zones at generation time.
  if (cleanPlates?.length) {
    for (const [px, py, pw, ph] of cleanPlates) {
      const bx = px * canvasW, by = py * canvasH, bw = pw * canvasW, bh = ph * canvasH;
      const probes: [number, number][] = [[bx - 6, by + bh / 2], [bx + bw + 6, by + bh / 2], [bx + bw / 2, by - 6], [bx + bw / 2, by + bh + 6]];
      let r = 0, g = 0, b = 0, n = 0;
      for (const [sx, sy] of probes) {
        if (sx < 0 || sy < 0 || sx >= canvasW || sy >= canvasH) continue;
        const d = ctx.getImageData(Math.round(sx), Math.round(sy), 1, 1).data;
        r += d[0]; g += d[1]; b += d[2]; n++;
      }
      if (!n) { const d = ctx.getImageData(Math.min(canvasW - 1, Math.round(bx + 2)), Math.min(canvasH - 1, Math.round(by + 2)), 1, 1).data; r = d[0]; g = d[1]; b = d[2]; n = 1; }
      ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
      ctx.fillRect(bx, by, bw, bh);
    }
  }

  const scale = canvasW / TEXT_LAYER_REFERENCE_WIDTH;
  const FONT = `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;

  for (const layer of layers) {
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

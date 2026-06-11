/**
 * ad-compositor.ts
 * Canvas-based ad image compositor. Takes a background image + ad copy and
 * produces a single ready-to-post JPEG with a branded bottom panel.
 */

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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line !== '') {
      ctx.fillText(line.trim(), x, curY);
      line = word + ' ';
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line.trim()) ctx.fillText(line.trim(), x, curY);
  return curY;
}

export interface AdColors {
  primary: string;   // e.g. '#1a2332'
  accent: string;    // e.g. '#c9a961'
}

export const DEFAULT_AD_COLORS: AdColors = {
  primary: '#1a2332',
  accent: '#c9a961',
};

export async function composeAdImage(
  imageSrc: string,
  adCopy: { headline?: string; cta?: string; label?: string },
  colors: AdColors = DEFAULT_AD_COLORS
): Promise<string> {
  const W = 1080, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Load background image
  const img = new Image();
  if (!imageSrc.startsWith('data:')) img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not load image for composition'));
    img.src = imageSrc;
  });
  ctx.drawImage(img, 0, 0, W, H);

  // Bottom panel gradient — covers bottom 42% of the image
  const panelTop = H * 0.58;
  const grad = ctx.createLinearGradient(0, panelTop, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.3, hexToRgba(colors.primary, 0.82));
  grad.addColorStop(1, hexToRgba(colors.primary, 0.97));
  ctx.fillStyle = grad;
  ctx.fillRect(0, panelTop, W, H - panelTop);

  const PAD = 60;
  const FONT = `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;

  // Label chip (angle/variant)
  let chipBottom = panelTop + 52;
  if (adCopy.label) {
    const chipLabel = adCopy.label.toUpperCase();
    ctx.font = `bold 22px ${FONT}`;
    const chipTextW = ctx.measureText(chipLabel).width;
    const chipW = chipTextW + 32;
    const chipH = 38;
    const chipY = panelTop + 32;

    ctx.fillStyle = colors.accent;
    roundRect(ctx, PAD, chipY, chipW, chipH, 8);
    ctx.fill();

    ctx.fillStyle = colors.primary;
    ctx.textBaseline = 'middle';
    ctx.fillText(chipLabel, PAD + 16, chipY + chipH / 2);
    ctx.textBaseline = 'alphabetic';

    chipBottom = chipY + chipH + 28;
  }

  // Headline — large, white, word-wrapped
  if (adCopy.headline) {
    ctx.font = `bold 62px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    // Shadow for readability
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8;
    wrapText(ctx, adCopy.headline, PAD, chipBottom + 12, W - PAD * 2 - 40, 76);
    ctx.shadowBlur = 0;
  }

  // CTA pill — bottom left, accent colored
  if (adCopy.cta) {
    const ctaLabel = adCopy.cta.trim() + '  →';
    ctx.font = `bold 30px ${FONT}`;
    const ctaW = ctx.measureText(ctaLabel).width + 56;
    const ctaH = 60;
    const ctaX = PAD;
    const ctaY = H - PAD - ctaH;

    ctx.fillStyle = colors.accent;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 12;
    roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 30);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = colors.primary;
    ctx.textBaseline = 'middle';
    ctx.font = `bold 28px ${FONT}`;
    ctx.fillText(ctaLabel, ctaX + 28, ctaY + ctaH / 2);
    ctx.textBaseline = 'alphabetic';
  }

  return canvas.toDataURL('image/jpeg', 0.93);
}

// Reference-creative (image-edit) mode helpers. Pure + browser bits kept
// separate so the aspect logic is unit-testable.

export type RefAspect = '1:1' | '4:5' | '9:16';

// The three output aspects the pipeline supports, as width/height ratios.
const ASPECT_RATIOS: [number, RefAspect][] = [
  [1 / 1, '1:1'],
  [4 / 5, '4:5'],   // 0.8
  [9 / 16, '9:16'], // 0.5625
];

/** Snap an arbitrary image width/height to the nearest supported output aspect. */
export function nearestAspect(width: number, height: number): RefAspect {
  if (!(width > 0) || !(height > 0)) return '1:1';
  const r = width / height;
  return ASPECT_RATIOS.reduce((best, cand) =>
    Math.abs(cand[0] - r) < Math.abs(best[0] - r) ? cand : best
  )[1];
}

/** Detect an image's nearest supported aspect from raw base64 (browser only). */
export function aspectFromBase64(base64: string, mimeType: string): Promise<RefAspect> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(nearestAspect(img.naturalWidth, img.naturalHeight));
    img.onerror = () => resolve('1:1'); // fail-safe: square
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

/** Fetch a Storage URL and return its raw base64 + mime (for the edit endpoint). */
export async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch reference image (${resp.status})`);
  const blob = await resp.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { base64: btoa(bin), mimeType: blob.type || 'image/png' };
}

// Shared text-overlay re-composite + persist. Used by StrategyResult (in-session)
// and the viewers (ImageGalleryViewer / CreativeViewer) so "Edit Text" behaves
// identically and — crucially — survives a reload: it re-renders from the CLEAN
// TEMPLATE (never the already-composited final, which would double the text),
// using the persisted zones for clean-plate ghost erase + the brand logo.
import { renderTextLayers, type TextLayer } from './text-layers';
import { textZonePlates } from './zone-layers';
import type { ReferenceZone } from './reference-style';
import { supabase } from './supabase';

function imageDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (!src.startsWith('data:')) im.crossOrigin = 'anonymous';
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => reject(new Error('clean template failed to load'));
    im.src = src;
  });
}

export interface RecomposeInputs {
  cleanTemplateUrl: string;
  layers: TextLayer[];
  zones?: ReferenceZone[];
  logoUrl?: string;
}

/** Re-render the overlay from the clean template + edited layers. Canvas dims are
 *  taken from the clean template's natural size, so callers needn't store them. */
export async function recompositeOverlay({ cleanTemplateUrl, layers, zones, logoUrl }: RecomposeInputs): Promise<string> {
  const { w, h } = await imageDims(cleanTemplateUrl);
  const logoBbox = zones?.find((z) => z.role === 'logo')?.bbox;
  return renderTextLayers(
    cleanTemplateUrl,
    layers,
    w,
    h,
    logoBbox && logoUrl ? { src: logoUrl, bbox: logoBbox } : undefined,
    zones ? textZonePlates(zones) : undefined,
  );
}

/** Re-composite from persisted inputs, overwrite the storage object in place, and
 *  persist the edited layers. Returns a cache-busted public URL for the new image. */
export async function saveOverlayEdit(opts: {
  assetId: string;
  storagePath: string;
  cleanTemplateUrl: string;
  layers: TextLayer[];
  zones?: ReferenceZone[];
  logoUrl?: string;
  bucket?: string;
}): Promise<string> {
  const composed = await recompositeOverlay(opts);
  const blob = await (await fetch(composed)).blob();
  const bucket = opts.bucket ?? 'brand-assets';
  const { error: upErr } = await supabase.storage.from(bucket).upload(opts.storagePath, blob, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw upErr;
  const { error: dbErr } = await supabase.from('creative_assets').update({ text_layers: opts.layers }).eq('id', opts.assetId);
  if (dbErr) throw dbErr;
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(opts.storagePath);
  return `${publicUrl}?t=${Date.now()}`;
}

/** Org brand logo for overlay compositing (white → color → dark preference). */
export async function fetchBrandLogoUrl(): Promise<string | undefined> {
  const { data } = await supabase
    .from('brand_kits')
    .select('logo_white_url, logo_color_url, logo_dark_url')
    .maybeSingle();
  const k = data as { logo_white_url?: string; logo_color_url?: string; logo_dark_url?: string } | null;
  return k?.logo_white_url ?? k?.logo_color_url ?? k?.logo_dark_url ?? undefined;
}

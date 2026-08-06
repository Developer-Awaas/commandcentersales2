import { supabase } from './supabase';
import { getOrgId } from './constants';
import { MOCK_AI_ENABLED } from './feature-flags';
import { MOCK_CREATIVE_IMAGE_BASE64, MOCK_CREATIVE_IMAGE_MIME_TYPE } from '../mocks/ai-fixtures';

export interface GeminiGeneratedImage {
  base64: string;
  mimeType: string;
}

export interface GeminiUploadResult {
  url: string;
  id: string;
  storagePath: string;
}

// Maps Nanobanana angle labels to the creative_assets.angle CHECK constraint values
const ANGLE_MAP: Record<string, string> = {
  'price-led with urgency': 'value',
  'lifestyle / aspirational': 'lifestyle',
  lifestyle: 'lifestyle',
  'trust & legacy / amenities': 'amenity',
  amenity: 'amenity',
  architecture: 'architecture',
  community: 'community',
  value: 'value',
};

const FUNNEL_MAP: Record<string, string> = {
  TOFU: 'awareness',
  MOFU: 'consideration',
  BOFU: 'conversion',
  awareness: 'awareness',
  consideration: 'consideration',
  conversion: 'conversion',
};

// Either bytes already in memory client-side (e.g. a fresh QuickReferenceUpload)
// or a URL to an existing project_assets photo — the generate-image edge
// function fetches URL-based refs server-side rather than round-tripping
// bytes the client would have to download+re-upload for no reason.
export type HeroImageRef = { base64: string; mimeType: string } | { url: string };

// A ref carries real bytes (fresh upload) or only a URL (project-asset). The
// generate-image edge function fetches URL-based refs server-side.
export function toHeroImageRef(r: { base64: string; mimeType: string; preview_url: string }): HeroImageRef {
  return r.base64 ? { base64: r.base64, mimeType: r.mimeType } : { url: r.preview_url };
}

// Single source of truth for "which asset is the hero" — both the normal hero
// path and replicate mode resolve it from the id the user flagged (heroRefKey)
// against the same ref pool, so the payload's building subject is EXACTLY the
// ★-flagged asset at generate-click time (bug: replicate used to ignore this
// and hardcode the first hero_exterior asset instead).
export function resolveHeroRef(
  refs: { id: string; base64: string; mimeType: string; preview_url: string }[],
  heroRefKey: string | null | undefined,
): HeroImageRef | undefined {
  if (!heroRefKey) return undefined;
  const entry = refs.find((r) => r.id === heroRefKey);
  return entry ? toHeroImageRef(entry) : undefined;
}

export async function generateImageWithGemini(
  prompt: string,
  aspectRatio: '1:1' | '9:16' | '4:5' = '1:1',
  quality?: 'low' | 'medium' | 'high',
  // Hero reference image feature: when set, the FIRST entry is the hero photo
  // (real pixels sent for a true image-to-image edit, composition preserved)
  // and any further entries are supporting photos (e.g. amenities) blended in
  // as secondary elements. Omit entirely for the normal text-to-image path.
  heroImages?: HeroImageRef[]
): Promise<GeminiGeneratedImage[]> {
  const dimensionMap: Record<string, { width: number; height: number }> = {
    '9:16': { width: 1080, height: 1920 },
    '4:5':  { width: 1080, height: 1350 },
    '1:1':  { width: 1080, height: 1080 },
  };
  const { width, height } = dimensionMap[aspectRatio] ?? { width: 1080, height: 1080 };
  // Always high quality — production-grade images required for customer-facing use
  const resolvedQuality = quality ?? 'high';

  // MOCK_AI_ENABLED skips only the generate-image network call (real money,
  // real API key). The caller's normal upload/DB-insert path still runs
  // against this real (if tiny) image, so Storage/RLS/display/edit logic is
  // exercised for real.
  if (MOCK_AI_ENABLED) {
    return [{ base64: MOCK_CREATIVE_IMAGE_BASE64, mimeType: MOCK_CREATIVE_IMAGE_MIME_TYPE }];
  }

  const body: Record<string, unknown> = { prompt, width, height, quality: resolvedQuality };
  if (heroImages && heroImages.length > 0) {
    body.heroImage = heroImages[0];
    if (heroImages.length > 1) body.supportingImages = heroImages.slice(1);
  }

  const { data, error } = await supabase.functions.invoke('generate-image', {
    body,
  });

  if (error) {
    let detail = error.message ?? 'Image generation failed';
    try {
      const ctx = await (error as unknown as { context?: Response }).context?.json?.();
      if (ctx?.error) detail = ctx.error;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  if (!data?.base64) throw new Error(data?.error ?? 'No image returned from generation service');

  return [{ base64: data.base64 as string, mimeType: (data.mimeType as string) ?? 'image/jpeg' }];
}

/**
 * Uploads a Gemini-generated image to Supabase Storage and creates a creative_assets DB record.
 * Uses a deterministic path so edits via Canva/Adobe Express overwrite the same file (no storage waste).
 */
export async function uploadGeminiImageToSupabase(
  base64: string,
  mimeType: string,
  opts?: {
    sessionId?: string;
    angleLabel?: string;
    funnelStage?: string;
    projectId?: string;
    creativeId?: string;
    // Real generation prompt, stored in creative_assets.prompt_used.
    // Optional — callers that don't pass one keep the pre-existing
    // fallback (angleLabel), unchanged.
    promptUsed?: string;
  }
): Promise<GeminiUploadResult> {
  const orgId = getOrgId() || 'shared';
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const ext = mimeType.split('/')[1] ?? 'png';
  const blob = new Blob([ab], { type: mimeType });

  // Deterministic path: same file is overwritten on every edit
  const sessionFolder = opts?.sessionId ?? Date.now().toString();
  const angleSlug = (opts?.angleLabel ?? 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filename = `generated-creatives/${orgId}/${sessionFolder}/${angleSlug}.${ext}`;

  const { error } = await supabase.storage
    .from('brand-assets')
    .upload(filename, blob, { contentType: mimeType, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from('brand-assets').getPublicUrl(filename);
  const url = data.publicUrl;

  const angle = ANGLE_MAP[(opts?.angleLabel ?? '').toLowerCase()] ?? 'lifestyle';
  // Root cause of the long-standing funnel-stage bug (CC-P0 workaround,
  // now fixed here instead): FUNNEL_MAP has both uppercase TOFU/MOFU/BOFU
  // keys and lowercase awareness/consideration/conversion passthrough
  // keys, but this lookup used to force .toUpperCase() unconditionally —
  // turning 'consideration' into 'CONSIDERATION', which matches neither
  // key, silently falling through to the 'awareness' default for every
  // caller already using DB vocabulary. Try the raw value first (matches
  // the lowercase keys), only uppercase as a fallback (matches TOFU/MOFU/
  // BOFU regardless of case the caller passed).
  const funnelInput = opts?.funnelStage ?? 'TOFU';
  const funnel_stage = FUNNEL_MAP[funnelInput] ?? FUNNEL_MAP[funnelInput.toUpperCase()] ?? 'awareness';

  const { data: asset, error: dbErr } = await supabase
    .from('creative_assets')
    .insert({
      org_id: orgId,
      project_id: opts?.projectId ?? null,
      funnel_stage,
      angle,
      image_url: url,
      storage_path: filename,
      prompt_used: opts?.promptUsed ?? opts?.angleLabel ?? null,
      model_used: 'gpt-image-1',
      status: 'generated',
      session_id: opts?.sessionId ?? null,
      creative_id: opts?.creativeId ?? null,
    })
    .select('id')
    .single();

  if (dbErr) throw new Error(`DB insert failed: ${dbErr.message}`);
  if (!asset) throw new Error('DB insert succeeded but no row returned — check creative_assets RLS SELECT policy');

  return { url, id: (asset as { id: string }).id, storagePath: filename };
}

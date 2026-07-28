import { supabase, invokeEdgeFn } from './supabase';
import { getOrgId } from './constants';

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

export async function generateImageWithGemini(
  prompt: string,
  aspectRatio: '1:1' | '9:16' | '4:5' = '1:1',
  quality?: 'low' | 'medium' | 'high'
): Promise<GeminiGeneratedImage[]> {
  const dimensionMap: Record<string, { width: number; height: number }> = {
    '9:16': { width: 1080, height: 1920 },
    '4:5':  { width: 1080, height: 1350 },
    '1:1':  { width: 1080, height: 1080 },
  };
  const { width, height } = dimensionMap[aspectRatio] ?? { width: 1080, height: 1080 };
  // Always high quality — production-grade images required for customer-facing use
  const resolvedQuality = quality ?? 'high';

  const { data, error } = await invokeEdgeFn('generate-image', {
    prompt, width, height, quality: resolvedQuality,
  });

  if (error) {
    // invokeEdgeFn normalises crash errors (500/546) before they reach here,
    // so 'non-2xx' is not checked — that was incorrectly triggering "Session expired"
    // for every edge function crash. Only genuine auth rejections (401/403) have
    // UNAUTHORIZED or Missing authorization in their message.
    const isAuth = error.message?.includes('UNAUTHORIZED') || error.message?.includes('Missing authorization');
    console.error('[generateImageWithGemini] edge fn error:', { message: error.message, isAuth });
    if (isAuth) throw new Error('Session expired — please refresh the page and log in again.');
    throw new Error(error.message ?? 'Image generation failed');
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
  const funnel_stage = FUNNEL_MAP[(opts?.funnelStage ?? 'TOFU').toUpperCase()] ?? 'awareness';

  const { data: asset, error: dbErr } = await supabase
    .from('creative_assets')
    .insert({
      org_id: orgId,
      campaign_id: opts?.projectId ?? null,
      funnel_stage,
      angle,
      image_url: url,
      storage_path: filename,
      prompt_used: opts?.angleLabel ?? null,
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

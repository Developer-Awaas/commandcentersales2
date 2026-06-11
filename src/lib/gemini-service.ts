import { supabase } from './supabase';
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
  aspectRatio: '1:1' | '9:16' = '1:1'
): Promise<GeminiGeneratedImage[]> {
  const { width, height } = aspectRatio === '9:16'
    ? { width: 1080, height: 1920 }
    : { width: 1080, height: 1080 };

  const { data, error } = await supabase.functions.invoke('generate-image', {
    body: { prompt, width, height },
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
      model_used: 'nvidia-flux-schnell',
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

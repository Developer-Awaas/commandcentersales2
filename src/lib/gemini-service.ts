import { supabase } from './supabase';
import { getOrgId } from './constants';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function getGeminiApiKey(): string {
  return (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
}

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
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set. Add it to your .env file and restart the dev server.');

  const url = `${GEMINI_BASE}/imagen-3.0-generate-002:predict?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio,
        addWatermark: false,
      },
    }),
  });

  if (!res.ok) {
    let msg = `Gemini API error ${res.status}`;
    try {
      const err = await res.json();
      msg = (err as { error?: { message?: string } })?.error?.message ?? msg;
    } catch { /* ignore parse error */ }
    throw new Error(msg);
  }

  const data = await res.json() as { predictions?: { bytesBase64Encoded: string; mimeType?: string }[] };
  const predictions = data.predictions ?? [];
  if (!predictions.length) throw new Error('Gemini returned no images.');

  return predictions.map((p) => ({
    base64: p.bytesBase64Encoded,
    mimeType: p.mimeType ?? 'image/png',
  }));
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
      model_used: 'imagen-3.0-generate-002',
      status: 'generated',
      session_id: opts?.sessionId ?? null,
    })
    .select('id')
    .single();

  if (dbErr) throw new Error(`DB insert failed: ${dbErr.message}`);

  return { url, id: (asset as { id: string }).id, storagePath: filename };
}

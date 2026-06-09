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

export async function uploadGeminiImageToSupabase(
  base64: string,
  mimeType: string
): Promise<string> {
  const orgId = getOrgId() || 'shared';
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const ext = mimeType.split('/')[1] ?? 'png';
  const blob = new Blob([ab], { type: mimeType });
  const filename = `generated-creatives/${orgId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('brand-assets')
    .upload(filename, blob, { contentType: mimeType, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from('brand-assets').getPublicUrl(filename);
  return data.publicUrl;
}

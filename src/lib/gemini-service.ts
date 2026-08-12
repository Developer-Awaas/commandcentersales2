import { supabase } from './supabase';
import { getOrgId, getUserId } from './constants';
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

// Single source of truth for "which reference is the replicate style source".
// The role model (CreativeInputs.setRole) writes role_hint='replicate_creative'
// on the ref given the "Style reference" role; the replicate/generation path
// resolves it here. Kept as one function so a future role-model refactor can't
// silently disconnect the style reference (RB-P2 Step 3 / H1 regression guard).
export function findStyleReference<T extends { role_hint?: string }>(refs: T[]): T | undefined {
  return refs.find((r) => r.role_hint === 'replicate_creative');
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

// Cost-ledger attribution (agent_interactions), threaded to the generate-image
// edge fn which writes the row (it knows the real provider/quality/unit cost).
// Defaults to feature='creatives' when omitted.
export interface ImageCostMeta {
  feature?: string;
  projectId?: string | null;
}

// Must match generate-image/index.ts's JOB_BUCKET (see the bucket-inference
// rule documented there — an `image-jobs/…` path belongs in creative-assets).
const JOB_BUCKET = 'creative-assets';
const JOB_POLL_MS = 3_000;
// Generous: the wall-clock ceiling and the 10-minute server-side reaper are the
// real bounds. This only stops the UI hanging forever if BOTH Realtime and the
// poll are somehow dead.
const JOB_TIMEOUT_MS = 6 * 60 * 1000;

type ImageJobRow = { status: string; storage_path: string | null; error: string | null };

/**
 * Waits for an async generate-image job and resolves with its storage path.
 *
 * Realtime is the fast path, but a dropped socket is silent — so a 3s poll runs
 * alongside it and either can settle the promise. Without the poll a lost
 * subscription would hang the generation until the 6-minute cap, which is
 * exactly the "request that never completes" symptom async was built to remove.
 */
async function waitForImageJob(jobId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const check = (row: ImageJobRow | null | undefined) => {
      if (settled || !row) return;
      if (row.status === 'done' && row.storage_path) {
        settled = true;
        cleanup();
        resolve(row.storage_path);
      } else if (row.status === 'failed') {
        settled = true;
        cleanup();
        reject(new Error(row.error || 'Image generation failed'));
      }
    };

    const channel = supabase
      .channel(`image-job-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'image_jobs', filter: `id=eq.${jobId}` },
        (payload: { new: ImageJobRow }) => check(payload.new),
      )
      .subscribe();

    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('image_jobs')
        .select('status, storage_path, error')
        .eq('id', jobId)
        .maybeSingle();
      check(data as ImageJobRow | null);
    }, JOB_POLL_MS);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Image generation timed out. Please try again.'));
    }, JOB_TIMEOUT_MS);

    function cleanup() {
      clearInterval(poll);
      clearTimeout(timer);
      supabase.removeChannel(channel);
    }
  });
}

/** Storage blob → base64 payload, matching the sync path's return shape. */
async function downloadJobImage(path: string): Promise<GeminiGeneratedImage> {
  const { data, error } = await supabase.storage.from(JOB_BUCKET).download(path);
  if (error || !data) throw new Error(`Could not download generated image: ${error?.message ?? 'no data'}`);
  const dataUrl: string = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(String(reader.result));
    reader.onerror = () => rej(new Error('Could not read generated image'));
    reader.readAsDataURL(data);
  });
  return { base64: dataUrl.split(',')[1] ?? '', mimeType: data.type || 'image/png' };
}

export async function generateImageWithGemini(
  prompt: string,
  aspectRatio: '1:1' | '9:16' | '4:5' = '1:1',
  quality?: 'low' | 'medium' | 'high',
  // Hero reference image feature: when set, the FIRST entry is the hero photo
  // (real pixels sent for a true image-to-image edit, composition preserved)
  // and any further entries are supporting photos (e.g. amenities) blended in
  // as secondary elements. Omit entirely for the normal text-to-image path.
  heroImages?: HeroImageRef[],
  costMeta?: ImageCostMeta,
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
  // Attribution for the cost ledger — the edge fn writes the row.
  body.orgId = getOrgId() || undefined;
  body.userId = getUserId() || null;
  body.feature = costMeta?.feature ?? 'creatives';
  if (costMeta?.projectId) body.projectId = costMeta.projectId;

  // Async: the edge fn returns a jobId in <1s and finishes in the background,
  // so generation is no longer racing Supabase's 150s request ceiling (which a
  // 129s high-quality multi-reference edit was losing intermittently — 504 with
  // the request stuck pending). The await below keeps this function's contract
  // identical, so every caller is unchanged.
  // orgId is required server-side to create the job row; without one, fall back
  // to the sync path rather than failing outright.
  const useAsync = Boolean(body.orgId);
  if (useAsync) body.async = true;

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

  if (useAsync) {
    if (!data?.jobId) throw new Error(data?.error ?? 'Generation service did not return a job id');
    const path = await waitForImageJob(data.jobId as string);
    return [await downloadJobImage(path)];
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
      // RB-P7: display tag reflecting the IMAGE_MODEL default. The AUTHORITATIVE
      // per-call model lives on the agent_interactions ledger row (edge-written);
      // this client-side field can't see a per-request/rollback override.
      model_used: 'gpt-image-2',
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

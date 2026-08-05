import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, ImagePlus, X } from 'lucide-react';
import { getOrgId } from '../../lib/constants';
import { generateImageWithGemini, uploadGeminiImageToSupabase } from '../../lib/gemini-service';
import { analyzeReferenceStyle, describeImageForFlux } from '../../lib/ai-service';
import { getMediaProvider } from '../../lib/providers';
import { buildReferenceStyleBlock, type ReferenceAnalysis } from '../../lib/reference-style';
import { supabase } from '../../lib/supabase';
import { SINGLE_IMAGE_TESTING_MODE } from '../../lib/feature-flags';
import { saveToolOutput, type AssetRef } from '../../lib/history-service';
import { useGenerationLock } from '../../hooks/useGenerationLock';
import { useToast } from '../../contexts/ToastContext';
import type { SeniorDesignerResult } from '../../pages/strategy/types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

const MAX_REF_BYTES = 5 * 1024 * 1024; // 5 MB cap on the reference image

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

interface GeneratedSlot {
  label: string;
  angleLabel: 'feed' | 'portrait' | 'story';
  url: string;
  id?: string;
  storagePath?: string;
}

export interface CreativeGeneratorResult {
  outputId: string;
  assetIds: string[];
}

export interface CreativeGeneratorProps {
  data: SeniorDesignerResult;
  campaignId?: string | null;
  strategyOutputId?: string | null;
  projectId?: string;
  funnelStage?: 'TOFU' | 'MOFU' | 'BOFU';
  savedCreativeId?: string;
  onSaved: (result: CreativeGeneratorResult) => void;
}

// New reusable image-generation component — the same 3-aspect-ratio
// (feed/portrait/story) generation core StrategyResult.tsx's
// SeniorDesignerResultPanel already runs (generateImageWithGemini +
// uploadGeminiImageToSupabase, SINGLE_IMAGE_TESTING_MODE-gated), lifted out
// so CampaignWizard's Creatives step doesn't need its own hand-rolled
// duplicate. No Canva/Adobe Express edit-in-place here — that's specific to
// the full creative-library viewers (CreativeViewer/ImageGalleryViewer),
// out of scope for a wizard step whose only job is generate-then-save.
export function CreativeGenerator({ data, campaignId, strategyOutputId, projectId, funnelStage, savedCreativeId, onSaved }: CreativeGeneratorProps) {
  const [slots, setSlots] = useState<GeneratedSlot[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const sessionIdRef = useRef(crypto.randomUUID());
  const hasGeneratedRef = useRef(false);
  const { start: startGeneration, stop: stopGeneration } = useGenerationLock();
  const { showToast } = useToast();

  // Optional reference image (CC-P5 Step 4) — structure/palette/text-treatment
  // only, never subject. Attached AFTER the initial auto-generation; the user
  // then hits "Regenerate with reference".
  const [refFile, setRefFile] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null);
  const [refAnalysis, setRefAnalysis] = useState<ReferenceAnalysis | null>(null);
  const [refPath, setRefPath] = useState<string | null>(null);
  const [refBusy, setRefBusy] = useState(false);

  async function onRefSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please select an image file.', 'error'); return; }
    if (file.size > MAX_REF_BYTES) { showToast('Reference image must be under 5 MB.', 'error'); return; }
    const base64 = await readAsBase64(file);
    setRefFile({ base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
    setRefAnalysis(null); // re-analyze for a new image
    setRefPath(null);
  }

  function removeRef() {
    setRefFile(null);
    setRefAnalysis(null);
    setRefPath(null);
  }

  // Upload the reference to the org-scoped quick-references bucket (once).
  async function uploadReference(f: { base64: string; mimeType: string }): Promise<string | null> {
    try {
      const bytes = atob(f.base64);
      const ia = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i);
      const ext = f.mimeType.split('/')[1] ?? 'png';
      const path = `${getOrgId() || 'shared'}/creativegen_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('quick-references')
        .upload(path, new Blob([ia], { type: f.mimeType }), { contentType: f.mimeType, upsert: true });
      if (error) { console.error('[CreativeGenerator] reference upload failed:', error.message); return null; }
      return path;
    } catch (e) {
      console.error('[CreativeGenerator] reference upload error:', e);
      return null;
    }
  }

  // Compose the STYLE REFERENCE block: analyze the reference (Haiku vision,
  // style-only) + this project's own media descriptions + logo. Returns null if
  // there's no reference or analysis fails (→ generate without it). Also uploads
  // the reference + records refAnalysis/refPath for persistence.
  async function buildReferenceBlock(): Promise<string | null> {
    if (!refFile) return null;
    setRefBusy(true);
    try {
      let analysis = refAnalysis;
      if (!analysis) {
        analysis = await analyzeReferenceStyle({ base64: refFile.base64, mimeType: refFile.mimeType });
        if (!analysis) { showToast('Could not read the reference style — generating without it.', 'info'); return null; }
        setRefAnalysis(analysis);
      }
      if (!refPath) {
        const path = await uploadReference(refFile);
        if (path) setRefPath(path);
      }
      const descriptions: string[] = [];
      if (projectId) {
        try {
          const media = await getMediaProvider().listProjectMedia(getOrgId(), projectId, { primaryFirst: true });
          for (const m of media.slice(0, 3)) {
            const desc = m.visual_description || (await describeImageForFlux(m.asset_url));
            if (desc) descriptions.push(desc);
          }
        } catch (e) {
          console.error('[CreativeGenerator] project media enrich failed:', e);
        }
      }
      const logo = await getMediaProvider().getLogo(getOrgId()).catch(() => null);
      return buildReferenceStyleBlock(analysis, descriptions, logo);
    } finally {
      setRefBusy(false);
    }
  }

  async function generate(withReference = false) {
    if (!data.nanobanana_prompt_main) return;
    setGenerating(true);
    startGeneration('Generating creatives…');
    setError(null);
    setSlots([]);
    setSaved(false);
    sessionIdRef.current = crypto.randomUUID();

    try {
      const refBlock = withReference ? await buildReferenceBlock() : null;
      const append = refBlock ? `\n\n${refBlock}` : '';
      const base = data.nanobanana_prompt_main ?? '';
      const promptFeed = base + append;
      const promptPortrait = (data.nanobanana_prompt_portrait ?? base) + append;
      const promptStory = (data.nanobanana_prompt_story ?? base) + append;

      const [feedResult, portraitResult, storyResult] = await Promise.allSettled([
        generateImageWithGemini(promptFeed, '1:1'),
        SINGLE_IMAGE_TESTING_MODE ? Promise.resolve([]) : generateImageWithGemini(promptPortrait, '4:5'),
        SINGLE_IMAGE_TESTING_MODE ? Promise.resolve([]) : generateImageWithGemini(promptStory, '9:16'),
      ]);

      const collected: GeneratedSlot[] = [];
      const errors: string[] = [];

      for (const [result, label, angleLabel] of [
        [feedResult, 'Feed (1080×1080)', 'feed'],
        [portraitResult, 'Portrait (1080×1350)', 'portrait'],
        [storyResult, 'Story (1080×1920)', 'story'],
      ] as [PromiseSettledResult<Awaited<ReturnType<typeof generateImageWithGemini>>>, string, 'feed' | 'portrait' | 'story'][]) {
        if (result.status === 'rejected') {
          errors.push(String(result.reason instanceof Error ? result.reason.message : result.reason));
          continue;
        }
        if (result.value.length === 0) continue;
        const img = result.value[0];
        try {
          const uploaded = await uploadGeminiImageToSupabase(img.base64, img.mimeType, {
            sessionId: sessionIdRef.current,
            angleLabel: data.creative_concept ? `${data.creative_concept}-${angleLabel}` : angleLabel,
            funnelStage: funnelStage ?? 'BOFU',
            projectId,
            creativeId: savedCreativeId,
          });
          collected.push({ label, angleLabel, url: uploaded.url, id: uploaded.id, storagePath: uploaded.storagePath });
        } catch (uploadErr) {
          errors.push(uploadErr instanceof Error ? uploadErr.message : String(uploadErr));
        }
      }

      if (collected.length === 0) {
        setError(errors.length > 0 ? errors[0] : 'Image generation failed — try again.');
      } else {
        setSlots(collected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed.');
    } finally {
      setGenerating(false);
      stopGeneration();
    }
  }

  useEffect(() => {
    if (hasGeneratedRef.current) return;
    if (data.nanobanana_prompt_main) {
      hasGeneratedRef.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveCreatives() {
    setSaving(true);
    try {
      const assetRefs: AssetRef[] = slots
        .filter((s) => s.storagePath)
        .map((s) => ({ bucket: 'brand-assets', path: s.storagePath as string, creative_asset_id: s.id ?? null }));

      const output = await saveToolOutput({
        orgId: getOrgId(),
        domain: 'ads',
        tool: 'ad_creatives',
        campaignId: campaignId ?? null,
        payload: {
          session_id: sessionIdRef.current,
          strategy_output_id: strategyOutputId ?? null,
          slots: slots.map((s) => ({ angle: s.angleLabel, url: s.url, id: s.id })),
          // Reproducibility (CC-P5 Step 4): the exact style extraction + the
          // reference's storage path, when a reference informed this batch.
          ...(refAnalysis ? { reference_analysis: refAnalysis } : {}),
          ...(refPath ? { reference_path: refPath } : {}),
        },
        assetRefs,
        status: 'saved',
      });

      // Approve the underlying creative_assets rows too, matching the
      // existing "approved = saved to library" convention (CreativeViewer's
      // Approve action, StrategyResult's saveCreatives).
      const assetIds = slots.map((s) => s.id).filter((id): id is string => !!id);

      setSaved(true);
      onSaved({ outputId: output.id, assetIds });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (generating && slots.length === 0) {
    return (
      <Card className="p-10 flex flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-text-tertiary">Generating creatives…</p>
      </Card>
    );
  }

  if (error && slots.length === 0) {
    return (
      <Card className="p-6 flex flex-col gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <Button onClick={() => generate(false)} variant="ghost" className="w-fit">
          <RefreshCw size={14} />Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        {slots.map((slot) => (
          <div key={slot.angleLabel} className="rounded-lg border border-border overflow-hidden bg-surface-elevated">
            <img src={slot.url} alt={slot.label} className="w-full aspect-square object-cover" />
            <p className="text-[10px] text-text-tertiary text-center py-1.5">{slot.label}</p>
          </div>
        ))}
      </div>

      {/* Optional reference image — style/palette/layout only (CC-P5 Step 4) */}
      <div className="rounded-lg border border-border bg-surface-elevated p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary">Reference image (optional)</span>
          <span className="text-[10px] text-text-tertiary">style, palette &amp; layout only — not its subject</span>
        </div>
        <div className="flex items-center gap-3">
          {refFile ? (
            <div className="relative">
              <img src={refFile.previewUrl} alt="Reference" className="w-16 h-16 rounded-md object-cover border border-border" />
              <button onClick={removeRef} className="absolute -top-1.5 -right-1.5 bg-surface border border-border rounded-full p-0.5 text-text-tertiary hover:text-red-400" aria-label="Remove reference">
                <X size={11} />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 text-xs text-brand cursor-pointer hover:underline">
              <ImagePlus size={15} /> Attach reference
              <input type="file" accept="image/*" className="hidden" onChange={onRefSelect} />
            </label>
          )}
          <Button
            onClick={() => generate(true)}
            disabled={!refFile || generating || refBusy}
            variant="ghost"
            className="ml-auto w-fit"
          >
            {refBusy || generating ? <Spinner size="sm" /> : <><RefreshCw size={14} />Regenerate with reference</>}
          </Button>
        </div>
        {refAnalysis && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-text-tertiary">Palette:</span>
            {refAnalysis.palette.map((c) => (
              <span key={c} className="inline-block w-3.5 h-3.5 rounded-sm border border-border" style={{ background: c }} title={c} />
            ))}
          </div>
        )}
      </div>

      <Button onClick={handleSaveCreatives} disabled={saved || saving} className="w-full">
        {saved ? <><Check size={15} />Creatives Saved</> : saving ? <Spinner size="sm" /> : 'Save Creatives'}
      </Button>
    </div>
  );
}

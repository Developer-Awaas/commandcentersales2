import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { getOrgId } from '../../lib/constants';
import { generateImageWithGemini, uploadGeminiImageToSupabase } from '../../lib/gemini-service';
import { SINGLE_IMAGE_TESTING_MODE } from '../../lib/feature-flags';
import { saveToolOutput, type AssetRef } from '../../lib/history-service';
import { useGenerationLock } from '../../hooks/useGenerationLock';
import { useToast } from '../../contexts/ToastContext';
import type { SeniorDesignerResult } from '../../pages/strategy/types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

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

  async function generate() {
    if (!data.nanobanana_prompt_main) return;
    setGenerating(true);
    startGeneration('Generating creatives…');
    setError(null);
    setSlots([]);
    setSaved(false);
    sessionIdRef.current = crypto.randomUUID();

    try {
      const promptFeed = data.nanobanana_prompt_main ?? '';
      const promptPortrait = data.nanobanana_prompt_portrait ?? promptFeed;
      const promptStory = data.nanobanana_prompt_story ?? promptFeed;

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
        payload: { session_id: sessionIdRef.current, strategy_output_id: strategyOutputId ?? null, slots: slots.map((s) => ({ angle: s.angleLabel, url: s.url, id: s.id })) },
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
        <Button onClick={generate} variant="ghost" className="w-fit">
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
      <Button onClick={handleSaveCreatives} disabled={saved || saving} className="w-full">
        {saved ? <><Check size={15} />Creatives Saved</> : saving ? <Spinner size="sm" /> : 'Save Creatives'}
      </Button>
    </div>
  );
}

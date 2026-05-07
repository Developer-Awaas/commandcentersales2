import { Sparkles } from 'lucide-react';
import { Card } from './ui/Card';
import { CopyButton } from './ui/CopyButton';
import ReferenceImagePack from './ReferenceImagePack';
import { AanyaDesignerNotes } from '../pages/strategy/StrategyResult';
import type { SeniorDesignerResult } from '../pages/strategy/types';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">
      {children}
    </p>
  );
}

interface Props {
  brief: SeniorDesignerResult;
  sectionLabel?: string;
  projectId?: string;
}

export default function AanyaCreativePromptCard({
  brief,
  sectionLabel = 'Creative Prompts — Nanobanana (Gemini)',
  projectId,
}: Props) {
  const feedPrompt = brief.nanobanana_prompt_main;
  const storyPrompt = brief.nanobanana_prompt_story as string | undefined;
  const manifest = brief.reference_image_manifest;

  if (!feedPrompt && !storyPrompt) return null;

  return (
    <Card>
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <SectionLabel>{sectionLabel}</SectionLabel>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/10 border border-brand/20">
          <Sparkles size={11} className="text-brand" />
          <span className="text-[10px] font-semibold text-brand tracking-wide">
            Designed by Aanya — Senior Creative Director
          </span>
        </div>
      </div>
      <div className="px-5 py-4 flex flex-col gap-4">
        {feedPrompt && (
          <>
            <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-purple-400 uppercase tracking-wide">Feed (1080×1080)</span>
                <CopyButton text={feedPrompt} />
              </div>
              <p className="text-sm text-text-primary leading-relaxed italic">{feedPrompt}</p>
            </div>
            {manifest && manifest.length > 0 && (
              <ReferenceImagePack
                manifest={manifest as import('./ReferenceImagePack').ReferenceManifestItem[]}
                projectId={projectId}
                promptLabel="Feed"
              />
            )}
          </>
        )}
        {storyPrompt && (
          <>
            <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-purple-400 uppercase tracking-wide">Story (1080×1920)</span>
                <CopyButton text={storyPrompt} />
              </div>
              <p className="text-sm text-text-primary leading-relaxed italic">{storyPrompt}</p>
            </div>
            {manifest && manifest.length > 0 && (
              <ReferenceImagePack
                manifest={manifest as import('./ReferenceImagePack').ReferenceManifestItem[]}
                projectId={projectId}
                promptLabel="Story"
              />
            )}
          </>
        )}
        <AanyaDesignerNotes brief={brief} />
      </div>
    </Card>
  );
}

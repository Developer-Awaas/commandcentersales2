import { useState, useEffect, useRef } from 'react';
import {
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RefreshCw,
  Save,
  Sparkles,
  Copy,
  CheckCircle,
  Info,
  ImageIcon,
  Download,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { generateImageWithGemini, uploadGeminiImageToSupabase } from '../../lib/gemini-service';
import { getOrgId, getUserId } from '../../lib/constants';
import { Card } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { TargetingVerifier } from '../../components/TargetingVerifier';
import { InlineCreativeReview, type InlineReviewProject } from '../../components/InlineCreativeReview';
import ReferenceImagePack from '../../components/ReferenceImagePack';
import { ImageGalleryViewer, type GalleryImage } from '../../components/ImageGalleryViewer';
import {
  type StrategyResult as StrategyResultType,
  type QuickGenerateInputs,
  type FullStrategyInputs,
  type StrategyProject,
  type QuickAiResult,
  type FullAiResult,
  type FullAiCampaign,
  type MetaAiResult,
  type MetaAdvantageRec,
  type SeniorDesignerResult,
} from './types';

interface StrategyResultProps {
  result: StrategyResultType;
  onRetry?: () => void;
  onSaveQuick?: (data: QuickAiResult) => void;
  onSaveFull?: (data: FullAiResult) => void;
  quickProject?: InlineReviewProject | null;
  onGeminiStateChange?: (active: boolean) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">
      {children}
    </p>
  );
}

export function AanyaDesignerNotes({ brief }: { brief?: SeniorDesignerResult }) {
  const [open, setOpen] = useState(false);
  if (!brief) return null;

  const refs = brief.reference_image_manifest as { role?: string; instruction?: string }[] | undefined;
  const tags = brief.design_dna_tags as Record<string, string> | undefined;

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs text-text-tertiary hover:text-brand transition-colors"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Designer Notes
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-4 pl-1">
          {brief.creative_concept && (
            <blockquote className="border-l-2 border-brand/40 pl-3 text-sm text-text-primary italic leading-relaxed">
              {String(brief.creative_concept)}
            </blockquote>
          )}
          {brief.designer_rationale && (
            <p className="text-xs text-text-tertiary italic leading-relaxed">{String(brief.designer_rationale)}</p>
          )}
          {refs && refs.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                Reference images to upload to Nanobanana (in order)
              </p>
              <ol className="flex flex-col gap-1.5">
                {refs.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs text-text-primary">
                    <span className="text-text-tertiary flex-shrink-0">{i + 1}.</span>
                    <span><span className="text-brand font-medium">{r.role}</span>{r.instruction ? ` — ${r.instruction}` : ''}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {brief.post_production_notes && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-black leading-relaxed">{String(brief.post_production_notes)}</p>
            </div>
          )}
          {tags && Object.keys(tags).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(tags).map(([k, v]) => (
                <span key={k} className="px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-[10px] text-text-tertiary">
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AiSensySectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="w-6 h-6 rounded-full bg-brand/20 border border-brand/30 text-brand text-[10px] font-bold flex items-center justify-center flex-shrink-0">
        {num}
      </span>
      <div className="flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-brand">{title}</p>
        <div className="h-px bg-surface-elevated mt-1.5" />
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
      <span className="text-xs text-text-tertiary min-w-[160px] flex-shrink-0">{label}</span>
      <span className="text-xs text-text-primary flex-1 leading-relaxed">{value || '—'}</span>
      {copyable && value && <CopyButton text={value} />}
    </div>
  );
}

function charCountColor(len: number, limit: number): string {
  if (len <= limit) return 'text-emerald-400';
  if (len <= Math.round(limit * 1.12)) return 'text-amber-400';
  return 'text-red-400';
}

function CharCount({ text, limit }: { text: string; limit: number }) {
  const len = text.length;
  return (
    <span className={`text-[10px] font-mono ${charCountColor(len, limit)}`}>
      {len}/{limit}
    </span>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-400 mb-1">Generation failed</p>
          <p className="text-xs text-text-tertiary leading-relaxed">{message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-elevated border border-border text-xs text-text-primary hover:bg-surface-hover transition-all flex-shrink-0"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      </div>
    </Card>
  );
}

function RawTextFallback({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-amber-400 font-medium">Response received but JSON could not be parsed</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-elevated border border-border text-xs text-text-primary hover:bg-surface-hover transition-all"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      </div>
      <pre className="text-xs text-text-tertiary leading-relaxed bg-surface rounded-lg p-3 border border-border overflow-x-auto whitespace-pre-wrap">
        {text}
      </pre>
    </Card>
  );
}

function TextBlock({
  label,
  text,
  limit,
  visibleLimit,
}: {
  label: string;
  text: string;
  limit: number;
  visibleLimit?: number;
}) {
  const len = text.length;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-text-tertiary uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-2">
          <CharCount text={text} limit={limit} />
          <CopyButton text={text} />
        </div>
      </div>
      <p className="text-sm text-text-primary leading-relaxed bg-surface rounded-lg p-3 border border-border">
        {text}
      </p>
      {visibleLimit && (
        <p className={`text-[10px] mt-1 font-mono ${charCountColor(len, visibleLimit)}`}>
          {len}/{visibleLimit} visible before &ldquo;See more&rdquo;
        </p>
      )}
    </div>
  );
}

function InfoExpander({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-brand transition-colors"
      >
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        {open ? 'Hide' : 'Details'}
      </button>
      {open && (
        <p className="mt-1.5 text-[11px] text-text-tertiary leading-relaxed bg-surface rounded-lg p-2 border border-border">
          {reasoning}
        </p>
      )}
    </div>
  );
}

const IG_PLACEMENTS = ['Feed', 'Stories', 'Explore', 'Explore Home', 'Reels', 'Profile Feed', 'Search', 'Profile Reels'];
const FB_PLACEMENTS = ['Feed', 'Right Column', 'Marketplace', 'Video Feeds', 'Stories', 'Search', 'Reels', 'Reels Overlay', 'Profile Feed', 'Notification', 'In-Stream Video'];

function PlacementPills({ items, allOptions }: { items: string[]; allOptions: string[] }) {
  const included = new Set(items.map((i) => i.toLowerCase()));
  return (
    <div className="flex flex-wrap gap-1.5">
      {allOptions.map((opt) => {
        const active = included.has(opt.toLowerCase());
        return (
          <span
            key={opt}
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
              active
                ? 'bg-brand/10 text-brand border-brand/30'
                : 'bg-surface-elevated/30 text-text-tertiary border-border'
            }`}
          >
            {opt}
          </span>
        );
      })}
    </div>
  );
}

function buildCopyAllText(data: QuickAiResult): string {
  const lines: string[] = [
    `CAMPAIGN: ${data.campaignName ?? ''}`,
    `IDEA: ${data.idea ?? ''}`,
    '',
    'PRIMARY TEXT:',
    data.primaryText ?? '',
    '',
    'ODIA:',
    data.primaryTextOdia ?? '',
    '',
    `HEADLINE: ${data.headline ?? ''}`,
    `DESCRIPTION: ${data.description ?? ''}`,
    `CTA: ${data.callToAction ?? ''}`,
    '',
    'AD CONFIG:',
    `Objective: ${data.objective ?? ''}`,
    `Locations: ${data.locations ?? ''}`,
    `Age: ${data.ageRange ?? ''}`,
    `Gender: ${data.gender ?? ''}`,
    `Interests: ${data.interests ?? ''}`,
    `Demographics: ${data.demographics ?? ''}`,
    `Occupations: ${data.occupations ?? ''}`,
    `Behaviors: ${data.behaviors ?? ''}`,
    `Placements: ${data.placements ?? ''}`,
    `Daily Budget: ${data.dailyBudget ?? ''}`,
    `Duration: ${data.duration ?? ''}`,
    '',
    'ICEBREAKERS:',
    ...(data.icebreakers ?? []).map((b, i) => `${i + 1}. ${b}`),
    '',
    'CREATIVE PROMPT (1080x1080):',
    data.creativePrompt ?? '',
    '',
    'STORY PROMPT (1080x1920):',
    data.creativePromptStory ?? '',
    '',
    'HASHTAGS:',
    (data.hashtags ?? []).join(' '),
  ];
  return lines.join('\n');
}

function QuickAiOutput({ data, inputs, onSave, project }: { data: QuickAiResult; inputs: QuickGenerateInputs; onSave?: (d: QuickAiResult) => void; project?: InlineReviewProject | null }) {
  const [checklist, setChecklist] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);

  function handleCopyAll() {
    navigator.clipboard.writeText(buildCopyAllText(data)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const launchItems = data.launchChecklist?.length
    ? data.launchChecklist
    : [
        'Set up Facebook Pixel / CAPI',
        'Create WhatsApp flow in AiSensy',
        'Upload creative to ad platform',
        'Set audience targeting',
        'Configure budget and schedule',
        'Enable lead notification alerts',
        'Test ad preview on mobile',
      ];

  const today = new Date();
  const endDate = data.duration
    ? new Date(today.getTime() + parseInt(data.duration) * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const todayStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const interestsList = data.interests ? data.interests.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const demographicsList = data.demographics ? data.demographics.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const occupationsList = data.occupations ? data.occupations.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const behaviorsList = data.behaviors ? data.behaviors.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const allDemographics = [...demographicsList, ...occupationsList];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-brand/10 border border-brand/20 flex-1">
          <Sparkles size={14} className="text-brand" />
          <p className="text-sm text-brand">{data.idea ?? 'Ad generated successfully.'}</p>
        </div>
        <button
          onClick={handleCopyAll}
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border text-xs text-text-tertiary hover:text-text-primary hover:border-brand/30 transition-all whitespace-nowrap flex-shrink-0"
        >
          <Copy size={13} />
          {copied ? 'Copied!' : 'Copy All'}
        </button>
      </div>

      <div className="px-4 py-3 rounded-xl border flex items-center gap-2" style={{ borderColor: '#25D36630', background: '#25D36608' }}>
        <span className="text-xs font-semibold" style={{ color: '#25D366' }}>AiSensy Ad Configuration</span>
        <span className="text-[10px] text-text-tertiary">— {inputs.adPlatform}</span>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <AiSensySectionHeader num={1} title="Ad Type" />
        </div>
        <div className="px-5 py-2">
          <FieldRow label="Ad Type" value={data.adType ?? 'CTWA'} copyable />
          <FieldRow label="Ad Objective" value={data.objective ?? ''} copyable />
          <FieldRow label="Performance Goal" value={data.adType === 'CTWA' ? 'Conversations' : 'Link Clicks'} />
          <FieldRow label="CTA" value={data.callToAction ?? ''} copyable />
          <FieldRow label="Bid Strategy" value={data.bidStrategy ?? ''} />
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <AiSensySectionHeader num={2} title="Ad Targeting & Audience" />
        </div>
        <div className="px-5 py-2">
          <FieldRow label="Locations" value={data.locations ?? ''} copyable />
          <FieldRow label="Gender" value={data.gender ?? ''} />
          <FieldRow label="Age Group" value={data.ageRange ?? ''} />
        </div>
        <div className="px-5 pb-4 flex flex-col gap-4">
          {(data.instagramPlacements?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Instagram Placements</p>
              <PlacementPills items={data.instagramPlacements ?? []} allOptions={IG_PLACEMENTS} />
            </div>
          )}
          {(data.facebookPlacements?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Facebook Placements</p>
              <PlacementPills items={data.facebookPlacements ?? []} allOptions={FB_PLACEMENTS} />
            </div>
          )}
          {interestsList.length > 0 && (
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Interests</p>
                <p className="text-xs text-text-primary">{interestsList.join(', ')}</p>
              </div>
              <CopyButton text={interestsList.join(', ')} />
            </div>
          )}
          {allDemographics.length > 0 && (
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Demographics</p>
                <p className="text-xs text-text-primary">{allDemographics.join(', ')}</p>
              </div>
              <CopyButton text={allDemographics.join(', ')} />
            </div>
          )}
          {behaviorsList.length > 0 && (
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Behaviors</p>
                <p className="text-xs text-text-primary">{behaviorsList.join(', ')}</p>
              </div>
              <CopyButton text={behaviorsList.join(', ')} />
            </div>
          )}
          {data.audienceExpansion && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Audience Expansion</p>
              <p className="text-xs text-text-primary">{data.audienceExpansion}</p>
            </div>
          )}
          {(interestsList.length > 0 || allDemographics.length > 0 || behaviorsList.length > 0) && (
            <TargetingVerifier
              interests={interestsList}
              demographics={allDemographics}
              behaviors={behaviorsList}
              platform={inputs.adPlatform}
            />
          )}
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <AiSensySectionHeader num={3} title="Ad Budget" />
        </div>
        <div className="px-5 py-2">
          <FieldRow label="Budget Type" value="Daily Budget" />
          <FieldRow label="Amount" value={data.dailyBudget ? `₹${data.dailyBudget}` : '—'} copyable />
          <FieldRow label="Start Date" value={todayStr} />
          <FieldRow label="End Date" value={endDate} />
          <FieldRow label="Duration" value={data.duration ? `${data.duration} days` : '—'} />
          <FieldRow label="Custom Schedule" value="OFF — Run all day for maximum reach" />
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <AiSensySectionHeader num={4} title="Ad Creative" />
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          {data.campaignName && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-text-tertiary uppercase tracking-wide">Ad Name</span>
                <div className="flex items-center gap-2">
                  <CharCount text={data.campaignName} limit={255} />
                  <CopyButton text={data.campaignName} />
                </div>
              </div>
              <p className="text-sm text-text-primary bg-surface rounded-lg p-3 border border-border">{data.campaignName}</p>
            </div>
          )}
          {data.primaryText && (
            <TextBlock label="Primary Text" text={data.primaryText} limit={2200} visibleLimit={125} />
          )}
          {data.primaryTextOdia && (
            <TextBlock label="Primary Text (Odia)" text={data.primaryTextOdia} limit={2200} visibleLimit={125} />
          )}
          <div className="grid grid-cols-3 gap-4">
            {data.headline && (
              <TextBlock label="Headline" text={data.headline} limit={255} />
            )}
            {data.description && (
              <TextBlock label="Description" text={data.description} limit={30} />
            )}
            <div>
              <span className="text-xs text-text-tertiary uppercase tracking-wide block mb-1.5">Media</span>
              <p className="text-xs text-text-tertiary bg-surface rounded-lg p-3 border border-border">
                Generate image using the prompt below
              </p>
            </div>
          </div>
        </div>
      </Card>

      {data.icebreakers && data.icebreakers.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <AiSensySectionHeader num={5} title="Icebreakers" />
              <span className="text-[10px] font-semibold text-brand mb-4">Enable Icebreakers: ON</span>
            </div>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            {data.icebreakers.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                <span className="text-[11px] text-text-tertiary flex-shrink-0">{i + 1}.</span>
                <span className="text-sm text-text-primary flex-1">{item}</span>
                <CopyButton text={item} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {(data.creativePrompt || data.creativePromptStory) && (
        <Card>
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <SectionLabel>Creative Prompts — {inputs.creativePlatform}</SectionLabel>
            {data._aanyaBrief && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/10 border border-brand/20">
                <Sparkles size={11} className="text-brand" />
                <span className="text-[10px] font-semibold text-brand tracking-wide">Designed by Aanya — Senior Creative Director</span>
              </div>
            )}
          </div>
          <div className="px-5 py-4 flex flex-col gap-4">
            {data.creativePrompt && (
              <>
                <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-purple-400 uppercase tracking-wide">Feed (1080×1080)</span>
                    <CopyButton text={data.creativePrompt} />
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed italic">{data.creativePrompt}</p>
                </div>
                {data._aanyaBrief?.reference_image_manifest && data._aanyaBrief.reference_image_manifest.length > 0 && (
                  <ReferenceImagePack
                    manifest={data._aanyaBrief.reference_image_manifest as import('../../components/ReferenceImagePack').ReferenceManifestItem[]}
                    projectId={inputs.projectId !== 'custom' ? inputs.projectId : undefined}
                    promptLabel="Feed"
                  />
                )}
              </>
            )}
            {data.creativePromptStory && (
              <>
                <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-purple-400 uppercase tracking-wide">Story (1080×1920)</span>
                    <CopyButton text={data.creativePromptStory} />
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed italic">{data.creativePromptStory}</p>
                </div>
                {data._aanyaBrief?.reference_image_manifest && data._aanyaBrief.reference_image_manifest.length > 0 && (
                  <ReferenceImagePack
                    manifest={data._aanyaBrief.reference_image_manifest as import('../../components/ReferenceImagePack').ReferenceManifestItem[]}
                    projectId={inputs.projectId !== 'custom' ? inputs.projectId : undefined}
                    promptLabel="Story"
                  />
                )}
              </>
            )}
            <AanyaDesignerNotes brief={data._aanyaBrief} />
          </div>
        </Card>
      )}

      {(data.creativePrompt || data.creativePromptStory) && (
        <InlineCreativeReview
          project={project ?? null}
          context={{
            platform: inputs.creativePlatform,
            objective: inputs.objective,
            headline: data.headline,
            idea: data.idea,
          }}
          label="Review Your Generated Creative"
        />
      )}

      {data.hashtags && data.hashtags.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <SectionLabel>Hashtags</SectionLabel>
              <CopyButton text={data.hashtags.join(' ')} />
            </div>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-2">
            {data.hashtags.map((tag, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-full bg-surface-elevated border border-border text-xs text-text-tertiary"
              >
                {tag}
              </span>
            ))}
          </div>
        </Card>
      )}

      {data.whatsappFlow && (
        <Card className="p-5">
          <SectionLabel>WhatsApp Flow Recommendation</SectionLabel>
          <p className="text-sm text-text-primary leading-relaxed">{data.whatsappFlow}</p>
        </Card>
      )}

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <SectionLabel>Launch Checklist</SectionLabel>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2">
          {launchItems.map((item, i) => (
            <button
              key={i}
              onClick={() => setChecklist((c) => ({ ...c, [i]: !c[i] }))}
              className="flex items-center gap-3 text-left group"
            >
              {checklist[i] ? (
                <CheckSquare size={15} className="text-brand flex-shrink-0" />
              ) : (
                <Square size={15} className="text-text-tertiary flex-shrink-0 group-hover:text-text-primary" />
              )}
              <span className={`text-sm ${checklist[i] ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>
                {item}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {onSave && (
        <button
          onClick={() => onSave(data)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-brand/30 text-sm text-brand hover:bg-brand/10 transition-all self-start"
        >
          <Save size={14} />
          Save as Draft Campaign
        </button>
      )}
    </div>
  );
}

function AdvantBadge({ rec }: { rec?: MetaAdvantageRec }) {
  if (!rec) return null;
  const isOn = rec.recommendation?.toUpperCase() === 'ON';
  return (
    <div className={`inline-flex flex-col gap-0.5 px-3 py-2 rounded-lg border ${isOn ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
      <div className="flex items-center gap-1.5">
        {isOn
          ? <CheckCircle size={12} className="text-emerald-400 flex-shrink-0" />
          : <Info size={12} className="text-amber-400 flex-shrink-0" />}
        <span className={`text-xs font-semibold ${isOn ? 'text-emerald-400' : 'text-amber-400'}`}>
          {rec.recommendation}
        </span>
      </div>
      {rec.reasoning && (
        <p className="text-[10px] text-text-tertiary leading-relaxed max-w-xs">{rec.reasoning}</p>
      )}
    </div>
  );
}

function MetaSectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="w-7 h-7 rounded-full bg-[#1877F2]/20 border border-[#1877F2]/40 text-[#1877F2] text-xs font-bold flex items-center justify-center flex-shrink-0">
        {num}
      </span>
      <div className="flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#1877F2]">{title}</p>
        <div className="h-px bg-surface-elevated mt-1.5" />
      </div>
    </div>
  );
}

function MetaAiOutput({ data, inputs, onSave, project }: { data: MetaAiResult; inputs: QuickGenerateInputs; onSave?: (d: QuickAiResult) => void; project?: InlineReviewProject | null }) {
  const [checklist, setChecklist] = useState<Record<number, boolean>>({});

  const interests = data.adSet?.audience?.detailedTargeting?.interests ?? [];
  const demographics = data.adSet?.audience?.detailedTargeting?.demographics ?? [];
  const behaviors = data.adSet?.audience?.detailedTargeting?.behaviors ?? [];

  const launchItems = data.launchChecklist?.length ? data.launchChecklist : [
    'Enable Special Ad Category: Housing in campaign',
    'Tick "Housing" policy requirement in ad set',
    'Configure Meta Pixel and verify Lead event fires',
    'Create Instant Form with phone + name fields',
    'Add SMS verification for quality filtering',
    'Set up automated lead delivery to Google Sheets',
    'Exclude Audience Network from placements',
    'Test ad preview on mobile before publishing',
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1877F2]/10 border border-[#1877F2]/20 flex-1">
          <Sparkles size={14} className="text-[#1877F2]" />
          <p className="text-sm text-[#1877F2]">{data.idea ?? 'Meta Ads campaign generated.'}</p>
        </div>
      </div>

      <div className="px-4 py-3 rounded-xl border border-[#1877F2]/30 bg-[#1877F2]/5 flex items-center gap-2">
        <span className="text-xs font-semibold text-[#1877F2]">Meta Ads Manager — 3-Level Hierarchy</span>
        <span className="text-[10px] text-text-tertiary">Campaign → Ad Set → Ad</span>
      </div>

      {/* SECTION 1 — CAMPAIGN */}
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <MetaSectionHeader num={1} title="Campaign" />
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          <FieldRow label="Campaign Name" value={data.campaign?.campaignName ?? '—'} copyable />
          <FieldRow label="Objective" value={data.campaign?.objective ?? '—'} />
          <FieldRow label="Special Ad Category" value={data.campaign?.specialAdCategory ?? '—'} />
          <FieldRow label="Budget Strategy" value={data.campaign?.budgetStrategy ?? '—'} />
          <FieldRow label="Daily Budget" value={data.campaign?.dailyBudget ?? '—'} copyable />
          <FieldRow label="Bid Strategy" value={data.campaign?.bidStrategy ?? '—'} />
          <FieldRow label="Campaign Spending Limit" value={data.campaign?.campaignSpendingLimit ?? '—'} />
          <FieldRow label="A/B Test" value={data.campaign?.abTest ?? '—'} />
          <div className="pt-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Advantage+ Campaign</p>
            <AdvantBadge rec={data.campaign?.advantagePlusCampaign} />
          </div>
        </div>
      </Card>

      {/* SECTION 2 — AD SET */}
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <MetaSectionHeader num={2} title="Ad Set" />
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Advantage+ Recommendations</p>
            <div className="flex flex-wrap gap-3">
              <div>
                <p className="text-[10px] text-text-tertiary mb-1.5">Campaign Budget</p>
                <AdvantBadge rec={data.campaign?.advantagePlusCampaign} />
              </div>
              <div>
                <p className="text-[10px] text-text-tertiary mb-1.5">Audience</p>
                <AdvantBadge rec={data.adSet?.advantagePlusAudience} />
              </div>
              <div>
                <p className="text-[10px] text-text-tertiary mb-1.5">Placements</p>
                <AdvantBadge rec={data.adSet?.advantagePlusPlacements} />
              </div>
            </div>
          </div>

          <div className="h-px bg-surface-elevated" />

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Ad Set Config</p>
            <FieldRow label="Conversion Location" value={data.adSet?.conversionLocation ?? '—'} />
            <FieldRow label="Facebook Page" value={data.adSet?.facebookPage ?? '—'} />
            <FieldRow label="Performance Goal" value={data.adSet?.performanceGoal ?? '—'} />
            <FieldRow label="Dynamic Creative" value={data.adSet?.dynamicCreative ?? '—'} />
            <FieldRow label="Schedule" value={data.adSet?.schedule ? `${data.adSet.schedule.startDate ?? ''} → ${data.adSet.schedule.endDate ?? ''}` : '—'} />
            <FieldRow label="Policy Requirements" value={data.adSet?.policyRequirements ?? '—'} />
          </div>

          <div className="h-px bg-surface-elevated" />

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Audience</p>
            <FieldRow label="Locations" value={data.adSet?.audience?.locations ?? '—'} copyable />
            <FieldRow label="Age Range" value={data.adSet?.audience?.ageRange ?? '—'} />
            <FieldRow label="Gender" value={data.adSet?.audience?.gender ?? '—'} />
            <FieldRow label="Languages" value={data.adSet?.audience?.languages ?? '—'} />
            <FieldRow label="Custom Audiences" value={data.adSet?.audience?.customAudiences ?? '—'} />
            <FieldRow label="Audience Expansion" value={data.adSet?.audience?.audienceExpansion ?? '—'} />
          </div>

          {(interests.length > 0 || demographics.length > 0 || behaviors.length > 0) && (
            <div className="flex flex-col gap-3">
              {interests.length > 0 && (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Interests</p>
                    <p className="text-xs text-text-primary">{interests.join(', ')}</p>
                  </div>
                  <CopyButton text={interests.join(', ')} />
                </div>
              )}
              {demographics.length > 0 && (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Demographics</p>
                    <p className="text-xs text-text-primary">{demographics.join(', ')}</p>
                  </div>
                  <CopyButton text={demographics.join(', ')} />
                </div>
              )}
              {behaviors.length > 0 && (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Behaviors</p>
                    <p className="text-xs text-text-primary">{behaviors.join(', ')}</p>
                  </div>
                  <CopyButton text={behaviors.join(', ')} />
                </div>
              )}
              <TargetingVerifier
                interests={interests}
                demographics={demographics}
                behaviors={behaviors}
                platform="Meta Ads Manager"
              />
            </div>
          )}

          {data.adSet?.manualPlacementsIfDisabled && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Manual Placements (if Advantage+ disabled)</p>
              <div className="grid grid-cols-2 gap-3">
                {data.adSet.manualPlacementsIfDisabled.facebook && (
                  <div>
                    <p className="text-[10px] text-text-tertiary mb-1.5">Facebook</p>
                    <PlacementPills items={data.adSet.manualPlacementsIfDisabled.facebook} allOptions={FB_PLACEMENTS} />
                  </div>
                )}
                {data.adSet.manualPlacementsIfDisabled.instagram && (
                  <div>
                    <p className="text-[10px] text-text-tertiary mb-1.5">Instagram</p>
                    <PlacementPills items={data.adSet.manualPlacementsIfDisabled.instagram} allOptions={IG_PLACEMENTS} />
                  </div>
                )}
              </div>
              {data.adSet.manualPlacementsIfDisabled.excludedPlatforms && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.adSet.manualPlacementsIfDisabled.excludedPlatforms.map((p) => (
                    <span key={p} className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">Excluded: {p}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* SECTION 3 — AD */}
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <MetaSectionHeader num={3} title="Ad" />
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <FieldRow label="Facebook Page" value={data.ad?.identity?.facebookPage ?? '—'} />
          <FieldRow label="Instagram Account" value={data.ad?.identity?.instagramAccount ?? '—'} />
          <FieldRow label="Format" value={data.ad?.format ?? '—'} />
          <FieldRow label="Destination" value={data.ad?.destination ?? '—'} />
          <FieldRow label="Instant Form Strategy" value={data.ad?.instantFormStrategy ?? '—'} copyable />
          <FieldRow label="Partnership Ad" value={data.ad?.partnershipAd ?? '—'} />
          <FieldRow label="Multi-Advertiser Ads" value={data.ad?.multiAdvertiserAds ?? '—'} />

          {data.ad?.primaryText && (
            <TextBlock label="Primary Text" text={data.ad.primaryText} limit={2200} visibleLimit={125} />
          )}
          <div className="grid grid-cols-2 gap-4">
            {data.ad?.headline && (
              <TextBlock label="Headline" text={data.ad.headline} limit={27} />
            )}
            {data.ad?.description && (
              <TextBlock label="Description" text={data.ad.description} limit={27} />
            )}
          </div>

          {data.ad?.qualityFilters && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Quality Filters</p>
              <FieldRow label="SMS Verification" value={data.ad.qualityFilters.smsVerification ?? '—'} />
              <FieldRow label="Work Email" value={data.ad.qualityFilters.workEmail ?? '—'} />
            </div>
          )}

          <FieldRow label="Lead Delivery" value={data.ad?.automatedLeadDelivery ?? '—'} />
          <FieldRow label="Pixel Events" value={data.ad?.trackingPixelEvents ?? '—'} />
          <FieldRow label="UTM Parameters" value={data.ad?.utmParameters ?? '—'} copyable />
        </div>
      </Card>

      {/* Advantage+ Summary */}
      {data.advantagePlusSummary && (
        <div className="px-4 py-3.5 rounded-xl bg-[#1877F2]/10 border border-[#1877F2]/20">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#1877F2] mb-1.5">Advantage+ Strategy Rationale</p>
          <p className="text-sm text-text-primary leading-relaxed">{data.advantagePlusSummary}</p>
        </div>
      )}

      {/* Icebreakers */}
      {data.icebreakers && data.icebreakers.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border">
            <SectionLabel>Icebreakers (WhatsApp)</SectionLabel>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            {data.icebreakers.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                <span className="text-[11px] text-text-tertiary flex-shrink-0">{i + 1}.</span>
                <span className="text-sm text-text-primary flex-1">{item}</span>
                <CopyButton text={item} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Creative Prompts */}
      {(data.creativePrompt || data.creativePromptStory) && (
        <Card>
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <SectionLabel>Creative Prompts — {inputs.creativePlatform}</SectionLabel>
            {data._aanyaBrief && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/10 border border-brand/20">
                <Sparkles size={11} className="text-brand" />
                <span className="text-[10px] font-semibold text-brand tracking-wide">Designed by Aanya — Senior Creative Director</span>
              </div>
            )}
          </div>
          <div className="px-5 py-4 flex flex-col gap-4">
            {data.creativePrompt && (
              <>
                <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-purple-400 uppercase tracking-wide">Feed (1080×1080)</span>
                    <CopyButton text={data.creativePrompt} />
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed italic">{data.creativePrompt}</p>
                </div>
                {data._aanyaBrief?.reference_image_manifest && data._aanyaBrief.reference_image_manifest.length > 0 && (
                  <ReferenceImagePack
                    manifest={data._aanyaBrief.reference_image_manifest as import('../../components/ReferenceImagePack').ReferenceManifestItem[]}
                    projectId={inputs.projectId !== 'custom' ? inputs.projectId : undefined}
                    promptLabel="Feed"
                  />
                )}
              </>
            )}
            {data.creativePromptStory && (
              <>
                <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-purple-400 uppercase tracking-wide">Story (1080×1920)</span>
                    <CopyButton text={data.creativePromptStory} />
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed italic">{data.creativePromptStory}</p>
                </div>
                {data._aanyaBrief?.reference_image_manifest && data._aanyaBrief.reference_image_manifest.length > 0 && (
                  <ReferenceImagePack
                    manifest={data._aanyaBrief.reference_image_manifest as import('../../components/ReferenceImagePack').ReferenceManifestItem[]}
                    projectId={inputs.projectId !== 'custom' ? inputs.projectId : undefined}
                    promptLabel="Story"
                  />
                )}
              </>
            )}
            <AanyaDesignerNotes brief={data._aanyaBrief} />
          </div>
        </Card>
      )}

      {(data.creativePrompt || data.creativePromptStory) && (
        <InlineCreativeReview
          project={project ?? null}
          context={{ platform: inputs.creativePlatform, objective: inputs.objective, headline: data.ad?.headline, idea: data.idea }}
          label="Review Your Generated Creative"
        />
      )}

      {/* Launch Checklist */}
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <SectionLabel>Launch Checklist</SectionLabel>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2">
          {launchItems.map((item, i) => (
            <button key={i} onClick={() => setChecklist((c) => ({ ...c, [i]: !c[i] }))} className="flex items-center gap-3 text-left group">
              {checklist[i]
                ? <CheckSquare size={15} className="text-brand flex-shrink-0" />
                : <Square size={15} className="text-text-tertiary flex-shrink-0 group-hover:text-text-primary" />}
              <span className={`text-sm ${checklist[i] ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{item}</span>
            </button>
          ))}
        </div>
      </Card>

      {onSave && (
        <button
          onClick={() => onSave(data as unknown as QuickAiResult)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-brand/30 text-sm text-brand hover:bg-brand/10 transition-all self-start"
        >
          <Save size={14} />
          Save as Draft Campaign
        </button>
      )}
    </div>
  );
}

function QuickGeneratePlaceholder({
  inputs,
  projectName,
}: {
  inputs: QuickGenerateInputs;
  projectName: string;
}) {
  const sampleHeadline = `${projectName} — Limited Units`;
  const sampleDescription = `Premium living in ${inputs.customProject.city || 'Bhubaneswar'}`;
  const samplePrimary = `Don't miss out — only a few units left at ${projectName}. Book your site visit today and speak to our advisor.`;

  return (
    <div className="flex flex-col gap-5">
      <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
        AI generation will be enabled once API key is configured. Your inputs have been captured.
      </div>
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <SectionLabel>Your Request Summary</SectionLabel>
        </div>
        <div className="px-5 py-4 flex flex-col gap-0">
          <FieldRow label="Prompt" value={inputs.prompt || '—'} />
          <FieldRow label="Project" value={projectName} />
          <FieldRow label="Objective" value={inputs.objective} />
          <FieldRow label="Creative Platform" value={inputs.creativePlatform} />
          <FieldRow label="Ad Platform" value={inputs.adPlatform} />
          {inputs.competitorAnalysis && (
            <FieldRow label="Competitor Input" value={inputs.competitorAnalysis} />
          )}
        </div>
      </Card>
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <SectionLabel>Ad Copy Preview (Sample)</SectionLabel>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <TextBlock label="Primary Text" text={samplePrimary} limit={2200} />
          <div className="grid grid-cols-3 gap-4">
            <TextBlock label="Headline" text={sampleHeadline} limit={255} />
            <TextBlock label="Description" text={sampleDescription} limit={30} />
            <div>
              <span className="text-xs text-text-tertiary uppercase tracking-wide block mb-1.5">CTA</span>
              <p className="text-sm text-text-primary bg-surface rounded-lg p-3 border border-border">
                Learn More
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

const CAMPAIGN_SECTION_MAP: Array<{ title: string; keys: string[] }> = [
  { title: 'Campaign Setup', keys: ['project', 'funnelStage', 'objective', 'audience', 'creativeFormat'] },
  { title: 'Targeting & Audience', keys: ['locations', 'ageRange', 'gender', 'interests', 'demographics', 'occupations', 'educationLevel', 'lifeEvents', 'behaviors'] },
  { title: 'Placements', keys: ['placements'] },
  { title: 'Budget', keys: ['budget'] },
  { title: 'Creative', keys: ['primaryText', 'headline'] },
  { title: 'Icebreakers', keys: ['icebreakers'] },
  { title: 'Tracking', keys: ['pixelEvents', 'conversionEvent'] },
];

function FullCampaignCard({
  campaign,
  idx,
  selectedName,
}: {
  campaign: FullAiCampaign;
  idx: number;
  selectedName: string;
}) {
  const interestsList = campaign.interests ? String(campaign.interests).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const demographicsList = campaign.demographics ? String(campaign.demographics).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const occupationsList = campaign.occupations ? String(campaign.occupations).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const behaviorsList = campaign.behaviors ? String(campaign.behaviors).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const allDemographics = [...demographicsList, ...occupationsList];

  return (
    <Card>
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">
          Campaign {idx + 1}
        </span>
        <span className="text-sm font-medium text-text-primary">
          {campaign.project ?? selectedName}
        </span>
        {campaign.funnelStage && (
          <span className="text-xs text-text-tertiary">{String(campaign.funnelStage)}</span>
        )}
      </div>
      <div className="px-5 py-4 flex flex-col gap-5">
        {CAMPAIGN_SECTION_MAP.map((sec) => {
          const entries = sec.keys
            .filter((k) => campaign[k] != null && campaign[k] !== '')
            .map((k) => [k, campaign[k]] as [string, unknown]);
          if (!entries.length) return null;

          return (
            <div key={sec.title}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-brand mb-2 pb-1.5 border-b border-border">
                {sec.title}
              </p>
              {entries.map(([key, val]) => {
                const label = key.replace(/([A-Z])/g, ' $1').trim();
                const displayVal = Array.isArray(val) ? (val as string[]).join(', ') : String(val ?? '');
                return (
                  <div key={key} className="py-2 border-b border-border last:border-0 flex flex-col gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-text-tertiary capitalize">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-text-primary text-right">{displayVal || '—'}</span>
                        {displayVal && <CopyButton text={displayVal} />}
                      </div>
                    </div>
                    <InfoExpander reasoning={`Reasoning for "${label}" field.`} />
                  </div>
                );
              })}
            </div>
          );
        })}

        {(interestsList.length > 0 || allDemographics.length > 0 || behaviorsList.length > 0) && (
          <TargetingVerifier
            interests={interestsList}
            demographics={allDemographics}
            behaviors={behaviorsList}
            platform="Meta Ads Manager"
          />
        )}
      </div>
    </Card>
  );
}

function FullAiOutput({ data, inputs, projects, onSave }: { data: FullAiResult; inputs: FullStrategyInputs; projects: StrategyProject[]; onSave?: (d: FullAiResult) => void }) {
  const selected = projects.filter((p) => inputs.selectedProjectIds.includes(p.id));
  const campaigns = data.campaigns ?? [];

  return (
    <div className="flex flex-col gap-5">
      {data.overview && (
        <div className="px-4 py-3.5 rounded-xl bg-brand/10 border border-brand/20">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-1.5">Strategic Overview</p>
          <p className="text-sm text-text-primary leading-relaxed">{data.overview}</p>
        </div>
      )}
      {data.budgetAdvice && (
        <div className="px-4 py-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-1.5">Budget Advice</p>
          <p className="text-sm text-amber-300 leading-relaxed">{data.budgetAdvice}</p>
        </div>
      )}

      {campaigns.length > 0 ? (
        campaigns.map((campaign: FullAiCampaign, idx: number) => (
          <FullCampaignCard
            key={idx}
            campaign={campaign}
            idx={idx}
            selectedName={selected[idx]?.name ?? `Campaign ${idx + 1}`}
          />
        ))
      ) : (
        selected.map((project, idx) => (
          <Card key={project.id}>
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">
                Campaign {idx + 1}
              </span>
              <span className="text-sm font-medium text-text-primary">{project.name}</span>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-text-tertiary">No campaign data returned for this project.</p>
            </div>
          </Card>
        ))
      )}

      {data._aanyaBrief && (data.creativePrompt || data.creativePromptStory) && (
        <Card>
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <SectionLabel>Creative Prompts — Nanobanana (Gemini)</SectionLabel>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/10 border border-brand/20">
              <Sparkles size={11} className="text-brand" />
              <span className="text-[10px] font-semibold text-brand tracking-wide">
                Designed by Aanya — Senior Creative Director
              </span>
            </div>
          </div>
          <div className="px-5 py-4 flex flex-col gap-4">
            {data.creativePrompt && (
              <>
                <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-purple-400 uppercase tracking-wide">Feed (1080×1080)</span>
                    <CopyButton text={data.creativePrompt} />
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed italic">{data.creativePrompt}</p>
                </div>
                {data._aanyaBrief?.reference_image_manifest && data._aanyaBrief.reference_image_manifest.length > 0 && (
                  <ReferenceImagePack
                    manifest={data._aanyaBrief.reference_image_manifest as import('../../components/ReferenceImagePack').ReferenceManifestItem[]}
                    projectId={inputs.selectedProjectIds[0]}
                    promptLabel="Feed"
                  />
                )}
              </>
            )}
            {data.creativePromptStory && (
              <>
                <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-purple-400 uppercase tracking-wide">Story (1080×1920)</span>
                    <CopyButton text={data.creativePromptStory} />
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed italic">{data.creativePromptStory}</p>
                </div>
                {data._aanyaBrief?.reference_image_manifest && data._aanyaBrief.reference_image_manifest.length > 0 && (
                  <ReferenceImagePack
                    manifest={data._aanyaBrief.reference_image_manifest as import('../../components/ReferenceImagePack').ReferenceManifestItem[]}
                    projectId={inputs.selectedProjectIds[0]}
                    promptLabel="Story"
                  />
                )}
              </>
            )}
            <AanyaDesignerNotes brief={data._aanyaBrief} />
          </div>
        </Card>
      )}

      {onSave && campaigns.length > 0 && (
        <button
          onClick={() => onSave(data)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-brand/30 text-sm text-brand hover:bg-brand/10 transition-all self-start"
        >
          <Save size={14} />
          Save All Campaigns ({campaigns.length})
        </button>
      )}
    </div>
  );
}

function FullStrategyPlaceholder({ inputs, projects }: { inputs: FullStrategyInputs; projects: StrategyProject[] }) {
  const selected = projects.filter((p) => inputs.selectedProjectIds.includes(p.id));

  return (
    <div className="flex flex-col gap-5">
      <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300">
        AI generation will be enabled once API key is configured. Your strategy inputs have been captured.
      </div>
      <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
        Budget advice: ₹{inputs.monthlyBudget.toLocaleString('en-IN')}/mo across {selected.length}{' '}
        project{selected.length !== 1 ? 's' : ''} — approx ₹
        {Math.round(inputs.monthlyBudget / Math.max(selected.length, 1)).toLocaleString('en-IN')} per project.
      </div>
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <SectionLabel>Strategy Configuration</SectionLabel>
        </div>
        <div className="px-5 py-4 flex flex-col gap-0">
          <FieldRow label="Monthly Budget" value={`₹${inputs.monthlyBudget.toLocaleString('en-IN')}`} />
          <FieldRow label="Leads / Month" value={String(inputs.leadsPerMonth)} />
          <FieldRow label="Site Visits / Month" value={String(inputs.svsPerMonth)} />
          <FieldRow label="Bookings / Month" value={String(inputs.bookingsPerMonth)} />
          <FieldRow label="Scale" value={inputs.scale} />
          <FieldRow label="Odia Vernacular" value={inputs.enableOdia ? 'Enabled' : 'Disabled'} />
          <FieldRow label="Projects Selected" value={selected.map((p) => p.name).join(', ')} />
        </div>
      </Card>
    </div>
  );
}

interface GeneratedImageState {
  base64: string;
  mimeType: string;
  publicUrl?: string;
  assetId?: string;
  storagePath?: string;
  aspectRatio: '1:1' | '9:16';
}

function GeminiImageCard({ img }: { img: GeneratedImageState }) {
  const [urlCopied, setUrlCopied] = useState(false);
  const [canvaLoading, setCanvaLoading] = useState(false);
  const dataUrl = `data:${img.mimeType};base64,${img.base64}`;
  const label = img.aspectRatio === '9:16' ? 'Story (1080×1920)' : 'Feed (1080×1080)';

  function download() {
    const a = document.createElement('a');
    a.href = img.publicUrl ?? dataUrl;
    a.download = `aanya-creative-${img.aspectRatio.replace(':', 'x')}-${Date.now()}.${img.mimeType.split('/')[1] ?? 'png'}`;
    a.click();
  }

  async function openInCanva() {
    // If the image has a DB record, use the Canva API for a proper edit session
    if (img.assetId) {
      setCanvaLoading(true);
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const res = await fetch(`${supabaseUrl}/functions/v1/canva-open-editor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify({ creativeAssetId: img.assetId, userId: getUserId() }),
        });
        const json = await res.json() as { editUrl?: string; authUrl?: string; error?: string };
        if (json.editUrl) { window.open(json.editUrl, '_blank', 'noopener'); return; }
        if (json.authUrl) { window.location.href = json.authUrl; return; }
        if (json.error) throw new Error(json.error);
      } catch {
        // Fall through to clipboard-copy fallback
      } finally {
        setCanvaLoading(false);
      }
    }
    // Fallback: copy public URL so user can paste into Canva → Uploads → Upload from URL
    const urlToCopy = img.publicUrl ?? dataUrl;
    navigator.clipboard.writeText(urlToCopy).catch(() => {});
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 3000);
    window.open('https://www.canva.com/create/social-media/', '_blank', 'noopener');
  }

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-900/10 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-emerald-500/20 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">{label}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={download}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-text-primary border border-border hover:border-border/80 transition-all"
          >
            <Download size={12} /> Download
          </button>
          <button
            onClick={openInCanva}
            disabled={canvaLoading}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-60 ${urlCopied ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-[#7D2AE8] text-white hover:bg-[#6B22D0] border border-transparent'}`}
          >
            {canvaLoading
              ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <ExternalLink size={12} />}
            {canvaLoading ? 'Opening…' : urlCopied ? 'URL copied — paste in Canva!' : 'Edit in Canva'}
          </button>
        </div>
      </div>
      <img
        src={dataUrl}
        alt={`Gemini generated ${label}`}
        className="w-full object-contain max-h-[480px]"
      />
      {urlCopied && (
        <div className="px-4 py-2 bg-emerald-900/30 border-t border-emerald-500/20 text-xs text-emerald-300">
          In Canva: click <span className="font-semibold">Uploads → Upload from URL</span> and paste the image URL.
        </div>
      )}
    </div>
  );
}

function SeniorDesignerResultPanel({ data, languages, onRetry, savedId, project, projectId, funnelStage, onGeminiStateChange }: {
  data: SeniorDesignerResult;
  languages: string[];
  onRetry?: () => void;
  savedId?: string;
  project?: InlineReviewProject | null;
  projectId?: string;
  funnelStage?: string;
  onGeminiStateChange?: (active: boolean) => void;
}) {
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [geminiGenerating, setGeminiGenerating] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [brandColors, setBrandColors] = useState<{ primary: string; accent: string } | undefined>();
  // Stable session ID groups the feed+story pair in creative_assets
  const sessionIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    supabase.from('brand_kits').select('primary_color,secondary_color').eq('org_id', getOrgId()).maybeSingle()
      .then(({ data: bk }) => {
        if (bk?.primary_color) setBrandColors({ primary: bk.primary_color, accent: bk.secondary_color ?? '#c9a961' });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-generate images as soon as Aanya's prompt is available
  useEffect(() => {
    if (data.nanobanana_prompt_main) handleGenerateWithGemini();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyPrompt() {
    if (!data.nanobanana_prompt_main) return;
    navigator.clipboard.writeText(data.nanobanana_prompt_main).then(() => {
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    });
  }

  async function handleGenerateWithGemini() {
    if (!data.nanobanana_prompt_main) return;
    setGeminiGenerating(true);
    onGeminiStateChange?.(true);
    setGeminiError(null);
    setGalleryImages([]);
    // New regeneration gets a fresh session ID so storage paths don't collide
    sessionIdRef.current = crypto.randomUUID();

    try {
      const [feedResult, storyResult] = await Promise.allSettled([
        generateImageWithGemini(data.nanobanana_prompt_main, '1:1'),
        generateImageWithGemini(data.nanobanana_prompt_main, '9:16'),
      ]);

      const collected: GalleryImage[] = [];
      const generationErrors: string[] = [];

      for (const [result, ratio, label, angleLabel] of [
        [feedResult, '1:1', 'Feed (1080×1080)', 'feed'],
        [storyResult, '9:16', 'Story (1080×1920)', 'story'],
      ] as [PromiseSettledResult<Awaited<ReturnType<typeof generateImageWithGemini>>>, '1:1' | '9:16', string, string][]) {
        if (result.status === 'rejected') {
          generationErrors.push(String(result.reason instanceof Error ? result.reason.message : result.reason));
        }
        if (result.status === 'fulfilled' && result.value.length > 0) {
          const img = result.value[0];
          const dataUrl = `data:${img.mimeType};base64,${img.base64}`;
          let url = dataUrl;
          let id: string | undefined;
          let storagePath: string | undefined;
          try {
            const uploaded = await uploadGeminiImageToSupabase(img.base64, img.mimeType, {
              sessionId: sessionIdRef.current,
              angleLabel: data.creative_concept ? `${data.creative_concept}-${angleLabel}` : angleLabel,
              funnelStage: funnelStage ?? 'BOFU',
              projectId,
            });
            url = uploaded.url;
            id = uploaded.id;
            storagePath = uploaded.storagePath;
          } catch {
            // non-fatal — fall back to base64 data URL
          }
          collected.push({
            id, url, label, storagePath,
            promptUsed: data.nanobanana_prompt_main,
            adCopy: {
              headline: data.ad_copy?.headline_english,
              cta: data.ad_copy?.cta,
            },
          });
        }
      }

      if (collected.length === 0) {
        const detail = generationErrors.length > 0 ? ` — ${generationErrors[0]}` : '';
        setGeminiError(`Image generation failed${detail || '. The service may be temporarily busy — try again.'}`);
      } else {
        setGalleryImages(collected);
      }
    } catch (err) {
      setGeminiError(err instanceof Error ? err.message : 'Image generation failed.');
    } finally {
      setGeminiGenerating(false);
      onGeminiStateChange?.(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Creative Concept */}
      {data.creative_concept && (
        <div className="bg-gradient-to-br from-emerald-900/20 to-teal-900/20 border border-emerald-500/30 rounded-xl p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 mb-2">Creative Concept</div>
          <div className="text-lg font-semibold text-text-primary leading-snug">{data.creative_concept}</div>
        </div>
      )}

      {/* Designer Rationale */}
      {data.designer_rationale && (
        <Card className="p-5">
          <SectionLabel>Designer Rationale (Aanya's POV)</SectionLabel>
          <p className="text-sm text-text-primary leading-relaxed">{data.designer_rationale}</p>
        </Card>
      )}

      {/* Generated images — auto-triggered, shown in the full gallery viewer */}
      {geminiGenerating && (
        <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <Loader2 size={16} className="animate-spin text-amber-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-300">Generating Feed + Story images with FLUX…</p>
            <p className="text-xs text-text-tertiary mt-0.5">This usually takes 10–20 seconds.</p>
          </div>
        </div>
      )}

      {geminiError && (
        <div className="flex flex-col items-center gap-4 px-6 py-8 rounded-xl bg-surface-elevated border border-border">
          <div className="w-14 h-14 rounded-2xl bg-surface-sunken border border-border flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="11" stroke="#4b5563" strokeWidth="1.5" strokeDasharray="3 2"/>
              <path d="M9 14 Q14 8 19 14 Q14 20 9 14Z" stroke="#4b5563" strokeWidth="1.5" fill="none"/>
              <line x1="7" y1="7" x2="21" y2="21" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-text-primary">Image generation failed</p>
            <p className="text-xs text-text-tertiary mt-1 max-w-xs">{geminiError}</p>
          </div>
          {data.nanobanana_prompt_main && (
            <div className="flex items-center gap-2">
              <button
                onClick={copyPrompt}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${promptCopied ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'border-border text-text-tertiary hover:text-text-primary'}`}
              >
                {promptCopied ? <CheckCircle size={12} /> : <Copy size={12} />}
                {promptCopied ? 'Copied!' : 'Copy Prompt'}
              </button>
              <button
                onClick={handleGenerateWithGemini}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-text-tertiary hover:text-text-primary transition-all"
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}
        </div>
      )}

      {galleryImages.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-surface-elevated" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Generated Creatives</span>
            <div className="h-px flex-1 bg-surface-elevated" />
          </div>
          <ImageGalleryViewer images={galleryImages} brandColors={brandColors} />
          {data.nanobanana_prompt_main && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-surface-elevated">
                <button
                  onClick={() => setPromptExpanded((p) => !p)}
                  className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors"
                >
                  <ChevronDown size={12} className={`transition-transform duration-150 ${promptExpanded ? 'rotate-180' : ''}`} />
                  Aanya's prompt
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={copyPrompt}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${promptCopied ? 'text-emerald-300' : 'text-text-tertiary hover:text-text-primary'}`}
                  >
                    {promptCopied ? <CheckCircle size={11} /> : <Copy size={11} />}
                    {promptCopied ? 'Copied' : 'Copy'}
                  </button>
                  {!geminiGenerating && (
                    <button
                      onClick={handleGenerateWithGemini}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-text-tertiary hover:text-text-primary transition-colors"
                    >
                      <RefreshCw size={11} /> Regenerate
                    </button>
                  )}
                </div>
              </div>
              {promptExpanded && (
                <pre className="px-4 py-3 text-xs text-text-primary whitespace-pre-wrap font-mono max-h-40 overflow-y-auto bg-black/30 leading-relaxed border-t border-border">
                  {data.nanobanana_prompt_main}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reference Image Manifest */}
      {Array.isArray(data.reference_image_manifest) && data.reference_image_manifest.length > 0 && (
        <Card className="p-5">
          <SectionLabel>Upload These Images to Nanobanana (in order)</SectionLabel>
          <ol className="space-y-3">
            {data.reference_image_manifest.map((ref, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-brand/20 border border-brand/30 text-brand text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <span className="text-sm font-semibold text-emerald-300">[{String(ref.role)}]</span>
                  <span className="text-sm text-text-primary ml-2">{String(ref.instruction)}</span>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Ad Copy — all languages */}
      {data.ad_copy && (
        <Card className="p-5">
          <SectionLabel>Ad Copy</SectionLabel>
          <div className="space-y-4">
            {languages.map((lang) => {
              const k = lang.toLowerCase();
              const headline = data.ad_copy?.[`headline_${k}`];
              const subhead = data.ad_copy?.[`subhead_${k}`];
              const primaryText = data.ad_copy?.[`primary_text_${k}`];
              if (!headline && !subhead && !primaryText) return null;
              return (
                <div key={lang} className="pb-4 border-b border-border last:border-0">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">{lang}</div>
                  {headline && (
                    <div className="mb-2">
                      <span className="text-[10px] text-text-tertiary uppercase tracking-wide mr-2">Headline:</span>
                      <span className="text-sm font-semibold text-text-primary">{headline}</span>
                    </div>
                  )}
                  {subhead && (
                    <div className="mb-2">
                      <span className="text-[10px] text-text-tertiary uppercase tracking-wide mr-2">Subhead:</span>
                      <span className="text-sm text-text-primary">{subhead}</span>
                    </div>
                  )}
                  {primaryText && (
                    <div>
                      <span className="text-[10px] text-text-tertiary uppercase tracking-wide block mb-1">Primary Text:</span>
                      <p className="text-sm text-text-primary leading-relaxed">{primaryText}</p>
                    </div>
                  )}
                </div>
              );
            })}
            {data.ad_copy.cta && (
              <div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wide mr-2">CTA:</span>
                <span className="text-sm font-semibold text-emerald-300">{data.ad_copy.cta}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Post-production notes */}
      {data.post_production_notes && (
        <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-400 mb-2">Post-Production Notes</div>
          <p className="text-sm text-black leading-relaxed">{data.post_production_notes}</p>
        </div>
      )}

      {/* Design DNA tags */}
      {data.design_dna_tags && Object.keys(data.design_dna_tags).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.design_dna_tags).map(([key, val]) => (
            <span key={key} className="px-2.5 py-1 bg-surface-elevated border border-border rounded-full text-xs text-text-tertiary">
              <span className="text-text-tertiary">{key}:</span> {String(val)}
            </span>
          ))}
        </div>
      )}

      {savedId && (
        <InlineCreativeReview
          project={project ?? null}
          context={{
            platform: 'Nanobanana (Gemini)',
            headline: data.ad_copy?.headline_english,
            idea: data.creative_concept,
          }}
          label="Review Your Generated Creative"
          creativeId={savedId}
        />
      )}

      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-2 text-sm text-text-tertiary hover:text-text-primary transition-colors">
          <RefreshCw size={14} /> Regenerate
        </button>
      )}
    </div>
  );
}

export function StrategyResultPanel({ result, onRetry, onSaveQuick, onSaveFull, quickProject, onGeminiStateChange }: StrategyResultProps) {
  if (!result) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <div className="h-px flex-1 bg-emerald-200" />
        <span className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Result</span>
        <div className="h-px flex-1 bg-emerald-200" />
      </div>

      {result.type === 'quick_senior' && (() => {
        if (result.error) return <ErrorBanner message={result.error} onRetry={onRetry} />;
        if (result.aiData) {
          const goal = result.inputs.campaignGoal;
          const funnel = (goal === 'awareness' || goal === 'branding') ? 'TOFU' : goal === 'engagement' ? 'MOFU' : 'BOFU';
          return <SeniorDesignerResultPanel
            data={result.aiData}
            languages={result.inputs.languages}
            onRetry={onRetry}
            savedId={result.savedId}
            project={quickProject}
            projectId={result.inputs.projectId !== 'custom' ? result.inputs.projectId : undefined}
            funnelStage={funnel}
            onGeminiStateChange={onGeminiStateChange}
          />;
        }
        return <ErrorBanner message="No result returned." onRetry={onRetry} />;
      })()}

      {result.type === 'quick' && (() => {
        if (result.error) return <ErrorBanner message={result.error} onRetry={onRetry} />;
        if (result.rawText) return <RawTextFallback text={result.rawText} onRetry={onRetry} />;
        if (result.aiData) {
          if (result.isMeta) {
            return <MetaAiOutput data={result.aiData as MetaAiResult} inputs={result.inputs} onSave={onSaveQuick} project={quickProject} />;
          }
          return <QuickAiOutput data={result.aiData as QuickAiResult} inputs={result.inputs} onSave={onSaveQuick} project={quickProject} />;
        }
        return <QuickGeneratePlaceholder inputs={result.inputs} projectName={result.projectName} />;
      })()}

      {result.type === 'full' && (() => {
        if (result.error) return <ErrorBanner message={result.error} onRetry={onRetry} />;
        if (result.rawText) return <RawTextFallback text={result.rawText} onRetry={onRetry} />;
        if (result.aiData)
          return <FullAiOutput data={result.aiData} inputs={result.inputs} projects={result.projects} onSave={onSaveFull} />;
        return <FullStrategyPlaceholder inputs={result.inputs} projects={result.projects} />;
      })()}
    </div>
  );
}

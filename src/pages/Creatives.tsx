import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, BookOpen, ChevronDown, ChevronUp, Palette, RefreshCw, Save, Upload, X } from 'lucide-react';
import { InlineCreativeReview, type InlineReviewProject } from '../components/InlineCreativeReview';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import { aiCall, aiVision, isAiEnabled } from '../lib/ai-service';
import { buildVariantBriefs } from '../lib/senior-designer-prompts';
import type { SeniorDesignerResult } from './strategy/types';
import { AanyaDesignerNotes } from './strategy/StrategyResult';
import { logAiSession, logActivity } from '../lib/session-logger';
import { buildContext } from '../lib/context-builder';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { CopyButton } from '../components/ui/CopyButton';
import { Spinner } from '../components/ui/Spinner';
import { useNavigation } from '../contexts/NavigationContext';

interface Project {
  id: string;
  name: string;
  locality?: string;
  city?: string;
  price_range_lacs?: string;
  usps?: string;
}

interface AiVariant {
  variant: string;
  angle: string;
  why: string;
  format: string;
  primaryText: string;
  odiaText?: string;
  headline: string;
  description: string;
  cta?: string;
  nanoPrompt: string;
  nanoStory?: string;
  hashtags: string[];
  bestTime?: string;
  _aanyaBrief?: SeniorDesignerResult;
}

interface AiCreativesResult {
  strategy?: string;
  variants?: AiVariant[];
  shootList?: string[];
  refresh?: string;
}

type ResultState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'raw'; text: string }
  | { status: 'ok'; data: AiCreativesResult };

const FUNNEL_OPTIONS = [
  { value: 'TOFU', label: 'TOFU — Top of Funnel' },
  { value: 'MOFU', label: 'MOFU — Middle of Funnel' },
  { value: 'BOFU', label: 'BOFU — Bottom of Funnel' },
];

const PLATFORM_OPTIONS = [
  { value: 'Nanobanana (Gemini)', label: 'Nanobanana (Gemini)' },
  { value: 'ChatGPT / DALL-E', label: 'ChatGPT / DALL-E' },
  { value: 'Midjourney', label: 'Midjourney' },
  { value: 'Canva', label: 'Canva' },
  { value: 'Manual / Designer', label: 'Manual / Designer' },
];

interface LibraryCreative {
  id: string;
  variant?: string;
  angle?: string;
  format?: string;
  headline?: string;
  primary_text?: string;
  primary_text_odia?: string;
  nano_prompt?: string;
  nano_prompt_story?: string;
  platform_used?: string;
  review_score?: number;
  status?: string;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-[#1e2e24] text-text-tertiary border-border',
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  retired: 'bg-red-500/10 text-red-400 border-red-500/20',
};

function charCountColor(len: number, limit: number): string {
  if (len <= limit) return 'text-emerald-400';
  if (len <= Math.round(limit * 1.12)) return 'text-amber-400';
  return 'text-red-400';
}

function CharCounter({ len, limit }: { len: number; limit: number }) {
  return (
    <span className={`text-[10px] font-mono ${charCountColor(len, limit)}`}>
      {len}/{limit}
    </span>
  );
}

async function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ data: result.split(',')[1], mimeType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
      <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-red-300 flex-1">{message}</p>
      <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors flex-shrink-0">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

function RawFallback({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <p className="text-sm text-amber-300">Response received but could not be parsed as structured data.</p>
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 ml-3 transition-colors flex-shrink-0">
          <RefreshCw size={12} /> Retry
        </button>
      </div>
      <Card className="p-4">
        <pre className="text-xs text-text-primary whitespace-pre-wrap font-mono leading-relaxed overflow-auto max-h-96">{text}</pre>
      </Card>
    </div>
  );
}

function PurpleCard({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">{label}</p>
      <div className="rounded-lg border p-4 flex items-start gap-3" style={{ background: '#7c3aed10', borderColor: '#7c3aed30' }}>
        <p className="text-xs text-text-primary leading-relaxed flex-1 font-mono">{text}</p>
        <CopyButton text={text} />
      </div>
    </div>
  );
}

function VariantCard({ variant, onSave, project, platform }: { variant: AiVariant; onSave?: (v: AiVariant) => void; project?: InlineReviewProject | null; platform?: string }) {
  return (
    <Card>
      <div className="px-5 py-4 border-b border-border flex items-center gap-4">
        <div className="w-9 h-9 rounded-lg bg-[#2dd4a8]/10 border border-[#2dd4a8]/20 flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-bold text-brand">{variant.variant}</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">{variant.angle}</p>
          <p className="text-[11px] text-text-tertiary">{variant.format}{variant.bestTime ? ` · ${variant.bestTime}` : ''}</p>
        </div>
        {variant.why && <p className="text-xs text-text-tertiary max-w-xs text-right leading-relaxed">{variant.why}</p>}
        {onSave && (
          <button
            onClick={() => onSave(variant)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2dd4a8]/30 text-xs text-brand hover:bg-[#2dd4a8]/10 transition-all flex-shrink-0"
          >
            <Save size={12} /> Save
          </button>
        )}
      </div>

      <div className="px-5 py-5 flex flex-col gap-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Primary Text</p>
              <CharCounter len={variant.primaryText?.length ?? 0} limit={250} />
            </div>
            <CopyButton text={variant.primaryText} />
          </div>
          <p className="text-sm text-text-primary leading-relaxed bg-surface rounded-lg p-3 border border-border">{variant.primaryText}</p>
          <p className={`text-[10px] mt-1 font-mono ${charCountColor(variant.primaryText?.length ?? 0, 125)}`}>
            {variant.primaryText?.length ?? 0}/125 visible before &ldquo;See more&rdquo;
          </p>
        </div>

        {variant.odiaText && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Odia Text</p>
              <CopyButton text={variant.odiaText} />
            </div>
            <p className="text-sm text-text-primary leading-relaxed bg-surface rounded-lg p-3 border border-border">{variant.odiaText}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Headline</p>
                <CharCounter len={variant.headline?.length ?? 0} limit={25} />
              </div>
              <CopyButton text={variant.headline} />
            </div>
            <p className="text-sm text-text-primary bg-surface rounded-lg p-3 border border-border">{variant.headline}</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Description</p>
                <CharCounter len={variant.description?.length ?? 0} limit={30} />
              </div>
              <CopyButton text={variant.description} />
            </div>
            <p className="text-sm text-text-primary bg-surface rounded-lg p-3 border border-border">{variant.description}</p>
          </div>
        </div>

        <PurpleCard label="Nanobanana (1080x1080)" text={variant.nanoPrompt} />
        {variant.nanoStory && <PurpleCard label="Story (1080x1920)" text={variant.nanoStory} />}

        <InlineCreativeReview
          project={project ?? null}
          context={{
            platform: platform || 'Nanobanana (Gemini)',
            headline: variant.headline,
            idea: variant.angle,
          }}
          label={`Review Variant ${variant.variant} Creative`}
        />

        {variant.hashtags && variant.hashtags.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Hashtags</p>
            <div className="flex flex-wrap gap-1.5">
              {variant.hashtags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-md text-[11px] text-text-tertiary border border-border bg-surface">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {variant._aanyaBrief && <AanyaDesignerNotes brief={variant._aanyaBrief} />}
      </div>
    </Card>
  );
}

function AiCreativesOutput({ data, onRetry, onSaveVariant, project, platform }: { data: AiCreativesResult; onRetry: () => void; onSaveVariant?: (v: AiVariant) => void; project?: InlineReviewProject | null; platform?: string }) {
  return (
    <div className="flex flex-col gap-5">
      {data.strategy && (
        <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300">
          <span className="font-semibold">Strategy: </span>{data.strategy}
        </div>
      )}

      {data.variants && data.variants.map((v) => <VariantCard key={v.variant} variant={v} onSave={onSaveVariant} project={project} platform={platform} />)}

      {data.shootList && data.shootList.length > 0 && (
        <Card className="p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Shoot List</p>
          <ul className="flex flex-col gap-1.5">
            {data.shootList.map((shot, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                <span className="text-brand flex-shrink-0 mt-0.5">•</span>{shot}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.refresh && (
        <div className="px-4 py-3 rounded-xl bg-[#1e2e24] border border-[#2e3e34] text-sm text-text-tertiary">
          <span className="font-semibold text-text-primary">Refresh Recommendation: </span>{data.refresh}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-brand transition-colors">
          <RefreshCw size={12} /> Regenerate
        </button>
      </div>
    </div>
  );
}

export function Creatives() {
  const { navigate } = useNavigation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [funnelStage, setFunnelStage] = useState('TOFU');
  const [creativePlatform, setCreativePlatform] = useState('Nanobanana (Gemini)');
  const [image, setImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResultState>({ status: 'idle' });
  const { showToast } = useToast();
  const [library, setLibrary] = useState<LibraryCreative[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    const { data } = await supabase
      .from('creatives')
      .select('id,variant,angle,format,headline,primary_text,primary_text_odia,nano_prompt,nano_prompt_story,platform_used,review_score,status,created_at')
      .eq('org_id', getOrgId())
      .order('created_at', { ascending: false })
      .limit(20);
    setLibrary((data ?? []) as LibraryCreative[]);
    setLibraryLoading(false);
  }, []);

  useEffect(() => {
    async function load() {
      setProjectsLoading(true);
      const { data } = await supabase
        .from('projects')
        .select('id,name,locality,city,price_range_lacs,usps')
        .eq('is_active', true)
        .eq('org_id', getOrgId())
        .order('name');
      const rows = (data ?? []) as Project[];
      setProjects(rows);
      if (rows.length > 0) setProjectId(rows[0].id);
      setProjectsLoading(false);
    }
    load();
    loadLibrary();
  }, [loadLibrary]);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImage(e.target.files?.[0] ?? null);
    setResult({ status: 'idle' });
  }

  function removeImage() {
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setResult({ status: 'idle' });
  }

  function saveVariant(variant: AiVariant) {
    supabase
      .from('creatives')
      .insert({
        org_id: getOrgId(),
        project_id: projectId || null,
        created_by: 'dev-user-001',
        variant: variant.variant,
        angle: variant.angle,
        format: variant.format,
        language: 'English',
        primary_text: variant.primaryText,
        primary_text_odia: variant.odiaText,
        headline: variant.headline,
        description: variant.description,
        cta: variant.cta,
        nano_prompt: variant.nanoPrompt,
        nano_prompt_story: variant.nanoStory,
        platform_used: creativePlatform,
        status: 'draft',
      })
      .then(({ error }) => {
        if (error) {
          showToast('Failed to save creative', 'error');
        } else {
          showToast('Creative saved to library!', 'success');
          loadLibrary();
        }
      });
  }

  async function handleGenerate() {
    setSubmitting(true);
    setResult({ status: 'idle' });

    try {
      if (!isAiEnabled()) {
        setResult({ status: 'error', message: 'Add your Claude API key in Settings to generate creative variants.' });
        setSubmitting(false);
        return;
      }

      const project = projects.find((p) => p.id === projectId);
      const isNanobanana = creativePlatform.toLowerCase().includes('nanobanana');

      if (isNanobanana) {
        // ── AANYA 3-VARIANT PATH (Promise.allSettled — partial failures degrade gracefully) ──
        const userBrief = [
          `Generate a high-converting real estate ad creative for the ${funnelStage} funnel stage.`,
          project ? `Project: ${project.name}${project.locality ? ` in ${project.locality}` : ''}${project.city ? `, ${project.city}` : ''}.` : '',
          image ? 'A reference image has been uploaded — incorporate its visual style.' : '',
        ].filter(Boolean).join(' ');

        const briefs = await buildVariantBriefs({
          project_id: projectId,
          user_brief: userBrief,
          funnel_stage: funnelStage as 'TOFU' | 'MOFU' | 'BOFU',
          languages: ['English', 'Odia'],
        });

        const imagePayload = image ? await fileToBase64(image) : null;

        const angleLabels = [
          'Price-led with Urgency',
          'Lifestyle / Aspirational',
          'Trust & Legacy / Amenities',
        ] as const;

        console.log('🎨 [AANYA-VARIANTS] Generating 3 variants sequentially (avoids Anthropic API rate limits)...');
        const settled: PromiseSettledResult<SeniorDesignerResult>[] = [];
        for (let i = 0; i < briefs.length; i++) {
          if (i > 0) {
            await new Promise((r) => setTimeout(r, 500));
          }
          const brief = briefs[i];
          const tag = `[AANYA-VARIANT-${String.fromCharCode(65 + i)}]`;
          try {
            console.log(`🎨 ${tag} system prompt length:`, brief.systemPrompt.length);
            console.log(`🎨 ${tag} user prompt brand check:`, {
              has_INVIOLABLE: brief.userPrompt.includes('INVIOLABLE') || brief.systemPrompt.includes('INVIOLABLE'),
            });

            let aanyaRes: Record<string, unknown>;
            if (imagePayload) {
              const messages = [
                {
                  role: 'user',
                  content: [
                    { type: 'image', source: { type: 'base64', media_type: imagePayload.mimeType, data: imagePayload.data } },
                    { type: 'text', text: brief.userPrompt },
                  ],
                },
              ];
              aanyaRes = await aiVision(messages, brief.systemPrompt);
            } else {
              aanyaRes = await aiCall(brief.userPrompt, brief.systemPrompt, 16000);
            }

            console.log(`🎨 ${tag} response keys:`, Object.keys(aanyaRes));
            if (aanyaRes.error) throw new Error(String(aanyaRes.error));

            let parsed: SeniorDesignerResult;
            if (aanyaRes.raw) {
              const s = String(aanyaRes.raw);
              try { parsed = JSON.parse(s); }
              catch {
                try { parsed = JSON.parse(s.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); }
                catch {
                  const st = s.indexOf('{'); const en = s.lastIndexOf('}');
                  if (st !== -1 && en !== -1) { parsed = JSON.parse(s.substring(st, en + 1)); }
                  else { throw new Error(`Could not parse ${tag} response`); }
                }
              }
            } else {
              parsed = aanyaRes as SeniorDesignerResult;
            }

            console.log(`✅ ${tag} parsed successfully`);
            settled.push({ status: 'fulfilled', value: parsed });
          } catch (err) {
            settled.push({ status: 'rejected', reason: err });
          }
        }

        const aiVariants: AiVariant[] = settled.map((s, i) => {
          const label = String.fromCharCode(65 + i);
          const angle = angleLabels[i];
          if (s.status === 'rejected') {
            console.warn(`⚠️ [AANYA-VARIANT-${label}] failed:`, s.reason);
            return {
              variant: label,
              angle,
              why: `Variant ${label} generation failed — see console.`,
              format: 'Single Image',
              primaryText: '',
              headline: '',
              description: '',
              nanoPrompt: '',
              hashtags: [],
            };
          }
          const parsed = s.value;
          const adCopy = parsed.ad_copy ?? {};
          return {
            variant: label,
            angle,
            why: parsed.designer_rationale ?? parsed.creative_concept ?? '',
            format: 'Single Image',
            primaryText: String(adCopy.primary_text_english ?? ''),
            odiaText: adCopy.primary_text_odia ? String(adCopy.primary_text_odia) : undefined,
            headline: String(adCopy.headline_english ?? ''),
            description: String(adCopy.subhead_english ?? ''),
            cta: String(adCopy.cta ?? 'Send WhatsApp Message'),
            nanoPrompt: parsed.nanobanana_prompt_main ?? '',
            nanoStory: parsed.nanobanana_prompt_story,
            hashtags: [],
            _aanyaBrief: parsed,
          };
        });

        const successCount = settled.filter((s) => s.status === 'fulfilled').length;
        if (successCount === 0) {
          setResult({ status: 'error', message: 'All 3 Aanya variant generations failed. See console for details.' });
        } else {
          setResult({
            status: 'ok',
            data: {
              strategy: successCount === 3
                ? 'Aanya generated all 3 variants — designed for Nanobanana (Gemini).'
                : `Aanya generated ${successCount}/3 variants. Failed variants are shown with empty fields — regenerate to retry.`,
              variants: aiVariants,
            },
          });

          logAiSession(supabase, {
            sessionType: 'creative',
            projectIds: [projectId],
            inputSummary: `Aanya 3-variant creatives for ${project?.name ?? ''} ${funnelStage}`,
            outputData: { variants: aiVariants } as Record<string, unknown>,
          });
          logActivity(supabase, {
            action: 'generated_creatives',
            entityType: 'ai_session',
            details: { project: project?.name ?? '', funnel: funnelStage, hasReferenceImage: !!image, source: 'aanya_3_variant', successCount },
          });
        }
      } else {
        // ── LEGACY PATH (non-Nanobanana platforms — unchanged) ──
        const context = await buildContext({ projectId });
        const basePromptText = `Generate 3 creative variants for ${funnelStage} real estate ad. Write REAL content.
PROJECT: ${project?.name ?? 'Unknown'} | ${project?.locality ?? ''}, ${project?.city ?? ''} | Price: ${project?.price_range_lacs ?? 'N/A'} Lacs | USPs: ${project?.usps ?? 'N/A'}
VERNACULAR: Odia enabled
${image ? 'REFERENCE IMAGE: Analyze uploaded image style. Match it in prompts.' : ''}

CRITICAL: primaryText = REAL 150-250 char copy with emojis. headline = REAL 25 chars. nanoPrompt = COMPLETE image generation prompt.

Return ONLY a JSON object:
{"strategy":"which variant first and why","variants":[{"variant":"A","angle":"angle name","why":"rationale","format":"Single Image","primaryText":"ACTUAL 150-250 CHAR COPY","odiaText":"ACTUAL ODIA","headline":"ACTUAL 25 CHAR","description":"ACTUAL 30 CHAR","cta":"Send WhatsApp Message","nanoPrompt":"COMPLETE 1080x1080 prompt with visual style, colors hex, text overlay, layout, logo top-left","nanoStory":"COMPLETE 1080x1920 prompt","hashtags":["15 real tags"],"bestTime":"time"}],"shootList":["video shot if needed"],"refresh":"when to refresh"}`;
        const promptText = context ? basePromptText + '\n\n' + context : basePromptText;

        let res: Record<string, unknown>;

        if (image) {
          const { data: b64data, mimeType } = await fileToBase64(image);
          const messages = [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64data } },
                { type: 'text', text: promptText },
              ],
            },
          ];
          res = await aiVision(messages, 'You are a real estate ad creative director. Analyze reference image. Respond ONLY in valid JSON.');
        } else {
          res = await aiCall(promptText);
        }

        if (res.error) {
          setResult({ status: 'error', message: String(res.error) });
        } else if (res.raw) {
          setResult({ status: 'raw', text: String(res.raw) });
        } else {
          setResult({ status: 'ok', data: res as AiCreativesResult });
          logAiSession(supabase, {
            sessionType: 'creative',
            projectIds: [projectId],
            inputSummary: `Creatives for ${project?.name ?? ''} ${funnelStage}`,
            outputData: res,
          });
          logActivity(supabase, {
            action: 'generated_creatives',
            entityType: 'ai_session',
            details: { project: project?.name ?? '', funnel: funnelStage, hasReferenceImage: !!image },
          });
        }
      }
    } catch (err: unknown) {
      setResult({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }

    setSubmitting(false);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center gap-3 mb-7">
        <Palette size={20} className="text-brand" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Creatives</h1>
          <p className="text-text-tertiary text-xs mt-0.5">Generate ad copy variants with AI creative prompts</p>
        </div>
      </div>

      {!projectsLoading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-dashed border-border mb-6 text-center gap-3">
          <Palette size={32} className="text-[#1e2e24]" />
          <p className="text-sm text-text-tertiary">No projects found. Add a project first to generate creatives.</p>
          <button
            onClick={() => navigate('projects')}
            className="px-4 py-2 rounded-lg bg-[#2dd4a8]/10 border border-[#2dd4a8]/20 text-sm text-brand hover:bg-[#2dd4a8]/15 transition-all"
          >
            Go to Projects
          </button>
        </div>
      )}

      <Card className="p-5 mb-6">
        <div className="grid grid-cols-2 gap-5 mb-5">
          <div className="flex flex-col gap-4">
            {projectsLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Spinner size="sm" />
                <span className="text-xs text-text-tertiary">Loading projects…</span>
              </div>
            ) : (
              <Select label="Project" options={projectOptions} value={projectId} onChange={(e) => { setProjectId(e.target.value); setResult({ status: 'idle' }); }} />
            )}
            <Select label="Funnel Stage" options={FUNNEL_OPTIONS} value={funnelStage} onChange={(e) => { setFunnelStage(e.target.value); setResult({ status: 'idle' }); }} />
            <Select label="Creative Platform" options={PLATFORM_OPTIONS} value={creativePlatform} onChange={(e) => setCreativePlatform(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Reference Image</label>
            <p className="text-[11px] text-text-tertiary -mt-0.5 mb-1">Upload a sample ad or project photo — AI will match the style</p>
            {image ? (
              <div className="flex items-center gap-4 bg-surface border border-border rounded-lg p-3">
                <img src={URL.createObjectURL(image)} alt="Reference" className="w-14 h-14 object-cover rounded-lg flex-shrink-0" />
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <span className="text-xs text-text-primary truncate">{image.name}</span>
                  <button onClick={removeImage} className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors w-fit">
                    <X size={11} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-2 py-6 rounded-lg border border-dashed border-border hover:border-[#2dd4a8]/40 hover:bg-[#2dd4a8]/[0.02] transition-all">
                <Upload size={18} className="text-text-tertiary" />
                <span className="text-xs text-text-tertiary">Click to upload image</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
          </div>
        </div>

        <Button onClick={handleGenerate} disabled={submitting || !projectId} className="w-full py-2.5">
          {submitting ? <Spinner size="sm" /> : <Palette size={14} />}
          {submitting ? 'Generating…' : 'Generate 3 Variants'}
        </Button>
      </Card>

      {result.status !== 'idle' && (
        <div ref={resultRef} className="flex flex-col gap-5">
          {result.status === 'error' && <ErrorBanner message={result.message} onRetry={handleGenerate} />}
          {result.status === 'raw' && <RawFallback text={result.text} onRetry={handleGenerate} />}
          {result.status === 'ok' && (
            <AiCreativesOutput
              data={result.data}
              onRetry={handleGenerate}
              onSaveVariant={saveVariant}
              project={projects.find((p) => p.id === projectId) ?? null}
              platform={creativePlatform}
            />
          )}
        </div>
      )}

      <div className="mt-10">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-px flex-1 bg-[#1e2e24]" />
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-text-tertiary" />
            <span className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">
              Creative Library {library.length > 0 ? `(${library.length})` : ''}
            </span>
          </div>
          <div className="h-px flex-1 bg-[#1e2e24]" />
        </div>

        {libraryLoading ? (
          <div className="flex items-center gap-2 py-4">
            <Spinner size="sm" />
            <span className="text-xs text-text-tertiary">Loading library…</span>
          </div>
        ) : library.length === 0 ? (
          <div className="px-5 py-10 text-center rounded-xl border border-dashed border-border">
            <p className="text-sm text-text-tertiary">No creatives saved yet. Generate variants above and save them to build your library.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {library.map((c) => {
              const isExpanded = expandedId === c.id;
              const scoreColor = !c.review_score ? '' : c.review_score >= 8 ? 'text-emerald-400' : c.review_score >= 5 ? 'text-amber-400' : 'text-red-400';
              const statusCls = STATUS_COLOR[c.status ?? 'draft'] ?? STATUS_COLOR.draft;
              return (
                <Card key={c.id} className="flex flex-col">
                  <div className="px-4 py-4 flex items-start gap-3">
                    {c.variant && (
                      <div className="w-8 h-8 rounded-lg bg-[#2dd4a8]/10 border border-[#2dd4a8]/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-brand">{c.variant}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        {c.angle && <span className="text-sm font-semibold text-text-primary">{c.angle}</span>}
                        {c.format && <span className="text-[11px] text-text-tertiary">{c.format}</span>}
                      </div>
                      {c.headline && <p className="text-xs font-medium text-text-primary mb-1">{c.headline}</p>}
                      {c.primary_text && (
                        <p className="text-[11px] text-text-tertiary leading-relaxed">
                          {c.primary_text.slice(0, 80)}{c.primary_text.length > 80 ? '…' : ''}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {c.platform_used && (
                          <span className="text-[10px] text-text-tertiary border border-border px-1.5 py-0.5 rounded">{c.platform_used}</span>
                        )}
                        {c.review_score != null && (
                          <span className={`text-[10px] font-semibold ${scoreColor}`}>{c.review_score}/10</span>
                        )}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border capitalize ${statusCls}`}>{c.status ?? 'draft'}</span>
                        <span className="text-[10px] text-[#4a6558]">{timeAgo(c.created_at)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : c.id)}
                      className="text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0 mt-0.5"
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-border flex flex-col gap-3 mt-0">
                      {c.primary_text && (
                        <div className="pt-3">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Full Primary Text</p>
                          <p className="text-xs text-text-primary leading-relaxed bg-surface rounded-lg p-3 border border-border">{c.primary_text}</p>
                        </div>
                      )}
                      {c.primary_text_odia && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Odia Text</p>
                          <p className="text-xs text-text-primary leading-relaxed bg-surface rounded-lg p-3 border border-border">{c.primary_text_odia}</p>
                        </div>
                      )}
                      {c.nano_prompt && (
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Nanobanana (1080x1080)</p>
                            <CopyButton text={c.nano_prompt} />
                          </div>
                          <p className="text-xs text-text-primary font-mono leading-relaxed bg-surface rounded-lg p-3 border border-border">{c.nano_prompt}</p>
                        </div>
                      )}
                      {c.nano_prompt_story && (
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Story (1080x1920)</p>
                            <CopyButton text={c.nano_prompt_story} />
                          </div>
                          <p className="text-xs text-text-primary font-mono leading-relaxed bg-surface rounded-lg p-3 border border-border">{c.nano_prompt_story}</p>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

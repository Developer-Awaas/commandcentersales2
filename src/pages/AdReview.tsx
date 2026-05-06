import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Eye, RefreshCw, Save, Upload, X } from 'lucide-react';
import { useChatbot } from '../contexts/ChatbotContext';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import { aiVision, isAiEnabled } from '../lib/ai-service';
import { logAiSession, logActivity } from '../lib/session-logger';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { CopyButton } from '../components/ui/CopyButton';
import { Spinner } from '../components/ui/Spinner';

interface ProjectConfiguration {
  type: string;
  carpet: string;
  price_lacs: string;
  total_units: number | null;
  remaining_units: number | null;
  available: boolean;
  notes: string;
}

interface Project {
  id: string;
  name: string;
  locality?: string;
  city?: string;
  status?: string;
  completion_pct?: number;
  expected_possession?: string;
  nearest_landmarks?: string;
  unit_types?: string;
  price_range_lacs?: string;
  units_remaining?: number;
  usps?: string;
  amenities?: string;
  rera_number?: string;
  notes?: string;
  configurations?: ProjectConfiguration[] | null;
}

interface AiIssue {
  area: string;
  severity: string;
  issue: string;
  fix: string;
}

interface AiCategoryReview {
  score: number;
  fixes: string[];
}

interface AiComplianceCheck {
  reraVisible: boolean;
  logoVisible: boolean;
  pricingClear: boolean;
  issues: string[];
}

interface AiPlatformFit {
  ig_feed: string;
  ig_story: string;
  fb_feed: string;
}

interface AiReviewResult {
  overallScore?: number;
  verdict?: string;
  strengths?: string[];
  issues?: AiIssue[];
  layoutReview?: AiCategoryReview;
  colorReview?: AiCategoryReview;
  typographyReview?: AiCategoryReview;
  contentReview?: AiCategoryReview;
  ctaReview?: AiCategoryReview;
  complianceCheck?: AiComplianceCheck;
  platformFit?: AiPlatformFit;
  followUpPrompt?: string;
  followUpPromptStory?: string;
}

type ResultState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'raw'; text: string }
  | { status: 'ok'; data: AiReviewResult };

const CREATED_WITH_OPTIONS = [
  { value: 'Nanobanana (Gemini)', label: 'Nanobanana (Gemini)' },
  { value: 'ChatGPT / DALL-E', label: 'ChatGPT / DALL-E' },
  { value: 'Claude', label: 'Claude' },
  { value: 'Canva', label: 'Canva' },
  { value: 'Adobe Express', label: 'Adobe Express' },
  { value: 'Manual / Designer', label: 'Manual / Designer' },
  { value: 'Midjourney', label: 'Midjourney' },
];

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">{children}</p>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    Critical: 'bg-red-500/10 text-red-400 border-red-500/20',
    Major: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    Minor: 'bg-[#1e2e24] text-text-tertiary border-border',
  };
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${styles[severity] ?? styles['Minor']}`}>{severity}</span>
  );
}

function AreaBadge({ area }: { area: string }) {
  return (
    <span className="px-2 py-0.5 rounded-md text-[10px] bg-[#2dd4a8]/10 text-brand border border-[#2dd4a8]/20">{area}</span>
  );
}

function scoreColor(score: number) {
  if (score >= 8) return 'text-emerald-400';
  if (score >= 5) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBarColor(score: number) {
  if (score >= 8) return 'bg-emerald-400';
  if (score >= 5) return 'bg-amber-400';
  return 'bg-red-400';
}

function PurpleCard({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="rounded-lg border p-4 flex items-start gap-3" style={{ background: '#7c3aed10', borderColor: '#7c3aed30' }}>
        <p className="text-xs text-text-primary leading-relaxed flex-1 font-mono">{text}</p>
        <CopyButton text={text} />
      </div>
    </div>
  );
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

function AiReviewOutput({ data, onRetry }: { data: AiReviewResult; onRetry: () => void }) {
  const score = data.overallScore ?? 0;

  const categoryReviews: [string, AiCategoryReview | undefined][] = [
    ['Layout', data.layoutReview],
    ['Color', data.colorReview],
    ['Typography', data.typographyReview],
    ['Content', data.contentReview],
    ['CTA', data.ctaReview],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5">
        <Card className="p-5">
          <SectionLabel>Overall Score</SectionLabel>
          <div className="flex items-end gap-3 mb-4">
            <span className={`text-6xl font-bold leading-none ${scoreColor(score)}`}>{score}</span>
            <span className="text-2xl font-semibold text-text-tertiary pb-1">/10</span>
          </div>
          {data.verdict && <p className={`text-sm font-medium mb-3 ${scoreColor(score)}`}>{data.verdict}</p>}
          {data.strengths && data.strengths.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {data.strengths.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 flex-shrink-0" />
                  <span className="text-xs text-text-primary">{s}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionLabel>Compliance</SectionLabel>
          {data.complianceCheck ? (
            <div className="flex flex-col gap-3">
              {[
                ['RERA Number Visible', data.complianceCheck.reraVisible],
                ['Logo Visible', data.complianceCheck.logoVisible],
                ['Pricing Clear', data.complianceCheck.pricingClear],
              ].map(([label, pass]) => (
                <div key={String(label)} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-text-primary">{String(label)}</span>
                  {pass ? (
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <Check size={14} />
                      <span className="text-xs">Pass</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-red-400">
                      <AlertCircle size={14} />
                      <span className="text-xs">Fail</span>
                    </div>
                  )}
                </div>
              ))}
              {data.complianceCheck.issues && data.complianceCheck.issues.length > 0 && (
                <div className="mt-1 pt-3 border-t border-border">
                  {data.complianceCheck.issues.map((issue, i) => (
                    <p key={i} className="text-xs text-amber-400">• {issue}</p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary">No compliance data available.</p>
          )}
        </Card>
      </div>

      {data.platformFit && (
        <Card className="p-5">
          <SectionLabel>Platform Fit</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Instagram Feed', data.platformFit.ig_feed],
              ['Instagram Story', data.platformFit.ig_story],
              ['Facebook Feed', data.platformFit.fb_feed],
            ].map(([label, fit]) => (
              <div key={String(label)} className="bg-surface rounded-lg border border-border p-3 flex flex-col gap-1">
                <p className="text-xs text-text-tertiary">{String(label)}</p>
                <p className={`text-sm font-semibold ${String(fit).toLowerCase().includes('good') ? 'text-emerald-400' : 'text-amber-400'}`}>{String(fit)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.issues && data.issues.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Issues Found</SectionLabel></div>
          <div className="px-5 py-2">
            {data.issues.map((issue, i) => (
              <div key={i} className="py-4 border-b border-border last:border-0 flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <SeverityBadge severity={issue.severity} />
                  <AreaBadge area={issue.area} />
                </div>
                <p className="text-sm text-text-primary">{issue.issue}</p>
                <p className="text-xs text-brand">Fix: {issue.fix}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="px-5 py-4 border-b border-border"><SectionLabel>Category Scores</SectionLabel></div>
        <div className="px-5 py-4 grid grid-cols-3 gap-4">
          {categoryReviews.filter(([, r]) => r != null).map(([label, review]) => (
            <div key={String(label)} className="bg-surface rounded-lg border border-border p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-tertiary font-medium">{String(label)}</p>
                <span className={`text-lg font-bold ${scoreColor(review!.score)}`}>{review!.score}</span>
              </div>
              <div className="w-full h-1 rounded-full bg-[#1e2e24]">
                <div className={`h-1 rounded-full ${scoreBarColor(review!.score)}`} style={{ width: `${review!.score * 10}%` }} />
              </div>
              <div className="flex flex-col gap-0.5">
                {review!.fixes?.map((fix) => (
                  <p key={fix} className="text-[10px] text-text-tertiary leading-relaxed">• {fix}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5 flex flex-col gap-5">
        {data.followUpPrompt && <PurpleCard label="Revised Creative Prompt (1080x1080)" text={data.followUpPrompt} />}
        {data.followUpPromptStory && <PurpleCard label="Revised Story Prompt (1080x1920)" text={data.followUpPromptStory} />}
      </Card>

      <div className="flex justify-end">
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-brand transition-colors">
          <RefreshCw size={12} /> Reanalyze
        </button>
      </div>
    </div>
  );
}

export function AdReview() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [createdWith, setCreatedWith] = useState('Nanobanana (Gemini)');
  const [image, setImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResultState>({ status: 'idle' });
  const { showToast } = useToast();
  const { setCurrentData } = useChatbot();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const project = projects.find((p) => p.id === projectId);
    setCurrentData({ page: 'ad-review', project: project?.name, result: result.status === 'ok' ? result.data : null });
  }, [result, projectId, projects]);

  useEffect(() => {
    async function load() {
      setProjectsLoading(true);
      const { data } = await supabase
        .from('projects')
        .select('id,name,locality,city,status,completion_pct,expected_possession,nearest_landmarks,unit_types,price_range_lacs,units_remaining,usps,amenities,rera_number,notes,configurations')
        .eq('is_active', true)
        .eq('org_id', getOrgId())
        .order('name');
      const rows = (data ?? []) as Project[];
      setProjects(rows);
      if (rows.length > 0) setProjectId(rows[0].id);
      setProjectsLoading(false);
    }
    load();
  }, []);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImage(e.target.files?.[0] ?? null);
    setResult({ status: 'idle' });
  }

  function removeImage() {
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setResult({ status: 'idle' });
  }

  function saveReview(data: AiReviewResult) {
    supabase
      .from('creatives')
      .insert({
        org_id: getOrgId(),
        project_id: projectId || null,
        created_by: 'dev-user-001',
        platform_used: createdWith,
        review_score: data.overallScore ?? null,
        review_data: data,
        follow_up_prompt: data.followUpPrompt ?? null,
        status: 'draft',
      })
      .then(({ error }) => {
        if (error) {
          showToast('Failed to save review', 'error');
        } else {
          showToast('Review saved!', 'success');
        }
      });
  }

  async function handleAnalyze() {
    setSubmitting(true);
    setResult({ status: 'idle' });

    try {
      if (!isAiEnabled()) {
        setResult({ status: 'error', message: 'Add your Claude API key in Settings to analyze ad creatives.' });
        setSubmitting(false);
        return;
      }

      if (!image) {
        setResult({ status: 'error', message: 'Please upload an image first.' });
        setSubmitting(false);
        return;
      }

      const project = projects.find((p) => p.id === projectId);

      let configLines = '';
      let configInline = '';
      if (project) {
        const configs: ProjectConfiguration[] = (project.configurations && project.configurations.length > 0)
          ? project.configurations
          : project.unit_types
            ? project.unit_types.split(',').map((t) => ({
                type: t.trim(),
                carpet: '',
                price_lacs: project.price_range_lacs ?? '',
                total_units: null,
                remaining_units: project.units_remaining ?? null,
                available: (project.units_remaining ?? 1) > 0,
                notes: '',
              }))
            : [{
                type: 'Unit',
                carpet: '',
                price_lacs: project.price_range_lacs ?? '',
                total_units: null,
                remaining_units: project.units_remaining ?? null,
                available: true,
                notes: '',
              }];

        configLines = configs
          .filter((c) => c.available)
          .map((c) => [
            `  - Type: ${c.type}`,
            c.carpet ? `    Carpet Area: ${c.carpet}` : '',
            c.price_lacs ? `    Price: ₹${c.price_lacs}L` : '',
            c.remaining_units != null ? `    Units Available: ${c.remaining_units}` : '',
            c.notes ? `    Note: ${c.notes}` : '',
          ].filter(Boolean).join('\n'))
          .join('\n');

        configInline = configs
          .filter((c) => c.available)
          .map((c) => `${c.type}${c.carpet ? ` ${c.carpet}` : ''}${c.price_lacs ? ` ₹${c.price_lacs}L` : ''}`)
          .join(', ');
      }

      const reraLine = project?.rera_number
        ? `RERA: ${project.rera_number}`
        : `RERA: NOT AVAILABLE — DO NOT MENTION RERA IN ANY OUTPUT`;

      const projectBlock = project
        ? `CRITICAL RULES — READ BEFORE GENERATING:
1. Use ONLY the configurations listed below — do NOT invent other unit types or sizes
2. Use the exact prices given — do NOT round, estimate, or change prices
3. ${reraLine.startsWith('RERA: NOT') ? 'RERA is NOT available — DO NOT mention RERA or any registration number anywhere' : 'Use the RERA number exactly as given'}
4. If amenities or USPs are not listed, do NOT invent them
5. All ad copy must reflect ONLY this project data — no fabricated details

PROJECT BEING REVIEWED — USE ONLY THESE EXACT VALUES:
Name: ${project.name}
Location: ${[project.locality, project.city].filter(Boolean).join(', ') || 'Bhubaneswar'}
Status: ${project.status || 'Not specified'}${project.completion_pct != null ? `\nCompletion: ${project.completion_pct}%` : ''}${project.expected_possession ? `\nPossession: ${project.expected_possession}` : ''}${project.nearest_landmarks ? `\nNearby: ${project.nearest_landmarks}` : ''}
${reraLine}

CONFIGURATIONS BEING ADVERTISED (use ONLY these):
${configLines || '  - No configuration data available'}
${project.usps ? `\nUSPs: ${project.usps}` : ''}${project.amenities ? `\nAmenities: ${project.amenities}` : ''}`
        : 'Project details not available';

      const promptText = `Review this real estate ad creative. Be specific about issues and fixes.

${projectBlock}

CREATED ON: ${createdWith}

Return ONLY a JSON object:
{"overallScore":7,"verdict":"one line","strengths":["specific strength"],"issues":[{"area":"Layout or Color or Typography or Content or CTA","severity":"Critical or Major or Minor","issue":"specific problem","fix":"how to fix"}],"layoutReview":{"score":7,"fixes":["fix"]},"colorReview":{"score":7,"fixes":["fix"]},"typographyReview":{"score":7,"fixes":["fix"]},"contentReview":{"score":7,"fixes":["fix"]},"ctaReview":{"score":7,"fixes":["fix"]},"complianceCheck":{"reraVisible":true,"logoVisible":true,"pricingClear":true,"issues":["issue"]},"platformFit":{"ig_feed":"Good or Needs work","ig_story":"Good or Needs work","fb_feed":"Good or Needs work"},"followUpPrompt":"COMPLETE revised prompt for ${createdWith} that fixes ALL issues above. MANDATORY: Use ONLY these project details — Project: ${project?.name ?? ''}, Location: ${[project?.locality, project?.city].filter(Boolean).join(', ') || 'Bhubaneswar'}, Configs: ${configInline || 'as listed'}. ${project?.rera_number ? `RERA: ${project.rera_number}.` : 'Do NOT mention RERA.'} Include specific design fixes. Dimensions: 1080x1080. Brand colors: #1B4332, #2DD4A8. Logo: Neelachala Homes top-left.","followUpPromptStory":"Same structure for 1080x1920 story format with same mandatory project details and fixes."}`;

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

      const res = await aiVision(messages, 'You are a senior creative director reviewing real estate ads. Respond ONLY in valid JSON.');

      if (res.error) {
        setResult({ status: 'error', message: String(res.error) });
      } else if (res.raw) {
        setResult({ status: 'raw', text: String(res.raw) });
      } else {
        const reviewData = res as AiReviewResult;
        setResult({ status: 'ok', data: reviewData });
        logAiSession(supabase, {
          sessionType: 'ad_review',
          projectIds: [projectId],
          inputSummary: `Review for ${project?.name ?? projectId} created on ${createdWith}`,
          outputData: res,
          healthScore: reviewData.overallScore ?? null,
        });
        logActivity(supabase, {
          action: 'reviewed_creative',
          entityType: 'ai_session',
          details: { project: project?.name ?? projectId, score: reviewData.overallScore },
        });
      }
    } catch (err: unknown) {
      setResult({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }

    setSubmitting(false);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
  const canAnalyze = !!image && !!projectId;

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center gap-3 mb-7">
        <Eye size={20} className="text-brand" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Ad Review</h1>
          <p className="text-text-tertiary text-xs mt-0.5">Upload and stress-test your ad creatives with AI</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-6">
        <Card className="p-5 flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">1. Details</p>
          <Select label="Created With" options={CREATED_WITH_OPTIONS} value={createdWith} onChange={(e) => { setCreatedWith(e.target.value); setResult({ status: 'idle' }); }} />
          {projectsLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading projects…</span>
            </div>
          ) : (
            <Select label="Project" options={projectOptions} value={projectId} onChange={(e) => { setProjectId(e.target.value); setResult({ status: 'idle' }); }} />
          )}
        </Card>

        <Card className="p-5 flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">2. Upload</p>

          {image ? (
            <div className="flex items-center gap-4 bg-surface border border-border rounded-lg p-3">
              <img src={URL.createObjectURL(image)} alt="Creative" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="text-xs text-text-primary truncate">{image.name}</span>
                <span className="text-[11px] text-text-tertiary">{(image.size / 1024).toFixed(0)} KB</span>
                <button onClick={removeImage} className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors w-fit">
                  <X size={11} /> Remove
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-3 py-8 rounded-lg border-2 border-dashed border-border hover:border-[#2dd4a8]/40 hover:bg-[#2dd4a8]/[0.02] transition-all">
              <Upload size={22} className="text-text-tertiary" />
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-sm text-text-primary">Upload image</span>
                <span className="text-xs text-text-tertiary">PNG, JPG, WEBP supported</span>
              </div>
            </button>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />

          <Button onClick={handleAnalyze} disabled={submitting || !canAnalyze} className="w-full py-2.5">
            {submitting ? <Spinner size="sm" /> : <Eye size={14} />}
            {submitting ? 'Analyzing…' : 'Analyze'}
          </Button>

          {!canAnalyze && !submitting && (
            <p className="text-[11px] text-text-tertiary text-center -mt-1">
              {!image ? 'Upload an image to continue' : 'Select a project to continue'}
            </p>
          )}
        </Card>
      </div>

      {result.status !== 'idle' && (
        <div ref={resultRef} className="flex flex-col gap-5">
          {result.status === 'error' && <ErrorBanner message={result.message} onRetry={handleAnalyze} />}
          {result.status === 'raw' && <RawFallback text={result.text} onRetry={handleAnalyze} />}
          {result.status === 'ok' && (
            <>
              <AiReviewOutput data={result.data} onRetry={handleAnalyze} />
              <button
                onClick={() => saveReview(result.data)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#2dd4a8]/30 text-sm text-brand hover:bg-[#2dd4a8]/10 transition-all self-start"
              >
                <Save size={14} />
                Save Review
              </button>
            </>
          )}
        </div>
      )}

    </div>
  );
}

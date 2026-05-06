import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckSquare, FolderKanban, RefreshCw, Settings, Square } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { aiCall, isAiEnabled } from '../lib/ai-service';
import { logAiSession, logActivity } from '../lib/session-logger';
import { buildContext } from '../lib/context-builder';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { CopyButton } from '../components/ui/CopyButton';
import { Spinner } from '../components/ui/Spinner';
import { TargetingVerifier } from '../components/TargetingVerifier';
import { useNavigation } from '../contexts/NavigationContext';

interface Project {
  id: string;
  name: string;
  locality?: string;
  city?: string;
  price_range_lacs?: string;
  units_remaining?: number;
  usps?: string;
  notes?: string;
}

interface AiLocation {
  city: string;
  radius: string;
  why: string;
}

interface AiIcebreaker {
  text: string;
  purpose: string;
}

interface AiConfigResult {
  platformTip?: string;
  campaignName?: string;
  adType?: string;
  objective?: string;
  goal?: string;
  locations?: AiLocation[];
  ageMin?: number;
  ageMax?: number;
  ageWhy?: string;
  gender?: string;
  interests?: string[];
  demographics?: string[];
  occupations?: string[];
  educationLevel?: string;
  lifeEvents?: string;
  behaviors?: string[];
  audienceExpansion?: string;
  dailyBudget?: number;
  days?: number;
  totalBudget?: number;
  bidStrategy?: string;
  icebreakers?: AiIcebreaker[];
  pixelEvents?: string[];
  checklist?: string[];
}

type ResultState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'raw'; text: string }
  | { status: 'ok'; data: AiConfigResult };

const FUNNEL_OPTIONS = [
  { value: 'TOFU', label: 'TOFU — Top of Funnel' },
  { value: 'MOFU', label: 'MOFU — Middle of Funnel' },
  { value: 'BOFU', label: 'BOFU — Bottom of Funnel' },
];

const PLATFORM_OPTIONS = [
  { value: 'AiSensy', label: 'AiSensy' },
  { value: 'Meta Ads Manager', label: 'Meta Ads Manager' },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">
      {children}
    </p>
  );
}

function FieldRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <span className="text-xs text-text-tertiary min-w-[140px] flex-shrink-0">{label}</span>
      <span className="text-xs text-text-primary flex-1">{value}</span>
      {copyable && <CopyButton text={value} />}
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

function AiConfigOutput({ data, onRetry, platform }: { data: AiConfigResult; onRetry: () => void; platform: string }) {
  const [checklist, setChecklist] = useState<Record<number, boolean>>({});

  const interestsList = data.interests ?? [];
  const demographicsList = [...(data.demographics ?? []), ...(data.occupations ?? [])];
  const behaviorsList = data.behaviors ?? [];

  return (
    <div className="flex flex-col gap-5">
      {data.platformTip && (
        <div className="px-4 py-3 rounded-xl border border-[#3b82f6]/30 text-sm text-blue-300" style={{ background: '#3b82f610' }}>
          <span className="font-semibold">Platform Recommendation: </span>{data.platformTip}
        </div>
      )}

      <Card>
        <div className="px-5 py-4 border-b border-border"><SectionLabel>Campaign Details</SectionLabel></div>
        <div className="px-5 py-1">
          {data.campaignName && <FieldRow label="Campaign Name" value={data.campaignName} copyable />}
          {data.adType && <FieldRow label="Ad Type" value={data.adType} copyable />}
          {data.objective && <FieldRow label="Objective" value={data.objective} copyable />}
          {data.goal && <FieldRow label="Goal" value={data.goal} copyable />}
        </div>
      </Card>

      {data.locations && data.locations.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Locations</SectionLabel></div>
          <div className="px-5 py-4 grid grid-cols-3 gap-3">
            {data.locations.map((loc, i) => (
              <div key={i} className="bg-surface rounded-lg border border-border p-3 flex flex-col gap-1">
                <p className="text-sm font-semibold text-text-primary">{loc.city}</p>
                <p className="text-[11px] text-brand">{loc.radius}</p>
                <p className="text-[11px] text-text-tertiary leading-relaxed">{loc.why}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="px-5 py-4 border-b border-border"><SectionLabel>Audience Targeting</SectionLabel></div>
        <div className="px-5 py-1">
          {data.ageMin != null && data.ageMax != null && (
            <FieldRow label="Age Range" value={`${data.ageMin}–${data.ageMax}${data.ageWhy ? ` — ${data.ageWhy}` : ''}`} />
          )}
          {data.gender && <FieldRow label="Gender" value={data.gender} />}
          {data.educationLevel && <FieldRow label="Education Level" value={data.educationLevel} copyable />}
          {data.lifeEvents && <FieldRow label="Life Events" value={data.lifeEvents} copyable />}
          {data.audienceExpansion && <FieldRow label="Audience Expansion" value={data.audienceExpansion} />}
        </div>
        {(interestsList.length > 0 || demographicsList.length > 0 || behaviorsList.length > 0) && (
          <div className="px-5 pb-4 flex flex-col gap-3">
            {interestsList.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Interests</p>
                  <CopyButton text={interestsList.join(', ')} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {interestsList.map((tag) => (
                    <span key={tag} className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-brand-subtle text-brand border border-brand/20">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            {demographicsList.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Demographics</p>
                  <CopyButton text={demographicsList.join(', ')} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {demographicsList.map((tag) => (
                    <span key={tag} className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            {behaviorsList.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Behaviors</p>
                  <CopyButton text={behaviorsList.join(', ')} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {behaviorsList.map((tag) => (
                    <span key={tag} className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#3b82f6]/10 text-blue-300 border border-[#3b82f6]/20">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            {(interestsList.length > 0 || demographicsList.length > 0 || behaviorsList.length > 0) && (
              <TargetingVerifier
                interests={interestsList}
                demographics={demographicsList}
                behaviors={behaviorsList}
                platform={platform}
              />
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-border"><SectionLabel>Budget</SectionLabel></div>
        <div className="px-5 py-4 grid grid-cols-3 gap-4">
          {[
            ['Daily Budget', data.dailyBudget != null ? `₹${data.dailyBudget.toLocaleString()}` : '—'],
            ['Duration', data.days != null ? `${data.days} days` : '—'],
            ['Total Budget', data.totalBudget != null ? `₹${data.totalBudget.toLocaleString()}` : '—'],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface rounded-lg border border-border p-4 flex flex-col gap-1">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">{label}</p>
              <p className="text-xl font-semibold text-text-primary">{value}</p>
            </div>
          ))}
        </div>
        {data.bidStrategy && (
          <div className="px-5 pb-4">
            <FieldRow label="Bid Strategy" value={data.bidStrategy} />
          </div>
        )}
      </Card>

      {data.icebreakers && data.icebreakers.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Icebreakers</SectionLabel></div>
          <div className="px-5 py-2">
            {data.icebreakers.map((ice, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-3 border-b border-border last:border-0">
                <div className="flex-1">
                  <p className="text-sm text-text-primary mb-0.5">{ice.text}</p>
                  {ice.purpose && <p className="text-[11px] text-text-tertiary">{ice.purpose}</p>}
                </div>
                <CopyButton text={ice.text} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.pixelEvents && data.pixelEvents.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Pixel Events</SectionLabel></div>
          <div className="px-5 py-4 flex flex-wrap gap-2">
            {data.pixelEvents.map((ev) => (
              <span key={ev} className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#1e2e24] text-text-primary border border-[#2e3e34]">{ev}</span>
            ))}
          </div>
        </Card>
      )}

      {data.checklist && data.checklist.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Pre-launch Checklist</SectionLabel></div>
          <div className="px-5 py-4 flex flex-col gap-2.5">
            {data.checklist.map((item, i) => (
              <button key={i} onClick={() => setChecklist((c) => ({ ...c, [i]: !c[i] }))} className="flex items-center gap-3 text-left group">
                {checklist[i] ? (
                  <CheckSquare size={15} className="text-brand flex-shrink-0" />
                ) : (
                  <Square size={15} className="text-text-tertiary flex-shrink-0 group-hover:text-text-primary" />
                )}
                <span className={`text-sm transition-colors ${checklist[i] ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{item}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-brand transition-colors">
          <RefreshCw size={12} /> Regenerate
        </button>
      </div>
    </div>
  );
}

export function AdConfig() {
  const { navigate } = useNavigation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [funnelStage, setFunnelStage] = useState('TOFU');
  const [platform, setPlatform] = useState('AiSensy');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResultState>({ status: 'idle' });
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      setProjectsLoading(true);
      const { data } = await supabase
        .from('projects')
        .select('id,name,locality,city,price_range_lacs,units_remaining,usps,notes')
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

  async function handleGenerate() {
    setSubmitting(true);
    setResult({ status: 'idle' });

    try {
      if (!isAiEnabled()) {
        setResult({ status: 'error', message: 'Add your Claude API key in Settings to generate an AI configuration.' });
        setSubmitting(false);
        return;
      }

      const [context, verifiedKwRes] = await Promise.all([
        buildContext({ projectId }),
        supabase.from('targeting_keywords').select('keyword,status').eq('platform', platform).in('status', ['available', 'not_found']),
      ]);
      const verifiedKws = (verifiedKwRes.data ?? []) as { keyword: string; status: string }[];
      const verifiedAvailable = verifiedKws.filter((k) => k.status === 'available').map((k) => k.keyword);
      const verifiedNotFound = verifiedKws.filter((k) => k.status === 'not_found').map((k) => k.keyword);
      const kwSection = [
        verifiedAvailable.length > 0 ? `VERIFIED TARGETING (available in ${platform}): ${verifiedAvailable.join(', ')}` : '',
        verifiedNotFound.length > 0 ? `NOT AVAILABLE (do NOT suggest): ${verifiedNotFound.join(', ')}` : '',
      ].filter(Boolean).join('\n');

      const project = projects.find((p) => p.id === projectId);
      const basePrompt = `Generate EXACT field-by-field ad configuration. Write REAL specific values, not placeholders.
PROJECT: ${project?.name ?? 'Unknown'} | ${project?.locality ?? ''}, ${project?.city ?? ''} | Price: ${project?.price_range_lacs ?? 'N/A'} Lacs | Units remaining: ${project?.units_remaining ?? 'N/A'} | USPs: ${project?.usps ?? 'N/A'} | Notes: ${project?.notes ?? 'None'}
FUNNEL: ${funnelStage}
PLATFORM: ${platform}
${kwSection ? '\n' + kwSection : ''}

Return ONLY a JSON object:
{"platformTip":"recommendation","campaignName":"REAL name","adType":"REAL type","objective":"REAL","goal":"REAL","locations":[{"city":"REAL","radius":"REAL","why":"REAL"}],"ageMin":30,"ageMax":50,"ageWhy":"reason","gender":"All","interests":["REAL interest 1","REAL interest 2"],"demographics":["REAL demographic 1","REAL demographic 2"],"occupations":["job title 1","job title 2"],"educationLevel":"College Graduate, Postgraduate","lifeEvents":"Recently married, Recently moved","behaviors":["REAL"],"audienceExpansion":"OFF - reason","dailyBudget":350,"days":14,"totalBudget":4900,"bidStrategy":"Lowest cost","icebreakers":[{"text":"REAL with emoji","purpose":"purpose"}],"pixelEvents":["REAL event"],"checklist":["REAL step 1","REAL step 2"]}`;
      const prompt = context ? basePrompt + '\n\n' + context : basePrompt;

      const res = await aiCall(prompt);
      if (res.error) {
        setResult({ status: 'error', message: String(res.error) });
      } else if (res.raw) {
        setResult({ status: 'raw', text: String(res.raw) });
      } else {
        setResult({ status: 'ok', data: res as AiConfigResult });
        const project = projects.find((p) => p.id === projectId);
        logAiSession(supabase, {
          sessionType: 'ad_config',
          projectIds: [projectId],
          inputSummary: `Ad config for ${project?.name ?? ''} ${funnelStage} on ${platform}`,
          outputData: res,
        });
        logActivity(supabase, {
          action: 'generated_ad_config',
          entityType: 'ai_session',
          details: { project: project?.name ?? '', funnel: funnelStage, platform },
        });
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
        <Settings size={20} className="text-brand" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Ad Config</h1>
          <p className="text-text-tertiary text-xs mt-0.5">Get exact field-by-field ad configuration for Meta and AiSensy</p>
        </div>
      </div>

      {!projectsLoading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-14 rounded-xl border border-dashed border-border mb-6 text-center gap-3">
          <FolderKanban size={32} className="text-[#1e2e24]" />
          <p className="text-sm text-text-tertiary">Add a project first to generate ad configurations.</p>
          <button
            onClick={() => navigate('projects')}
            className="px-4 py-2 rounded-lg bg-brand-subtle border border-brand/20 text-sm text-brand hover:bg-[#2dd4a8]/15 transition-all"
          >
            Go to Projects
          </button>
        </div>
      )}

      <Card className="p-5 mb-6">
        <div className="grid grid-cols-3 gap-4 mb-5">
          {projectsLoading ? (
            <div className="flex items-center gap-2 py-2 col-span-1">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading projects…</span>
            </div>
          ) : (
            <Select label="Project" options={projectOptions} value={projectId} onChange={(e) => { setProjectId(e.target.value); setResult({ status: 'idle' }); }} />
          )}
          <Select label="Funnel Stage" options={FUNNEL_OPTIONS} value={funnelStage} onChange={(e) => { setFunnelStage(e.target.value); setResult({ status: 'idle' }); }} />
          <Select label="Platform" options={PLATFORM_OPTIONS} value={platform} onChange={(e) => { setPlatform(e.target.value); setResult({ status: 'idle' }); }} />
        </div>
        <Button onClick={handleGenerate} disabled={submitting || !projectId} className="w-full py-2.5">
          {submitting ? <Spinner size="sm" /> : <Settings size={14} />}
          {submitting ? 'Generating…' : 'Generate Config'}
        </Button>
      </Card>

      {result.status !== 'idle' && (
        <div ref={resultRef} className="flex flex-col gap-5">
          {result.status === 'error' && <ErrorBanner message={result.message} onRetry={handleGenerate} />}
          {result.status === 'raw' && <RawFallback text={result.text} onRetry={handleGenerate} />}
          {result.status === 'ok' && <AiConfigOutput data={result.data} onRetry={handleGenerate} platform={platform} />}
        </div>
      )}
    </div>
  );
}

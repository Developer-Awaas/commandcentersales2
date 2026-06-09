import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw, Search, TrendingUp, Upload } from 'lucide-react';
import { CampaignMetricsChart } from '../components/CampaignMetricsChart';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import { aiCall, getApiKey, isAiEnabled } from '../lib/ai-service';
import { logAiSession, logActivity } from '../lib/session-logger';
import { buildContext } from '../lib/context-builder';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';

interface Project {
  id: string;
  name: string;
}

interface AiScorecardRow {
  metric: string;
  value: string;
  target: string;
  status: 'green' | 'yellow' | 'red';
  insight: string;
}

interface AiTacticalAction {
  priority: number;
  action: string;
  impact: string;
  howTo: string;
}

interface AiStrategicRec {
  rec: string;
  rationale: string;
  timeline: string;
}

interface AiFunnelAnalysis {
  bottleneck: string;
  stage: string;
  fix: string;
}

interface AiAnalysisResult {
  healthScore?: number;
  assessment?: string;
  scorecard?: AiScorecardRow[];
  tacticalActions?: AiTacticalAction[];
  strategicRecs?: AiStrategicRec[];
  funnelAnalysis?: AiFunnelAnalysis;
  creativeRec?: string;
  targetingRec?: string;
  nextReview?: string;
}

interface MetricRow {
  id: string;
  date: string;
  spend: number;
  leads: number;
  cpl: number;
  ctr: number;
  impressions: number;
  frequency: number;
}

type AiResultState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'raw'; text: string }
  | { status: 'ok'; data: AiAnalysisResult };

type ResearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; text: string };

const PERIOD_OPTIONS = [
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];

const METRIC_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'spend', label: 'Spend (₹)', placeholder: '0' },
  { key: 'leads', label: 'Leads', placeholder: '0' },
  { key: 'cpl', label: 'CPL (₹)', placeholder: '0' },
  { key: 'ctr', label: 'CTR (%)', placeholder: '0.00' },
  { key: 'impressions', label: 'Impressions', placeholder: '0' },
  { key: 'reach', label: 'Reach', placeholder: '0' },
  { key: 'frequency', label: 'Frequency', placeholder: '0.0' },
  { key: 'site_visits', label: 'Site Visits', placeholder: '0' },
  { key: 'bookings', label: 'Bookings', placeholder: '0' },
];

const PRIORITY_STYLE: Record<number, string> = {
  1: 'bg-red-500/10 text-red-400 border-red-500/20',
  2: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  3: 'bg-brand-subtle text-brand border-brand-border',
};

const STATUS_COLOR: Record<string, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">{children}</p>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
      <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-red-300 flex-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors flex-shrink-0">
          <RefreshCw size={12} /> Retry
        </button>
      )}
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

function scoreColor(score: number) {
  if (score >= 8) return 'text-emerald-400';
  if (score >= 5) return 'text-amber-400';
  return 'text-red-400';
}

function AiAnalysisOutput({ data, onRetry }: { data: AiAnalysisResult; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5">
        <Card className="p-5">
          <SectionLabel>Health Score</SectionLabel>
          <div className="flex items-end gap-2 mb-3">
            <span className={`text-6xl font-bold leading-none ${scoreColor(data.healthScore ?? 0)}`}>{data.healthScore ?? 0}</span>
            <span className="text-2xl font-semibold text-text-tertiary pb-1">/10</span>
          </div>
          {data.assessment && (
            <p className="text-xs text-text-tertiary leading-relaxed">{data.assessment}</p>
          )}
        </Card>

        {data.funnelAnalysis && (
          <Card className="p-5">
            <SectionLabel>Funnel Bottleneck</SectionLabel>
            <p className="text-sm font-semibold text-amber-400 mb-1">{data.funnelAnalysis.bottleneck}</p>
            <p className="text-xs text-text-tertiary leading-relaxed mb-2">Stage: {data.funnelAnalysis.stage}</p>
            <p className="text-xs text-brand">Fix: {data.funnelAnalysis.fix}</p>
          </Card>
        )}
      </div>

      {data.scorecard && data.scorecard.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Metric Scorecard</SectionLabel></div>
          <div className="px-5 py-2">
            {data.scorecard.map((row) => (
              <div key={row.metric} className="flex items-center gap-4 py-3 border-b border-border last:border-0">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_COLOR[row.status] ?? 'bg-text-tertiary'}`} />
                <span className="text-sm text-text-primary flex-1 font-medium">{row.metric}</span>
                <span className="text-sm text-text-primary min-w-[80px] text-right">{row.value}</span>
                <span className="text-xs text-text-tertiary min-w-[110px] text-right">Target: {row.target}</span>
                {row.insight && <span className="text-xs text-text-tertiary min-w-[140px] text-right hidden xl:block">{row.insight}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.tacticalActions && data.tacticalActions.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Tactical Actions</SectionLabel></div>
          <div className="px-5 py-3 flex flex-col gap-4">
            {data.tacticalActions.map((action, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-surface-sunken flex items-center justify-center mt-0.5">
                  <span className="text-[11px] font-bold text-text-tertiary">{i + 1}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${PRIORITY_STYLE[action.priority] ?? PRIORITY_STYLE[3]}`}>
                      P{action.priority}
                    </span>
                    {action.impact && <span className="text-[11px] text-text-tertiary">{action.impact}</span>}
                  </div>
                  <p className="text-sm text-text-primary mb-1.5">{action.action}</p>
                  {action.howTo && <p className="text-xs text-brand">→ {action.howTo}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.strategicRecs && data.strategicRecs.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Strategic Recommendations</SectionLabel></div>
          <div className="px-5 py-4 flex flex-col gap-3">
            {data.strategicRecs.map((rec, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-brand flex-shrink-0 mt-0.5">•</span>
                <div>
                  <p className="text-sm text-text-primary leading-relaxed">{rec.rec}</p>
                  {rec.rationale && <p className="text-xs text-text-tertiary mt-0.5">{rec.rationale}</p>}
                  {rec.timeline && <p className="text-[11px] text-brand mt-0.5">{rec.timeline}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(data.creativeRec || data.targetingRec) && (
        <div className="grid grid-cols-2 gap-4">
          {data.creativeRec && (
            <Card className="p-4">
              <SectionLabel>Creative Recommendation</SectionLabel>
              <p className="text-sm text-text-primary leading-relaxed">{data.creativeRec}</p>
            </Card>
          )}
          {data.targetingRec && (
            <Card className="p-4">
              <SectionLabel>Targeting Recommendation</SectionLabel>
              <p className="text-sm text-text-primary leading-relaxed">{data.targetingRec}</p>
            </Card>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-brand transition-colors">
          <RefreshCw size={12} /> Reanalyze
        </button>
      </div>
    </div>
  );
}

function cplBarColor(cpl: number): string {
  if (cpl <= 0) return '#E4E4E7';
  if (cpl < 100) return '#2563EB';
  if (cpl <= 150) return '#f59e0b';
  return '#ef4444';
}

function MetricsHistory({ rows }: { rows: MetricRow[] }) {
  const chartRows = rows.slice(0, 14).reverse();
  const maxLeads = Math.max(...chartRows.map((r) => r.leads), 1);

  function fmtShortDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  return (
    <div className="flex flex-col gap-5">
      {chartRows.length > 0 && (
        <Card className="p-5">
          <SectionLabel>Leads Trend (last 14 days)</SectionLabel>
          <div className="flex items-end gap-1.5 h-24 mt-3">
            {chartRows.map((r) => {
              const pct = maxLeads > 0 ? (r.leads / maxLeads) * 100 : 0;
              const color = cplBarColor(r.cpl);
              return (
                <div key={r.id} className="flex flex-col items-center gap-1 flex-1 group relative">
                  <div
                    className="w-full rounded-t-sm transition-all duration-300"
                    style={{ height: `${Math.max(pct, 4)}%`, backgroundColor: color, minHeight: r.leads > 0 ? 4 : 2 }}
                  />
                  <div className="absolute bottom-full mb-1.5 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
                    <div className="bg-surface-elevated border border-border rounded-lg px-2.5 py-1.5 text-[10px] text-text-primary whitespace-nowrap shadow-modal">
                      <div className="font-semibold">{fmtShortDate(r.date)}</div>
                      <div>{r.leads} leads</div>
                      {r.cpl > 0 && <div>CPL ₹{Math.round(r.cpl)}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-brand" /><span className="text-[10px] text-text-tertiary">CPL &lt; ₹100</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-amber-400" /><span className="text-[10px] text-text-tertiary">CPL ₹100–150</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-red-400" /><span className="text-[10px] text-text-tertiary">CPL &gt; ₹150</span></div>
          </div>
        </Card>
      )}

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <SectionLabel>Metrics History</SectionLabel>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-tertiary">
            No metrics recorded yet. Enter metrics above or import a CSV.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border">Date</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border">Spend</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border">Leads</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border">CPL</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border">CTR</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border">Impressions</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border">Frequency</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-hover transition-colors">
                    <td className="px-4 py-3 text-sm text-text-primary border-b border-border">
                      {new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary border-b border-border">₹{r.spend.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-sm text-text-primary border-b border-border">{r.leads}</td>
                    <td className="px-4 py-3 text-sm border-b border-border">
                      <span style={{ color: cplBarColor(r.cpl) }}>₹{Math.round(r.cpl)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-tertiary border-b border-border">{r.ctr.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-sm text-text-tertiary border-b border-border">{r.impressions.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-sm text-text-tertiary border-b border-border">{r.frequency.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function Analyzer() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectId, setProjectId] = useState('all');
  const [period, setPeriod] = useState('7');
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [metricsHistory, setMetricsHistory] = useState<MetricRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const { showToast } = useToast();
  const [aiResult, setAiResult] = useState<AiResultState>({ status: 'idle' });
  const [research, setResearch] = useState<ResearchState>({ status: 'idle' });
  const [researchSubmitting, setResearchSubmitting] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const researchRef = useRef<HTMLDivElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const { data } = await supabase
      .from('daily_metrics')
      .select('id,date,spend,leads,cpl,ctr,impressions,frequency')
      .eq('org_id', getOrgId())
      .order('date', { ascending: false })
      .limit(30);
    setMetricsHistory((data ?? []) as MetricRow[]);
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    async function load() {
      setProjectsLoading(true);
      const { data } = await supabase
        .from('projects')
        .select('id,name')
        .eq('is_active', true)
        .eq('org_id', getOrgId())
        .order('name');
      setProjects((data ?? []) as Project[]);
      setProjectsLoading(false);
    }
    load();
    loadHistory();
  }, [loadHistory]);

  function setMetric(key: string, value: string) {
    setMetrics((prev) => ({ ...prev, [key]: value }));
  }

  function handleCsvClick() {
    csvInputRef.current?.click();
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setImporting(true);
    setImportProgress('Reading file…');

    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });

      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));

      const rows = lines.slice(1).map((line) => {
        const vals = line.split(',').map((v) => v.trim());
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
        return obj;
      }).filter((r) => r.date);

      setImportProgress(`Importing ${rows.length} rows…`);

      const inserts = rows.map((r) => ({
        org_id: getOrgId(),
        date: r.date,
        spend: parseFloat(r.spend) || 0,
        leads: parseInt(r.leads) || 0,
        cpl: parseFloat(r.cpl) || 0,
        ctr: parseFloat(r.ctr) || 0,
        impressions: parseInt(r.impressions) || 0,
        reach: parseInt(r.reach) || 0,
        frequency: parseFloat(r.frequency) || 0,
        results: parseInt(r.results || r.site_visits) || 0,
        conversions: parseInt(r.conversions || r.bookings) || 0,
        data_source: 'csv',
      }));

      const { error } = await supabase.from('daily_metrics').insert(inserts);
      if (error) throw new Error(error.message);

      showToast(`Imported ${rows.length} rows successfully!`, 'success');
      await loadHistory();
    } catch (err: unknown) {
      showToast('Import failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }

    setImporting(false);
    setImportProgress('');
  }

  async function handleRunAnalysis() {
    setSubmitting(true);
    setAiResult({ status: 'idle' });

    const today = new Date().toISOString().split('T')[0];
    const payload: Record<string, unknown> = {
      org_id: getOrgId(),
      date: today,
      spend: parseFloat(metrics.spend ?? '0') || 0,
      leads: parseInt(metrics.leads ?? '0') || 0,
      cpl: parseFloat(metrics.cpl ?? '0') || 0,
      ctr: parseFloat(metrics.ctr ?? '0') || 0,
      impressions: parseInt(metrics.impressions ?? '0') || 0,
      reach: parseInt(metrics.reach ?? '0') || 0,
      frequency: parseFloat(metrics.frequency ?? '0') || 0,
      results: parseInt(metrics.site_visits ?? '0') || 0,
      conversions: parseInt(metrics.bookings ?? '0') || 0,
      data_source: 'manual',
    };

    if (projectId !== 'all') {
      payload.project_id = projectId;
    }

    await supabase.from('daily_metrics').insert(payload);
    showToast('Metrics saved successfully!', 'success');
    loadHistory();

    logActivity(supabase, {
      action: 'saved_metrics',
      entityType: 'daily_metrics',
      details: {
        spend: parseFloat(metrics.spend ?? '0') || 0,
        leads: parseInt(metrics.leads ?? '0') || 0,
        cpl: parseFloat(metrics.cpl ?? '0') || 0,
        date: today,
      },
    });

    if (!isAiEnabled()) {
      setAiResult({ status: 'error', message: 'Metrics saved. Add your Claude API key in Settings to enable AI analysis.' });
      setSubmitting(false);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      return;
    }

    try {
      const context = await buildContext({ projectId: projectId !== 'all' ? projectId : undefined });
      const selectedProject = projects.find((p) => p.id === projectId);
      const basePrompt = `Analyze real estate ad metrics. Give specific actionable recommendations.
PROJECT: ${selectedProject?.name ?? 'All Projects'}
PERIOD: Last ${period} days
METRICS: Spend Rs ${metrics.spend ?? 0}, Leads ${metrics.leads ?? 0}, CPL Rs ${metrics.cpl ?? 0}, CTR ${metrics.ctr ?? 0}%, Impressions ${metrics.impressions ?? 0}, Reach ${metrics.reach ?? 0}, Frequency ${metrics.frequency ?? 0}, Site Visits ${metrics.site_visits ?? 0}, Bookings ${metrics.bookings ?? 0}
BASELINE: ~80 leads/mo, CPL Rs 80-140, ~12 SVs, 0-1 bookings

Return ONLY a JSON object:
{"healthScore":7,"assessment":"summary","scorecard":[{"metric":"CPL","value":"Rs X","target":"Rs X","status":"green or yellow or red","insight":"brief"}],"tacticalActions":[{"priority":1,"action":"action","impact":"impact","howTo":"steps"}],"strategicRecs":[{"rec":"recommendation","rationale":"why","timeline":"when"}],"funnelAnalysis":{"bottleneck":"what","stage":"which","fix":"how"},"creativeRec":"recommendation","targetingRec":"changes","nextReview":"when"}`;
      const prompt = context ? basePrompt + '\n\n' + context : basePrompt;

      const res = await aiCall(prompt);
      if (res.error) {
        setAiResult({ status: 'error', message: String(res.error) });
      } else if (res.raw) {
        setAiResult({ status: 'raw', text: String(res.raw) });
      } else {
        const analysisData = res as AiAnalysisResult;
        setAiResult({ status: 'ok', data: analysisData });
        const selectedProject2 = projects.find((p) => p.id === projectId);
        logAiSession(supabase, {
          sessionType: 'analysis',
          projectIds: projectId !== 'all' ? [projectId] : [],
          inputSummary: `Analysis: Spend Rs${metrics.spend ?? 0} Leads ${metrics.leads ?? 0} CPL Rs${metrics.cpl ?? 0}`,
          inputData: { ...metrics, period },
          outputData: res,
          healthScore: analysisData.healthScore ?? null,
        });
        logActivity(supabase, {
          action: 'analyzed_performance',
          entityType: 'ai_session',
          details: {
            project: selectedProject2?.name ?? 'All',
            period,
            spend: parseFloat(metrics.spend ?? '0') || 0,
            leads: parseInt(metrics.leads ?? '0') || 0,
          },
        });
      }
    } catch (err: unknown) {
      setAiResult({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }

    setSubmitting(false);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  async function handleResearchMetaUpdates() {
    setResearchSubmitting(true);
    setResearch({ status: 'loading' });

    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        setResearch({ status: 'error', message: 'Add your Claude API key in Settings to research Meta updates.' });
        setResearchSubmitting(false);
        return;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-beta': 'web-search-2025-03-05',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [
            {
              role: 'user',
              content: 'Research latest Meta Ads features 2026 for Indian real estate. CTWA updates, Advantage+ changes, new targeting. Give actionable recommendations for mid-size Bhubaneswar developer with Rs 15-30K monthly budget.',
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>)?.error?.toString() ?? `HTTP ${response.status}`);
      }

      const json = await response.json();
      const textContent = (json.content ?? [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('\n\n');

      setResearch({ status: 'ok', text: textContent || 'No text response returned.' });
    } catch (err: unknown) {
      setResearch({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }

    setResearchSubmitting(false);
    setTimeout(() => researchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  const projectOptions = [
    { value: 'all', label: 'All Projects' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-3">
          <TrendingUp size={20} className="text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Performance Analyzer</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Enter campaign metrics to get AI-powered analysis</p>
          </div>
        </div>
        <button
          onClick={handleResearchMetaUpdates}
          disabled={researchSubmitting}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border text-text-tertiary hover:text-text-primary hover:border-brand-border text-xs transition-all disabled:opacity-50"
        >
          {researchSubmitting ? <Spinner size="sm" /> : <Search size={13} />}
          {researchSubmitting ? 'Searching…' : 'Research Meta Updates'}
        </button>
      </div>

      <Card className="p-5 mb-6">
        <div className="grid grid-cols-2 gap-4 mb-5">
          {projectsLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading projects…</span>
            </div>
          ) : (
            <Select label="Project" options={projectOptions} value={projectId} onChange={(e) => setProjectId(e.target.value)} />
          )}
          <Select label="Period" options={PERIOD_OPTIONS} value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>

        <div className="grid grid-cols-3 gap-4 mb-5">
          {METRIC_FIELDS.map((field) => (
            <Input key={field.key} label={field.label} type="number" placeholder={field.placeholder} value={metrics[field.key] ?? ''} onChange={(e) => setMetric(field.key, e.target.value)} />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleRunAnalysis} disabled={submitting} className="flex-1 py-2.5">
            {submitting ? <Spinner size="sm" /> : <TrendingUp size={14} />}
            {submitting ? 'Saving & Analyzing…' : 'Run Analysis'}
          </Button>
          <button
            onClick={handleCsvClick}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-text-tertiary hover:text-text-primary hover:border-brand-border text-sm transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {importing ? <Spinner size="sm" /> : <Upload size={14} />}
            {importing ? importProgress : 'Import CSV'}
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            onChange={handleCsvImport}
            className="hidden"
          />
        </div>
      </Card>

      {aiResult.status !== 'idle' && (
        <div ref={resultRef} className="flex flex-col gap-5 mb-8">
          {aiResult.status === 'error' && <ErrorBanner message={aiResult.message} onRetry={handleRunAnalysis} />}
          {aiResult.status === 'raw' && <RawFallback text={aiResult.text} onRetry={handleRunAnalysis} />}
          {aiResult.status === 'ok' && <AiAnalysisOutput data={aiResult.data} onRetry={handleRunAnalysis} />}
        </div>
      )}

      {research.status !== 'idle' && (
        <div ref={researchRef} className="flex flex-col gap-4 mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Meta Research Results</p>
          {research.status === 'loading' && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-surface-sunken border border-border">
              <Spinner size="sm" />
              <span className="text-sm text-text-tertiary">Searching the web for latest Meta Ads updates…</span>
            </div>
          )}
          {research.status === 'error' && <ErrorBanner message={research.message} />}
          {research.status === 'ok' && (
            <Card className="p-5">
              <p className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap">{research.text}</p>
            </Card>
          )}
        </div>
      )}

      {/* Auto-synced Meta metrics section */}
      <div className="mb-8">
        <CampaignMetricsChart orgId={undefined} campaignId={projectId !== 'all' ? projectId : undefined} />
      </div>

      <div className="mt-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">Manually Entered Metrics History</p>
        {historyLoading ? (
          <div className="flex items-center gap-2 py-4">
            <Spinner size="sm" />
            <span className="text-xs text-text-tertiary">Loading history…</span>
          </div>
        ) : (
          <MetricsHistory rows={metricsHistory} />
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { BarChart3, ChevronDown, Database, Download } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';

type Period = '7' | '14' | '30' | 'all';

const PERIOD_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

interface KPIs {
  campaigns: number;
  leads: number;
  spend: number;
  avgCpl: number;
}

interface Campaign {
  id: string;
  campaign_name: string;
  project_name: string;
  funnel_stage: string | null;
  platform: string | null;
  status: string | null;
  daily_budget: number | null;
  source: string | null;
  created_at: string;
}

interface AiSession {
  id: string;
  session_type: string;
  input_summary: string | null;
  tokens_used: number;
  created_at: string;
}

interface ActivityEntry {
  id: string;
  action: string;
  entity_type: string | null;
  created_at: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN').format(n);
}

function fmtRs(n: number) {
  return `₹${fmt(Math.round(n))}`;
}

function fmtDate(str: string) {
  return new Date(str).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
      {children}
    </p>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4 bg-surface-elevated rounded-xl border border-border">
      <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-tertiary">{sub}</p>}
    </div>
  );
}

const TH = 'px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border';
const TD = 'px-4 py-3 text-sm text-text-primary border-b border-border last:border-b-0';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  draft: 'bg-surface-sunken text-text-tertiary border-border',
  paused: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  completed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  archived: 'bg-surface-sunken text-text-tertiary border-border',
};

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? 'draft';
  const cls = STATUS_STYLE[s] ?? STATUS_STYLE.draft;
  return (
    <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border capitalize ${cls}`}>
      {s}
    </span>
  );
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-sm text-text-tertiary">
        {message}
      </td>
    </tr>
  );
}

function periodStartDate(period: Period): string | null {
  if (period === 'all') return null;
  const d = new Date();
  d.setDate(d.getDate() - parseInt(period));
  return d.toISOString().split('T')[0];
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    ),
  ];
  return lines.join('\n');
}

function getPriceSegment(priceLacs: number | null): string {
  if (!priceLacs) return 'Unknown';
  if (priceLacs < 40) return 'Under 40L';
  if (priceLacs <= 100) return '40L-1Cr';
  return '1Cr+';
}

function ExportDropdown({ onExport }: { onExport: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const options = [
    { key: 'projects', label: 'Export Projects CSV' },
    { key: 'campaigns', label: 'Export Campaigns CSV' },
    { key: 'metrics', label: 'Export Metrics CSV' },
    { key: 'sessions', label: 'Export Sessions JSON' },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border text-text-tertiary hover:text-text-primary hover:border-brand-border text-xs transition-all"
      >
        <Download size={13} />
        Export
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 bg-surface-elevated border border-border rounded-xl shadow-2xl z-20 overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => { onExport(opt.key); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-sm text-text-primary hover:bg-surface-hover transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Reports() {
  const { showToast } = useToast();
  const [period, setPeriod] = useState<Period>('30');
  const [kpis, setKpis] = useState<KPIs>({ campaigns: 0, leads: 0, spend: 0, avgCpl: 0 });
  const [kpisLoading, setKpisLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [aiSessions, setAiSessions] = useState<AiSession[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [awaasBusy, setAwaasBusy] = useState(false);
  const [awaasDownloadBusy, setAwaasDownloadBusy] = useState(false);

  useEffect(() => {
    loadAll(period);
  }, [period]);

  async function loadAll(p: Period) {
    loadKpisAndMetrics(p);
    loadCampaigns();
    loadAiSessions();
    loadActivity();
  }

  async function loadKpisAndMetrics(p: Period) {
    setKpisLoading(true);

    const campQ = supabase
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', getOrgId());

    let metricsQ = supabase
      .from('daily_metrics')
      .select('spend,leads')
      .eq('org_id', getOrgId());

    const startDate = periodStartDate(p);
    if (startDate) metricsQ = metricsQ.gte('date', startDate);

    const [{ count }, { data: metrics }] = await Promise.all([campQ, metricsQ]);

    const rows = (metrics ?? []) as { spend: number; leads: number }[];
    const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);
    const totalLeads = rows.reduce((s, r) => s + (r.leads ?? 0), 0);
    const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

    setKpis({ campaigns: count ?? 0, leads: totalLeads, spend: totalSpend, avgCpl });
    setKpisLoading(false);
  }

  async function loadCampaigns() {
    setCampaignsLoading(true);
    const { data } = await supabase
      .from('campaigns')
      .select('id,campaign_name,funnel_stage,platform,status,budget,source,created_at,projects(name)')
      .eq('org_id', getOrgId())
      .order('created_at', { ascending: false })
      .limit(20);

    const rows = ((data ?? []) as unknown[]).map((r: unknown) => {
      const row = r as Record<string, unknown>;
      const proj = row.projects as { name: string } | null;
      const budget = (row.budget as Record<string, unknown>) ?? {};
      return {
        id: row.id as string,
        campaign_name: row.campaign_name as string,
        project_name: proj?.name ?? '—',
        funnel_stage: (row.funnel_stage as string | null) ?? null,
        platform: (row.platform as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        daily_budget: typeof budget.daily === 'number' ? budget.daily : typeof budget.daily_budget === 'number' ? budget.daily_budget : null,
        source: (row.source as string | null) ?? null,
        created_at: (row.created_at as string) ?? '',
      } as Campaign;
    });
    setCampaigns(rows);
    setCampaignsLoading(false);
  }

  async function loadAiSessions() {
    setAiLoading(true);
    const { data } = await supabase
      .from('ai_sessions')
      .select('id,session_type,input_summary,tokens_used,created_at')
      .eq('org_id', getOrgId())
      .order('created_at', { ascending: false })
      .limit(20);
    setAiSessions((data ?? []) as AiSession[]);
    setAiLoading(false);
  }

  async function loadActivity() {
    setActivityLoading(true);
    const { data } = await supabase
      .from('activity_log')
      .select('id,action,entity_type,created_at')
      .eq('org_id', getOrgId())
      .order('created_at', { ascending: false })
      .limit(20);
    setActivity((data ?? []) as ActivityEntry[]);
    setActivityLoading(false);
  }

  async function handleExport(type: string) {
    try {
      if (type === 'projects') {
        const { data, error } = await supabase.from('projects').select('*').eq('org_id', getOrgId());
        if (error) throw error;
        downloadFile(toCSV((data ?? []) as Record<string, unknown>[]), 'NH_Projects.csv', 'text/csv');
        showToast('Exported NH_Projects.csv', 'success');
      } else if (type === 'campaigns') {
        const { data, error } = await supabase.from('campaigns').select('*').eq('org_id', getOrgId());
        if (error) throw error;
        const flat = ((data ?? []) as Record<string, unknown>[]).map((row) => {
          const targeting = (row.targeting as Record<string, unknown>) ?? {};
          const budget = (row.budget as Record<string, unknown>) ?? {};
          const creative = (row.creative_config as Record<string, unknown>) ?? {};
          const { targeting: _t, budget: _b, creative_config: _c, ...rest } = row;
          void _t; void _b; void _c;
          return {
            ...rest,
            targeting_age: targeting.age_range ?? '',
            targeting_gender: targeting.gender ?? '',
            targeting_cities: Array.isArray(targeting.cities) ? targeting.cities.join('; ') : '',
            budget_daily: budget.daily ?? budget.daily_budget ?? '',
            budget_total: budget.total ?? '',
            creative_format: creative.format ?? '',
            creative_angle: creative.angle ?? '',
          };
        });
        downloadFile(toCSV(flat), 'NH_Campaigns.csv', 'text/csv');
        showToast('Exported NH_Campaigns.csv', 'success');
      } else if (type === 'metrics') {
        const { data, error } = await supabase.from('daily_metrics').select('*').eq('org_id', getOrgId()).order('date');
        if (error) throw error;
        downloadFile(toCSV((data ?? []) as Record<string, unknown>[]), 'NH_Metrics.csv', 'text/csv');
        showToast('Exported NH_Metrics.csv', 'success');
      } else if (type === 'sessions') {
        const { data, error } = await supabase.from('ai_sessions').select('*').eq('org_id', getOrgId()).order('created_at', { ascending: false });
        if (error) throw error;
        downloadFile(JSON.stringify(data ?? [], null, 2), 'NH_AI_Sessions.json', 'application/json');
        showToast('Exported NH_AI_Sessions.json', 'success');
      }
    } catch (err: unknown) {
      showToast('Export failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }
  }

  async function handleGenerateAwaas() {
    setAwaasBusy(true);
    try {
      const { data: campData, error } = await supabase
        .from('campaigns')
        .select('*, projects(price_range_lacs, unit_types, status, city)')
        .eq('org_id', getOrgId());

      if (error) throw error;

      const inserts = ((campData ?? []) as unknown[]).map((r: unknown) => {
        const row = r as Record<string, unknown>;
        const proj = (row.projects as Record<string, unknown>) ?? {};
        const targeting = (row.targeting as Record<string, unknown>) ?? {};
        const budget = (row.budget as Record<string, unknown>) ?? {};
        const creative = (row.creative_config as Record<string, unknown>) ?? {};
        const priceLacs = proj.price_range_lacs as number | null;

        return {
          org_id: getOrgId(),
          data_type: 'campaign_performance',
          anonymized_data: {
            city: proj.city ?? (targeting.cities as unknown[])?.[0] ?? null,
            price_segment: getPriceSegment(priceLacs),
            unit_type: proj.unit_types ?? null,
            funnel: row.funnel_stage ?? null,
            platform: row.platform ?? null,
            age_range: targeting.age_range ?? null,
            budget_daily: budget.daily ?? budget.daily_budget ?? null,
            cpl: null,
            ctr: null,
            leads: null,
            svs: null,
            bookings: null,
            creative_angle: creative.angle ?? null,
            review_score: null,
          },
          city: String(proj.city ?? (targeting.cities as unknown[])?.[0] ?? ''),
          price_segment: getPriceSegment(priceLacs),
          unit_type: String(proj.unit_types ?? ''),
          project_status: String(proj.status ?? row.status ?? ''),
        };
      });

      if (inserts.length === 0) {
        showToast('No campaign data to export', 'info');
        setAwaasBusy(false);
        return;
      }

      const { error: insertErr } = await supabase.from('awaas_data_pool').insert(inserts);
      if (insertErr) throw insertErr;

      showToast('Anonymized data exported to AWAAS pool', 'success');
    } catch (err: unknown) {
      showToast('AWAAS export failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }
    setAwaasBusy(false);
  }

  async function handleDownloadAwaas() {
    setAwaasDownloadBusy(true);
    try {
      const { data, error } = await supabase
        .from('awaas_data_pool')
        .select('*')
        .eq('org_id', getOrgId())
        .order('created_at', { ascending: false });
      if (error) throw error;
      downloadFile(JSON.stringify(data ?? [], null, 2), 'NH_AWAAS_Export.json', 'application/json');
      showToast('Exported NH_AWAAS_Export.json', 'success');
    } catch (err: unknown) {
      showToast('Download failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }
    setAwaasDownloadBusy(false);
  }

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-3">
          <BarChart3 size={20} className="text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Reports</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Activity overview and performance summary</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportDropdown onExport={handleExport} />
          <div className="w-44">
            <Select
              options={PERIOD_OPTIONS}
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <Card className="p-5">
          <SectionLabel>KPI Summary</SectionLabel>
          {kpisLoading ? (
            <div className="flex items-center gap-2 mt-4">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading…</span>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4 mt-4">
              <KpiCard label="Total Campaigns" value={String(kpis.campaigns)} />
              <KpiCard label="Total Leads" value={fmt(kpis.leads)} sub="from daily metrics" />
              <KpiCard label="Total Spend" value={fmtRs(kpis.spend)} />
              <KpiCard
                label="Avg CPL"
                value={kpis.leads > 0 ? fmtRs(kpis.avgCpl) : '—'}
                sub={kpis.leads > 0 ? 'spend ÷ leads' : 'no leads yet'}
              />
            </div>
          )}
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <SectionLabel>Campaign Performance</SectionLabel>
            {campaignsLoading && <Spinner size="sm" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Campaign</th>
                  <th className={TH}>Project</th>
                  <th className={TH}>Stage</th>
                  <th className={TH}>Platform</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Source</th>
                  <th className={TH}>Created</th>
                </tr>
              </thead>
              <tbody>
                {campaignsLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center">
                      <Spinner size="sm" />
                    </td>
                  </tr>
                ) : campaigns.length === 0 ? (
                  <EmptyRow cols={7} message="No campaigns created yet." />
                ) : (
                  campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-surface-hover transition-colors">
                      <td className={TD}>{c.campaign_name}</td>
                      <td className={`${TD} text-text-tertiary`}>{c.project_name}</td>
                      <td className={`${TD} text-text-tertiary`}>{c.funnel_stage ?? '—'}</td>
                      <td className={`${TD} text-text-tertiary`}>{c.platform ?? '—'}</td>
                      <td className={TD}>
                        <StatusBadge status={c.status} />
                      </td>
                      <td className={`${TD} text-text-tertiary`}>
                        {c.source ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] border bg-surface-sunken text-text-tertiary border-border capitalize">
                            {c.source.replace(/_/g, ' ')}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`${TD} text-text-tertiary`}>
                        {c.created_at ? fmtDate(c.created_at) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <SectionLabel>AI Activity</SectionLabel>
            {aiLoading && <Spinner size="sm" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Date</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Summary</th>
                  <th className={TH}>Tokens Used</th>
                </tr>
              </thead>
              <tbody>
                {aiLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center">
                      <Spinner size="sm" />
                    </td>
                  </tr>
                ) : aiSessions.length === 0 ? (
                  <EmptyRow cols={4} message="No AI sessions yet." />
                ) : (
                  aiSessions.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-hover transition-colors">
                      <td className={`${TD} text-text-tertiary`}>{fmtDate(s.created_at)}</td>
                      <td className={TD}>
                        <span className="px-2 py-0.5 rounded-md text-[11px] border bg-brand-subtle text-brand-text border-brand-border capitalize">
                          {s.session_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className={`${TD} text-text-tertiary max-w-xs truncate`}>
                        {s.input_summary ?? '—'}
                      </td>
                      <td className={`${TD} text-text-tertiary`}>{fmt(s.tokens_used)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <SectionLabel>Recent Activity</SectionLabel>
            {activityLoading && <Spinner size="sm" />}
          </div>
          {activityLoading ? (
            <div className="flex items-center gap-2 px-5 py-6">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading…</span>
            </div>
          ) : activity.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-tertiary">
              No activity logged yet.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-5 py-3 hover:bg-surface-hover transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                    <p className="text-sm text-text-primary">{a.action}</p>
                    {a.entity_type && (
                      <span className="text-xs text-text-tertiary border border-border px-1.5 py-0.5 rounded capitalize">
                        {a.entity_type}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-tertiary flex-shrink-0">{fmtDate(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Database size={16} className="text-amber-400" />
            <SectionLabel>AWAAS Data Pipeline</SectionLabel>
          </div>
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-5">
            <span className="text-amber-400 flex-shrink-0 mt-0.5 text-sm">⚠</span>
            <p className="text-xs text-amber-300 leading-relaxed">
              Anonymized data for cross-builder benchmarking. No project names or company info exported.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerateAwaas}
              disabled={awaasBusy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-subtle border border-brand-border text-brand-text text-sm font-medium hover:bg-brand-subtle-hover disabled:opacity-50 transition-all"
            >
              {awaasBusy ? <Spinner size="sm" /> : <Database size={14} />}
              {awaasBusy ? 'Generating…' : 'Generate Anonymized Export'}
            </button>
            <button
              onClick={handleDownloadAwaas}
              disabled={awaasDownloadBusy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-text-tertiary hover:text-text-primary hover:border-brand-border text-sm transition-all disabled:opacity-50"
            >
              {awaasDownloadBusy ? <Spinner size="sm" /> : <Download size={14} />}
              {awaasDownloadBusy ? 'Downloading…' : 'Download AWAAS Export'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

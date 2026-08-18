import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, BarChart3, Link2, PencilLine } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { getMetaSyncProvider, type CampaignMetricRow, type MetaConnectionStatus } from '../lib/providers';
import { runAdAnalysis, type AdAnalysisResult, type AdMetrics } from '../lib/ad-analysis';
import { saveToolOutput } from '../lib/history-service';
import { AdAnalysisOutput } from '../components/AdAnalysisOutput';
import { Analyzer } from './Analyzer';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../contexts/ToastContext';
import { useNavigation } from '../contexts/NavigationContext';
import { useGenerationLock } from '../hooks/useGenerationLock';
import { minutesSince, shouldAutoSync } from '../lib/monitor-freshness';

const RANGE_DAYS = 7;
const STALE_MINUTES = 60;

interface Project { id: string; name: string; }

function rowToMetrics(rows: CampaignMetricRow[]): AdMetrics {
  // Aggregate a campaign's rows in the window into one metrics object for analysis.
  const sum = (f: (r: CampaignMetricRow) => number | null) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  const spend = sum((r) => r.spend);
  const leads = sum((r) => r.leads);
  const impressions = sum((r) => r.impressions);
  const reach = sum((r) => r.reach);
  const clicks = sum((r) => r.clicks);
  return {
    spend, leads, impressions, reach,
    cpl: leads > 0 ? Math.round(spend / leads) : 0,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
    frequency: reach > 0 ? Math.round((impressions / reach) * 10) / 10 : 0,
  };
}

export function PerformanceMonitor() {
  const { navigate } = useNavigation();
  const { start: startGeneration, stop: stopGeneration } = useGenerationLock();
  const { showToast } = useToast();
  const provider = useMemo(() => getMetaSyncProvider(), []);

  const [mode, setMode] = useState<'monitor' | 'manual'>('monitor');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('all');
  const [connection, setConnection] = useState<MetaConnectionStatus | null>(null);
  const [rows, setRows] = useState<CampaignMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [analysis, setAnalysis] = useState<{ campaignName: string; result: AdAnalysisResult; savedId?: string } | null>(null);
  const [analysing, setAnalysing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = getOrgId();
    const [conn, metrics] = await Promise.all([
      provider.getConnectionStatus(orgId),
      provider.getMetrics(orgId, projectId === 'all' ? null : projectId, RANGE_DAYS),
    ]);
    setConnection(conn);
    setRows(metrics);
    setLoading(false);
    return { conn, metrics };
  }, [provider, projectId]);

  useEffect(() => {
    supabase.from('projects').select('id,name').eq('is_active', true).eq('org_id', getOrgId()).order('name')
      .then(({ data }) => setProjects((data ?? []) as Project[]));
  }, []);

  // Auto-sync trigger: connected + (zero rows | stale > 60m). No Meta call on
  // a healthy fresh load. Project-switch re-runs load(), and this effect
  // re-evaluates staleness for the new selection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { conn, metrics } = await load();
      if (cancelled || syncing) return;
      if (shouldAutoSync({ connected: conn.connected, lastSyncAt: conn.lastSyncAt ?? null, hasRows: metrics.length > 0, staleMinutes: STALE_MINUTES })) {
        await handleSync();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleSync() {
    setSyncing(true);
    startGeneration('Syncing Meta data…');
    try {
      await provider.triggerSync(getOrgId(), projectId === 'all' ? null : projectId);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync failed', 'error');
    } finally {
      setSyncing(false);
      stopGeneration();
    }
  }

  async function handleAnalyse(campaignName: string, campaignRows: CampaignMetricRow[]) {
    setAnalysing(true);
    setAnalysis(null);
    startGeneration('Analyzing performance…');
    try {
      const result = await runAdAnalysis({
        metrics: rowToMetrics(campaignRows),
        projectName: projects.find((p) => p.id === projectId)?.name ?? 'All Projects',
        projectId: projectId === 'all' ? undefined : projectId,
        periodDays: RANGE_DAYS,
      });
      setAnalysis({ campaignName, result });
    } finally {
      setAnalysing(false);
      stopGeneration();
    }
  }

  async function handleSaveAnalysis() {
    if (!analysis || analysis.result.status !== 'ok') return;
    const output = await saveToolOutput({
      orgId: getOrgId(),
      domain: 'ads',
      tool: 'performance',
      payload: { campaign: analysis.campaignName, analysis: analysis.result.data },
      status: 'saved',
    });
    setAnalysis({ ...analysis, savedId: output.id });
    showToast('Analysis saved to History.', 'success');
  }

  // Group the window's rows by campaign for the list.
  const byCampaign = useMemo(() => {
    const map = new Map<string, CampaignMetricRow[]>();
    for (const r of rows) {
      const key = r.campaign_id;
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    return [...map.entries()].map(([id, rs]) => ({
      id, name: rs[0].campaign_name ?? id, rows: rs, metrics: rowToMetrics(rs),
    }));
  }, [rows]);

  const lastSyncMins = minutesSince(connection?.lastSyncAt ?? null);

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Performance Monitor</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Live Meta ad metrics + AI analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMode('monitor')} className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${mode === 'monitor' ? 'bg-brand text-white border-brand' : 'border-border text-text-tertiary'}`}>
            <BarChart3 size={13} className="inline mr-1" />Monitor
          </button>
          <button onClick={() => setMode('manual')} className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${mode === 'manual' ? 'bg-brand text-white border-brand' : 'border-border text-text-tertiary'}`}>
            <PencilLine size={13} className="inline mr-1" />Manual entry
          </button>
        </div>
      </div>

      {mode === 'manual' ? (
        // Manual / CSV / Meta-research fallback — the existing Analyzer, unchanged.
        <Analyzer />
      ) : loading ? (
        <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
      ) : connection && !connection.connected && connection.state === 'invalid' ? (
        // RB-MO STEP 7 — the third variant. A BROKEN connection used to render
        // identically to a brand-new org ("Connect Meta"), so nothing on screen
        // ever told a customer their integration had stopped working. It is a
        // different message, a different colour, and a different verb.
        <Card className="p-10 flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Link2 size={26} className="text-amber-400" />
          </div>
          <div>
            <p className="text-base font-medium text-text-primary">Your Meta connection expired</p>
            <p className="text-sm text-text-tertiary max-w-sm mt-1">
              Meta is no longer accepting the stored access token, so metrics have stopped syncing. Reconnecting takes a few seconds and restores automatic sync.
            </p>
          </div>
          <Button onClick={() => navigate('settings')}><Link2 size={15} />Reconnect in Settings</Button>
          <button onClick={() => setMode('manual')} className="text-xs text-text-tertiary hover:text-brand transition-colors">Or analyze metrics manually →</button>
        </Card>
      ) : connection && !connection.connected ? (
        // First-class empty state: never connected. No error toasts.
        <Card className="p-10 flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-brand-subtle border border-brand-border flex items-center justify-center">
            <Link2 size={26} className="text-brand" />
          </div>
          <div>
            <p className="text-base font-medium text-text-primary">Connect Meta to see live performance</p>
            <p className="text-sm text-text-tertiary max-w-sm mt-1">Once your Meta Ads account is connected in Settings, campaign metrics sync automatically and appear here.</p>
          </div>
          <Button onClick={() => navigate('settings')}><Link2 size={15} />Connect Meta in Settings</Button>
          <button onClick={() => setMode('manual')} className="text-xs text-text-tertiary hover:text-brand transition-colors">Or analyze metrics manually →</button>
        </Card>
      ) : (
        <>
          <Card className="p-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Select
                label=""
                options={[{ value: 'all', label: 'All Projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              />
              <span className="text-xs text-text-tertiary">
                {lastSyncMins === null ? 'Never synced' : lastSyncMins === 0 ? 'Synced just now' : `Last synced ${lastSyncMins}m ago`}
              </span>
            </div>
            <Button variant="ghost" onClick={handleSync} disabled={syncing}>
              {syncing ? <Spinner size="sm" /> : <RefreshCw size={14} />}{syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          </Card>

          {byCampaign.length === 0 ? (
            <Card className="p-10 text-center">
              <p className="text-sm text-text-tertiary">No metrics for the last {RANGE_DAYS} days yet. {syncing ? 'Syncing…' : 'Try "Sync now".'}</p>
            </Card>
          ) : (
            <div className="bg-surface-elevated border border-border rounded-xl overflow-hidden mb-6">
              <table className="w-full">
                <thead><tr className="border-b border-border">
                  {['Campaign', 'Spend', 'Leads', 'CPL', 'CTR', ''].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {byCampaign.map((c) => (
                    <tr key={c.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-4 text-[13px] font-medium text-text-primary">{c.name}</td>
                      <td className="px-5 py-4 text-[13px] text-text-tertiary">₹{(c.metrics.spend ?? 0).toLocaleString('en-IN')}</td>
                      <td className="px-5 py-4 text-[13px] text-text-tertiary">{c.metrics.leads ?? 0}</td>
                      <td className="px-5 py-4 text-[13px] text-text-tertiary">₹{c.metrics.cpl ?? 0}</td>
                      <td className="px-5 py-4 text-[13px] text-text-tertiary">{c.metrics.ctr ?? 0}%</td>
                      <td className="px-5 py-4 text-right">
                        <button onClick={() => handleAnalyse(c.name, c.rows)} disabled={analysing}
                          className="text-xs text-brand hover:text-brand-hover font-medium disabled:opacity-50">Analyse</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {analysing && <div className="flex items-center justify-center py-8"><Spinner size="md" /></div>}
          {analysis && analysis.result.status === 'error' && <Card className="p-4"><p className="text-sm text-red-400">{analysis.result.message}</p></Card>}
          {analysis && analysis.result.status === 'raw' && <Card className="p-4"><pre className="text-xs whitespace-pre-wrap">{analysis.result.text}</pre></Card>}
          {analysis && analysis.result.status === 'ok' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-text-primary">Analysis — {analysis.campaignName}</p>
              <AdAnalysisOutput data={analysis.result.data} onRetry={() => setAnalysis(null)} />
              <Button onClick={handleSaveAnalysis} disabled={!!analysis.savedId} className="w-fit">
                {analysis.savedId ? 'Saved to History' : 'Save Analysis'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

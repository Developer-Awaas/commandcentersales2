import { useCallback, useEffect, useMemo, useState } from 'react';
import { Smartphone, BarChart3, PencilLine } from 'lucide-react';
import { getOrgId } from '../lib/constants';
import { getSocialMetricsProvider, type SocialMetricRow, type SocialTargets } from '../lib/providers';
import { buildSMMAnalyzerPrompt } from '../lib/smm-prompts';
import { aiCall, isAiEnabled } from '../lib/ai-service';
import { saveToolOutput } from '../lib/history-service';
import SMMAnalyzer from './SMMAnalyzer';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../contexts/ToastContext';
import { useGenerationLock } from '../hooks/useGenerationLock';

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];
const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
];

function avg(rows: SocialMetricRow[], f: (r: SocialMetricRow) => number | null): number | undefined {
  const vals = rows.map(f).filter((v): v is number => v != null);
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : undefined;
}

export function SMMMonitor() {
  const { start: startGeneration, stop: stopGeneration } = useGenerationLock();
  const { showToast } = useToast();
  const provider = useMemo(() => getSocialMetricsProvider(), []);

  const [mode, setMode] = useState<'monitor' | 'manual'>('monitor');
  const [platform, setPlatform] = useState('instagram');
  const [rangeDays, setRangeDays] = useState('30');
  const [rows, setRows] = useState<SocialMetricRow[]>([]);
  const [targets, setTargets] = useState<SocialTargets | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<{ text: string; savedId?: string } | null>(null);
  const [analysing, setAnalysing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = getOrgId();
    const sinceDate = new Date(Date.now() - parseInt(rangeDays) * 86400000).toISOString().slice(0, 10);
    const [metrics, tgts] = await Promise.all([
      provider.getMetrics(orgId, { sinceDate, platform }),
      provider.getTargets(orgId),
    ]);
    setRows(metrics);
    setTargets(tgts);
    setLoading(false);
  }, [provider, rangeDays, platform]);

  useEffect(() => { load(); }, [load]);

  const windowMetrics = useMemo(() => ({
    followers: rows[0]?.followers ?? undefined, // latest snapshot
    posts_published: rows.reduce((a, r) => a + (r.posts_published ?? 0), 0) || undefined,
    avg_reach: avg(rows, (r) => r.avg_reach),
    avg_likes: avg(rows, (r) => r.avg_likes),
    avg_comments: avg(rows, (r) => r.avg_comments),
    engagement_rate: avg(rows, (r) => r.engagement_rate),
    follower_growth: rows.reduce((a, r) => a + (r.follower_growth ?? 0), 0) || undefined,
  }), [rows]);

  async function handleAnalyse() {
    if (!isAiEnabled()) { showToast('AI analysis is currently unavailable.', 'info'); return; }
    setAnalysing(true);
    setAnalysis(null);
    startGeneration('Analyzing social performance…');
    try {
      const prompt = buildSMMAnalyzerPrompt({
        platform,
        period: RANGE_OPTIONS.find((r) => r.value === rangeDays)?.label ?? `Last ${rangeDays} days`,
        metrics: windowMetrics,
      });
      const res = await aiCall(prompt);
      const text = res.raw ? String(res.raw) : (res.error ? String(res.error) : JSON.stringify(res, null, 2));
      setAnalysis({ text });
    } finally {
      setAnalysing(false);
      stopGeneration();
    }
  }

  async function handleSave() {
    if (!analysis) return;
    const output = await saveToolOutput({
      orgId: getOrgId(),
      domain: 'social',
      tool: 'smm_analysis',
      payload: { platform, period_days: rangeDays, metrics: windowMetrics, analysis: analysis.text },
      status: 'saved',
    });
    setAnalysis({ ...analysis, savedId: output.id });
    showToast('Analysis saved to History.', 'success');
  }

  const igTarget = targets?.ig_follower_target;
  const reachTarget = targets?.ig_reach_target;

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-3">
          <Smartphone size={20} className="text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">SMM Monitor</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Social metrics + AI analysis over a period</p>
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
        // Manual / screenshot fallback — the existing SMM Analyzer, unchanged.
        <SMMAnalyzer />
      ) : loading ? (
        <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <>
          <Card className="p-4 mb-6 flex items-center gap-3 flex-wrap">
            <Select label="" options={PLATFORM_OPTIONS} value={platform} onChange={(e) => setPlatform(e.target.value)} />
            <Select label="" options={RANGE_OPTIONS} value={rangeDays} onChange={(e) => setRangeDays(e.target.value)} />
            <Button onClick={handleAnalyse} disabled={analysing || rows.length === 0} className="ml-auto">
              {analysing ? <Spinner size="sm" /> : <BarChart3 size={14} />}Analyse this period
            </Button>
          </Card>

          {rows.length === 0 ? (
            <Card className="p-10 text-center flex flex-col items-center gap-2">
              <p className="text-sm text-text-tertiary">No {platform} metrics in this period yet.</p>
              <p className="text-xs text-text-tertiary max-w-sm">Auto-fetch from the Instagram Graph API isn't available yet — add snapshots via <button onClick={() => setMode('manual')} className="text-brand hover:underline">Manual entry</button>, or set targets in Settings.</p>
            </Card>
          ) : (
            <>
            {/* RB-PM2 STEP 4 — say where these numbers came from.
                There is NO Instagram fetch in this product (see the empty state
                above: "Auto-fetch from the Instagram Graph API isn't available
                yet"), and real IG insights would need instagram_manage_insights,
                which is not in the granted scope set. So every row in
                smm_metrics is hand-entered or seeded — it cannot be otherwise.
                Rendering these as bare figures next to Meta's real ad metrics
                invited exactly the wrong reading: the review org was showing
                "1050 avg reach" for an account that was never connected. */}
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <p className="text-[11px] text-amber-300">
                <strong>Manual targets</strong> — entered by hand, not measured. Instagram auto-fetch is not connected, so these are not live account figures.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                ['Followers', windowMetrics.followers, igTarget ? `target ${igTarget.toLocaleString('en-IN')}` : null],
                ['Avg Reach', windowMetrics.avg_reach, reachTarget ? `target ${reachTarget.toLocaleString('en-IN')}` : null],
                ['Avg Likes', windowMetrics.avg_likes, null],
                ['Engagement', windowMetrics.engagement_rate != null ? `${windowMetrics.engagement_rate}%` : undefined, null],
              ].map(([label, value, sub]) => (
                <Card key={label as string} className="p-4">
                  <p className="text-[10px] text-text-tertiary uppercase tracking-wide">{label}</p>
                  <p className="text-xl font-semibold text-text-primary mt-1">{value ?? '—'}</p>
                  {sub && <p className="text-[10px] text-text-tertiary mt-0.5">{sub}</p>}
                </Card>
              ))}
            </div>
            </>
          )}

          {analysing && <div className="flex items-center justify-center py-8"><Spinner size="md" /></div>}
          {analysis && (
            <Card className="p-5 flex flex-col gap-3">
              <p className="text-sm font-semibold text-text-primary">Analysis — {platform}, last {rangeDays} days</p>
              <pre className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed max-h-[420px] overflow-y-auto">{analysis.text}</pre>
              <Button onClick={handleSave} disabled={!!analysis.savedId} className="w-fit">
                {analysis.savedId ? 'Saved to History' : 'Save Analysis'}
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

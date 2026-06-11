import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { Card } from './ui/Card';
import { MetricsFreshnessBadge } from './MetricsFreshnessBadge';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { Spinner } from './ui/Spinner';

interface CampaignMetric {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  date_start: string;
  date_stop: string;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  cpl: number | null;
  ctr: number;
  synced_at: string;
}

interface CampaignMetricsChartProps {
  orgId?: string;
  campaignId?: string;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">{children}</p>;
}

export function CampaignMetricsChart({ orgId, campaignId }: CampaignMetricsChartProps) {
  const resolvedOrgId = orgId ?? getOrgId();
  const [rows, setRows] = useState<CampaignMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function fetchMetrics() {
    setLoading(true);
    let query = supabase
      .from('campaign_metrics')
      .select('id,campaign_id,campaign_name,date_start,date_stop,impressions,clicks,spend,leads,cpl,ctr,synced_at')
      .eq('org_id', resolvedOrgId)
      .eq('platform', 'meta')
      .order('date_start', { ascending: false })
      .limit(30);

    if (campaignId) query = query.eq('campaign_id', campaignId);

    const { data } = await query;
    setRows((data ?? []) as CampaignMetric[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchMetrics();

    const channel = supabase
      .channel(`campaign-metrics-chart-${resolvedOrgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_metrics', filter: `org_id=eq.${resolvedOrgId}` },
        () => { fetchMetrics(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [resolvedOrgId, campaignId]);

  async function handleSyncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const { error } = await supabase.functions.invoke('meta-insights-sync', { body: {} });
      if (error) {
        setSyncMsg('Sync failed: ' + error.message);
      } else {
        setSyncMsg('Sync triggered — data will refresh shortly.');
        await fetchMetrics();
      }
    } catch (err: unknown) {
      setSyncMsg('Sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(null), 6000);
  }

  // Aggregate totals
  const totals = rows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      spend: acc.spend + r.spend,
      leads: acc.leads + r.leads,
    }),
    { impressions: 0, clicks: 0, spend: 0, leads: 0 }
  );
  const avgCpl = totals.leads > 0 ? totals.spend / totals.leads : null;
  const avgCtr = rows.length > 0 ? rows.reduce((acc, r) => acc + r.ctr, 0) / rows.length : 0;

  // Chart data: last 14 rows reversed for chronological order
  const chartRows = rows.slice(0, 14).reverse();
  const maxLeads = Math.max(...chartRows.map((r) => r.leads), 1);
  const maxSpend = Math.max(...chartRows.map((r) => r.spend), 1);

  function fmtShortDate(s: string) {
    return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  const header = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <TrendingUp size={16} className="text-brand" />
        <span className="text-sm font-semibold text-text-primary">Auto-Synced Meta Metrics</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          title="Pull latest data from Meta now"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-text-tertiary hover:text-text-primary hover:border-brand-border text-[11px] transition-all disabled:opacity-50"
        >
          {syncing ? <Spinner size="sm" /> : <RefreshCw size={11} />}
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
        <MetricsFreshnessBadge orgId={resolvedOrgId} />
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="flex items-center gap-2 py-4">
          <Spinner size="sm" />
          <span className="text-xs text-text-tertiary">Loading metrics…</span>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {syncMsg && (
          <p className="text-xs text-brand">{syncMsg}</p>
        )}
        <div className="px-5 py-10 text-center rounded-xl border border-dashed border-border">
          <p className="text-sm text-text-tertiary">No auto-synced metrics yet.</p>
          <p className="text-xs text-text-tertiary mt-1">Connect Meta Ads in Settings → Meta Ads Integration, then click Sync Now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      {syncMsg && (
        <p className="text-xs text-brand">{syncMsg}</p>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Impressions', value: fmt(totals.impressions) },
          { label: 'Clicks', value: fmt(totals.clicks) },
          { label: 'Spend', value: `₹${fmt(totals.spend, 0)}` },
          { label: 'Leads', value: fmt(totals.leads) },
          { label: avgCpl !== null ? 'Avg CPL' : 'CTR', value: avgCpl !== null ? `₹${fmt(avgCpl, 0)}` : `${avgCtr.toFixed(2)}%` },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">{stat.label}</p>
            <p className="text-lg font-bold text-text-primary">{stat.value}</p>
          </Card>
        ))}
      </div>

      {/* Chart: spend + leads over time */}
      {chartRows.length > 0 && (
        <Card className="p-5">
          <SectionLabel>Spend &amp; Leads Trend (last {chartRows.length} periods)</SectionLabel>
          <div className="flex items-end gap-1.5 h-28 mt-3">
            {chartRows.map((r) => {
              const leadPct = maxLeads > 0 ? (r.leads / maxLeads) * 100 : 0;
              const spendPct = maxSpend > 0 ? (r.spend / maxSpend) * 100 : 0;
              return (
                <div key={r.id} className="flex items-end gap-0.5 flex-1 group relative">
                  {/* Spend bar */}
                  <div
                    className="flex-1 rounded-t-sm bg-brand/30 transition-all duration-300"
                    style={{ height: `${Math.max(spendPct, 4)}%` }}
                  />
                  {/* Leads bar */}
                  <div
                    className="flex-1 rounded-t-sm bg-brand transition-all duration-300"
                    style={{ height: `${Math.max(leadPct, 4)}%` }}
                  />
                  {/* Hover tooltip */}
                  <div className="absolute bottom-full mb-1.5 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
                    <div className="bg-surface-elevated border border-border rounded-lg px-2.5 py-1.5 text-[10px] text-text-primary whitespace-nowrap shadow-modal">
                      <div className="font-semibold">{fmtShortDate(r.date_start)}</div>
                      <div>{r.leads} leads</div>
                      <div>₹{fmt(r.spend, 0)} spend</div>
                      {r.cpl != null && <div>CPL ₹{fmt(r.cpl, 0)}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-brand" /><span className="text-[10px] text-text-tertiary">Leads</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-brand/30" /><span className="text-[10px] text-text-tertiary">Spend</span></div>
          </div>
        </Card>
      )}

      {/* Table */}
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <SectionLabel>Campaign Breakdown</SectionLabel>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Campaign', 'Period', 'Impressions', 'Clicks', 'Spend', 'Leads', 'CPL', 'CTR'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover transition-colors">
                  <td className="px-4 py-3 text-xs text-text-primary border-b border-border max-w-[160px] truncate">{r.campaign_name ?? r.campaign_id}</td>
                  <td className="px-4 py-3 text-xs text-text-tertiary border-b border-border whitespace-nowrap">{fmtShortDate(r.date_start)} – {fmtShortDate(r.date_stop)}</td>
                  <td className="px-4 py-3 text-xs text-text-primary border-b border-border">{fmt(r.impressions)}</td>
                  <td className="px-4 py-3 text-xs text-text-primary border-b border-border">{fmt(r.clicks)}</td>
                  <td className="px-4 py-3 text-xs text-text-primary border-b border-border">₹{fmt(r.spend, 0)}</td>
                  <td className="px-4 py-3 text-xs text-text-primary border-b border-border">{r.leads}</td>
                  <td className="px-4 py-3 text-xs border-b border-border">
                    {r.cpl != null ? <span className="text-brand">₹{fmt(r.cpl, 0)}</span> : <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-text-tertiary border-b border-border">{r.ctr.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

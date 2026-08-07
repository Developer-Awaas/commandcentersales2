/**
 * Usage — admin-only cost visibility over the agent_interactions ledger
 * (STEP 5). Reads are simple client-side aggregates (usage-aggregate.ts) over
 * one bounded fetch (last 35 days) — no new infra, no exports this pass. Gated
 * on the caller's own profiles.role = 'admin'; renders nothing otherwise.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getOrgId, getUserId } from '../../lib/constants';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import {
  byFeature, byProvider, byProject, dailyTrend, topN, totalCost, thisMonth,
  type LedgerRow, type CostBucket,
} from '../../lib/usage-aggregate';

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function BucketTable({ title, buckets }: { title: string; buckets: CostBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.cost), 0.000001);
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">{title}</p>
      {buckets.length === 0 ? (
        <p className="text-xs text-text-disabled">No spend recorded.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {buckets.map((b) => (
            <div key={b.key} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0 truncate text-text-secondary" title={b.key}>{b.key}</span>
              <div className="flex-1 bg-surface rounded h-4 overflow-hidden">
                <div className="h-full bg-brand/70" style={{ width: `${(b.cost / max) * 100}%` }} />
              </div>
              <span className="w-16 shrink-0 text-right tabular-nums text-text-primary">{usd(b.cost)}</span>
              <span className="w-10 shrink-0 text-right tabular-nums text-text-tertiary">{b.count}×</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UsageSection() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const uid = getUserId();
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
      const admin = (prof as { role?: string } | null)?.role === 'admin';
      setIsAdmin(admin);
      if (!admin) { setLoading(false); return; }

      const since = new Date();
      since.setDate(since.getDate() - 35);
      const [{ data: ledger }, { data: projects }] = await Promise.all([
        supabase
          .from('agent_interactions')
          .select('created_at, feature, agent, provider, project_id, cost_usd, model, call_type, image_count, input_tokens, output_tokens')
          .eq('org_id', getOrgId())
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase.from('projects').select('id, name').eq('org_id', getOrgId()),
      ]);
      setRows((ledger as LedgerRow[]) ?? []);
      const names: Record<string, string> = {};
      for (const p of (projects as { id: string; name: string }[]) ?? []) names[p.id] = p.name;
      setProjectNames(names);
      setLoading(false);
    })();
  }, []);

  if (isAdmin === false) return null; // not admin — surface hidden entirely
  if (loading) {
    return (
      <Card className="p-6 flex items-center gap-2">
        <Spinner size="sm" /><span className="text-xs text-text-tertiary">Loading usage…</span>
      </Card>
    );
  }

  const monthRows = thisMonth(rows);
  const trend = dailyTrend(rows, 30);
  const trendMax = Math.max(...trend.map((t) => t.cost), 0.000001);
  const top = topN(rows, 10);
  const monthTotal = totalCost(monthRows);

  return (
    <Card className="p-6 flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Usage — this month</p>
        <span className="text-sm font-semibold text-text-primary tabular-nums">{usd(monthTotal)}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <BucketTable title="By feature" buckets={byFeature(monthRows)} />
        <BucketTable title="By provider" buckets={byProvider(monthRows)} />
        <BucketTable title="By project" buckets={byProject(monthRows, projectNames)} />
      </div>

      {/* 30-day daily cost trend — CSS bars, no chart lib (repo rule). */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Last 30 days</p>
        <div className="flex items-end gap-[2px] h-20">
          {trend.map((t) => (
            <div
              key={t.day}
              className="flex-1 bg-brand/60 rounded-sm min-h-[1px]"
              style={{ height: `${(t.cost / trendMax) * 100}%` }}
              title={`${t.day}: ${usd(t.cost)}`}
            />
          ))}
        </div>
      </div>

      {/* Top 10 costliest interactions — click to drill down. */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Top 10 costliest interactions</p>
        {top.length === 0 ? (
          <p className="text-xs text-text-disabled">No interactions recorded yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {top.map((r, i) => {
              const key = `${r.created_at}-${i}`;
              const label = r.feature ?? r.agent ?? 'unknown';
              return (
                <div key={key} className="py-1.5">
                  <button
                    className="w-full flex items-center gap-2 text-xs text-left"
                    onClick={() => setExpanded(expanded === key ? null : key)}
                  >
                    <span className="flex-1 truncate text-text-secondary">{label}</span>
                    <span className="text-text-tertiary">{r.provider ?? '—'}</span>
                    <span className="w-16 text-right tabular-nums text-text-primary">{usd(r.cost_usd ?? 0)}</span>
                  </button>
                  {expanded === key && (
                    <div className="mt-1 pl-2 text-[11px] text-text-tertiary tabular-nums flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>model: {r.model}</span>
                      <span>type: {r.call_type ?? '—'}</span>
                      <span>in: {r.input_tokens} / out: {r.output_tokens} tok</span>
                      {r.image_count ? <span>images: {r.image_count}</span> : null}
                      <span>project: {r.project_id ? (projectNames[r.project_id] ?? r.project_id) : 'none'}</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

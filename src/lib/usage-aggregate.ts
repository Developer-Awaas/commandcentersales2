/**
 * Pure aggregation over agent_interactions rows for the admin Usage surface.
 * No I/O — UsageSection fetches the rows, this shapes them. Kept pure so the
 * money math is unit-tested (usage-aggregate.test.ts) without a DB.
 *
 * Attribution: agent-pipeline rows carry `agent` (null feature); client/non-agent
 * rows carry `feature` (null agent). One coalesced key drives every breakdown.
 */

export interface LedgerRow {
  created_at: string;
  feature: string | null;
  agent: string | null;
  provider: string | null;
  project_id: string | null;
  cost_usd: number | null;
  model: string;
  call_type: string | null;
  image_count: number | null;
  input_tokens: number;
  output_tokens: number;
}

export interface CostBucket {
  key: string;
  cost: number;
  count: number;
}

export interface DailyPoint {
  day: string; // YYYY-MM-DD, local time
  cost: number;
}

export function attributionKey(r: Pick<LedgerRow, 'feature' | 'agent'>): string {
  return r.feature ?? r.agent ?? 'unknown';
}

const cost = (r: LedgerRow): number => r.cost_usd ?? 0;

// Local-time ISO day (never toISOString — that shifts to UTC and drifts the
// day boundary; same rule as calendar-agenda.ts).
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bucket(rows: LedgerRow[], keyFn: (r: LedgerRow) => string): CostBucket[] {
  const m = new Map<string, CostBucket>();
  for (const r of rows) {
    const key = keyFn(r);
    const b = m.get(key) ?? { key, cost: 0, count: 0 };
    b.cost += cost(r);
    b.count += 1;
    m.set(key, b);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost);
}

export function byFeature(rows: LedgerRow[]): CostBucket[] {
  return bucket(rows, attributionKey);
}

export function byProvider(rows: LedgerRow[]): CostBucket[] {
  return bucket(rows, (r) => r.provider ?? 'unknown');
}

export function byProject(rows: LedgerRow[], projectNames: Record<string, string>): CostBucket[] {
  return bucket(rows, (r) => (r.project_id ? (projectNames[r.project_id] ?? 'Unknown project') : 'No project'));
}

export function totalCost(rows: LedgerRow[]): number {
  return rows.reduce((s, r) => s + cost(r), 0);
}

// Descending cost, take N (the costliest individual interactions).
export function topN(rows: LedgerRow[], n: number): LedgerRow[] {
  return [...rows].sort((a, b) => cost(b) - cost(a)).slice(0, n);
}

// One point per calendar day for the last `days` days ending today (inclusive),
// zero-filled so the trend chart has no gaps.
export function dailyTrend(rows: LedgerRow[], days: number, today: Date = new Date()): DailyPoint[] {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(isoDay(new Date(r.created_at)), (byDay.get(isoDay(new Date(r.created_at))) ?? 0) + cost(r));
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const day = isoDay(d);
    out.push({ day, cost: byDay.get(day) ?? 0 });
  }
  return out;
}

// Rows created in the current calendar month (local time).
export function thisMonth(rows: LedgerRow[], today: Date = new Date()): LedgerRow[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  return rows.filter((r) => {
    const d = new Date(r.created_at);
    return d.getFullYear() === y && d.getMonth() === m;
  });
}

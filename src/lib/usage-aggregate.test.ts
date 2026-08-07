import { describe, it, expect } from 'vitest';
import {
  attributionKey, byFeature, byProvider, byProject, dailyTrend, topN, totalCost, thisMonth, isoDay,
  type LedgerRow,
} from './usage-aggregate';

function row(p: Partial<LedgerRow>): LedgerRow {
  return {
    created_at: '2026-08-07T10:00:00Z',
    feature: null, agent: null, provider: null, project_id: null,
    cost_usd: 0, model: 'claude-sonnet-4-6', call_type: 'text',
    image_count: null, input_tokens: 0, output_tokens: 0,
    ...p,
  };
}

describe('attributionKey', () => {
  it('prefers feature, falls back to agent, then unknown', () => {
    expect(attributionKey({ feature: 'strategy', agent: null })).toBe('strategy');
    expect(attributionKey({ feature: null, agent: 'aanya' })).toBe('aanya');
    expect(attributionKey({ feature: null, agent: null })).toBe('unknown');
  });
});

describe('byFeature / byProvider / byProject', () => {
  const rows = [
    row({ feature: 'strategy', provider: 'anthropic', cost_usd: 0.02, project_id: 'p1' }),
    row({ feature: 'strategy', provider: 'anthropic', cost_usd: 0.03, project_id: 'p1' }),
    row({ agent: 'aanya', provider: 'openai', cost_usd: 0.10, project_id: 'p2' }),
    row({ feature: 'chatbot', provider: 'anthropic', cost_usd: 0.001, project_id: null }),
  ];

  it('sums + counts by coalesced feature, sorted desc by cost', () => {
    const b = byFeature(rows);
    expect(b[0]).toEqual({ key: 'aanya', cost: 0.10, count: 1 });
    expect(b.find((x) => x.key === 'strategy')).toEqual({ key: 'strategy', cost: 0.05, count: 2 });
  });

  it('by provider', () => {
    const b = byProvider(rows);
    expect(b.find((x) => x.key === 'anthropic')?.cost).toBeCloseTo(0.051, 8);
    expect(b.find((x) => x.key === 'openai')?.cost).toBe(0.10);
  });

  it('by project resolves names + buckets null as "No project"', () => {
    const b = byProject(rows, { p1: 'Ananta', p2: 'Zenith' });
    expect(b.find((x) => x.key === 'Ananta')?.cost).toBeCloseTo(0.05, 8);
    expect(b.find((x) => x.key === 'Zenith')?.cost).toBe(0.10);
    expect(b.find((x) => x.key === 'No project')?.count).toBe(1);
  });
});

describe('dailyTrend', () => {
  it('zero-fills every day in the window, local-time bucketed', () => {
    const today = new Date(2026, 7, 7); // Aug 7 2026 local
    const rows = [
      row({ created_at: new Date(2026, 7, 7, 9).toISOString(), cost_usd: 0.5 }),
      row({ created_at: new Date(2026, 7, 5, 9).toISOString(), cost_usd: 0.2 }),
    ];
    const t = dailyTrend(rows, 7, today);
    expect(t).toHaveLength(7);
    expect(t[t.length - 1]).toEqual({ day: isoDay(today), cost: 0.5 });
    expect(t.find((p) => p.day === isoDay(new Date(2026, 7, 5)))?.cost).toBe(0.2);
    expect(t.find((p) => p.day === isoDay(new Date(2026, 7, 6)))?.cost).toBe(0); // gap filled
  });
});

describe('topN / totalCost / thisMonth', () => {
  it('topN sorts by cost desc', () => {
    const rows = [row({ cost_usd: 1 }), row({ cost_usd: 5 }), row({ cost_usd: 3 })];
    expect(topN(rows, 2).map((r) => r.cost_usd)).toEqual([5, 3]);
  });
  it('totalCost treats null as 0', () => {
    expect(totalCost([row({ cost_usd: 0.1 }), row({ cost_usd: null })])).toBeCloseTo(0.1, 8);
  });
  it('thisMonth filters to current calendar month', () => {
    const today = new Date(2026, 7, 7);
    const rows = [
      row({ created_at: new Date(2026, 7, 1).toISOString() }),
      row({ created_at: new Date(2026, 6, 30).toISOString() }), // last month
    ];
    expect(thisMonth(rows, today)).toHaveLength(1);
  });
});

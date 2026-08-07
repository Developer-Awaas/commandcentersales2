import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the terminal insert payload — the bug #47 rule is to assert the row
// that would land, not merely that a function was called.
const insert = vi.fn((_row: Record<string, unknown>) => Promise.resolve({ error: null }));
vi.mock('./supabase', () => ({ supabase: { from: () => ({ insert }) } }));

const orgId = { v: 'org-1' };
const userId = { v: 'user-1' };
vi.mock('./constants', () => ({
  getOrgId: () => orgId.v,
  getUserId: () => userId.v,
}));

import { recordApiCost } from './api-cost';

beforeEach(() => { vi.clearAllMocks(); orgId.v = 'org-1'; userId.v = 'user-1'; });

describe('recordApiCost (client)', () => {
  it('writes a text row: agent=null, feature-attributed, cost derived from pricing', () => {
    recordApiCost({ provider: 'anthropic', callType: 'text', feature: 'strategy', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500, projectId: 'proj-9' });
    expect(insert).toHaveBeenCalledOnce();
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      org_id: 'org-1', user_id: 'user-1', agent: null,
      provider: 'anthropic', call_type: 'text', feature: 'strategy',
      model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 500,
      project_id: 'proj-9',
    });
    expect(row.cost_usd).toBeCloseTo(0.0105, 8);
  });

  it('image row: cost = unitCost * imageCount', () => {
    recordApiCost({ provider: 'openai', callType: 'image_gen', feature: 'creatives', model: 'gpt-image-1', imageCount: 3, unitCostUsd: 0.042 });
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.cost_usd).toBeCloseTo(0.126, 8);
    expect(row.image_count).toBe(3);
    expect(row.unit_cost_usd).toBe(0.042);
    expect(row.call_type).toBe('image_gen');
  });

  it('unknown model -> cost_usd NULL (row still written)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordApiCost({ provider: 'anthropic', callType: 'text', feature: 'x', model: 'mystery', inputTokens: 10, outputTokens: 10 });
    expect(insert).toHaveBeenCalledOnce();
    expect((insert.mock.calls[0][0] as Record<string, unknown>).cost_usd).toBeNull();
    warn.mockRestore();
  });

  it('no org context -> no insert (cannot attribute)', () => {
    orgId.v = '';
    recordApiCost({ provider: 'anthropic', callType: 'text', feature: 'x', model: 'claude-sonnet-4-6', inputTokens: 10, outputTokens: 10 });
    expect(insert).not.toHaveBeenCalled();
  });
});

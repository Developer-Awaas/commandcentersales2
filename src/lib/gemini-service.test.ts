import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same chainable-builder mock shape as history-service.test.ts.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const returnSelf = () => builder;
  builder.insert = vi.fn(returnSelf);
  builder.select = vi.fn(returnSelf);
  builder.single = vi.fn(() => Promise.resolve(result));
  return builder;
}

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

vi.mock('./constants', () => ({ getOrgId: () => 'org1' }));

beforeEach(() => { vi.clearAllMocks(); });

// Bug: uploadGeminiImageToSupabase's FUNNEL_MAP lookup used to force
// .toUpperCase() unconditionally, turning e.g. 'consideration' into
// 'CONSIDERATION' — which matched neither FUNNEL_MAP's uppercase
// TOFU/MOFU/BOFU keys nor its lowercase awareness/consideration/
// conversion passthrough keys, silently defaulting every DB-vocabulary
// caller to 'awareness'. Fixed at source (src/lib/gemini-service.ts) by
// trying the raw value first, only uppercasing as a fallback.
describe('uploadGeminiImageToSupabase — funnel-stage mapping', () => {
  async function uploadWith(funnelStage: string | undefined) {
    const { supabase } = await import('./supabase');
    let insertedRow: Record<string, unknown> | undefined;
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://x/img.png' } }),
    } as never);
    vi.mocked(supabase.from).mockImplementation(((_table: string) => {
      const b = makeBuilder({ data: { id: 'asset1' }, error: null });
      b.insert = vi.fn((row: Record<string, unknown>) => { insertedRow = row; return b; });
      return b;
    }) as never);

    const { uploadGeminiImageToSupabase } = await import('./gemini-service');
    await uploadGeminiImageToSupabase('YWJj', 'image/png', { angleLabel: 'feed', funnelStage });
    return insertedRow;
  }

  it('maps DB-vocabulary "consideration" to itself, not the default', async () => {
    const row = await uploadWith('consideration');
    expect(row?.funnel_stage).toBe('consideration');
  });

  it('maps DB-vocabulary "conversion" to itself', async () => {
    const row = await uploadWith('conversion');
    expect(row?.funnel_stage).toBe('conversion');
  });

  it('maps DB-vocabulary "awareness" to itself', async () => {
    const row = await uploadWith('awareness');
    expect(row?.funnel_stage).toBe('awareness');
  });

  it('maps legacy TOFU/MOFU/BOFU vocabulary via the uppercase fallback', async () => {
    expect((await uploadWith('TOFU'))?.funnel_stage).toBe('awareness');
    expect((await uploadWith('MOFU'))?.funnel_stage).toBe('consideration');
    expect((await uploadWith('BOFU'))?.funnel_stage).toBe('conversion');
  });

  it('maps lowercase "bofu" via the uppercase fallback too (case-insensitive for legacy vocabulary)', async () => {
    const row = await uploadWith('bofu');
    expect(row?.funnel_stage).toBe('conversion');
  });

  it('defaults to awareness when funnelStage is omitted (existing TOFU default, unchanged)', async () => {
    const row = await uploadWith(undefined);
    expect(row?.funnel_stage).toBe('awareness');
  });
});

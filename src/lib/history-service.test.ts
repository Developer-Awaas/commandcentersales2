import { describe, it, expect, vi, beforeEach } from 'vitest';

// No chainable Supabase query-builder mock exists yet in this repo (the
// only precedent, ai-service.mock.test.ts, mocks a flat object with no
// chained methods) — built one here. Each `.from()` call returns its own
// independent, mutation-free chainable builder resolving to a
// pre-configured { data, error } result: every chain method (select,
// insert, update, delete, eq, order, limit) returns the same builder, and
// the builder is thenable (awaiting it directly resolves the result) as
// well as exposing `.single()` for the single-row call shape.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const returnSelf = () => builder;
  builder.select = vi.fn(returnSelf);
  builder.insert = vi.fn(returnSelf);
  builder.update = vi.fn(returnSelf);
  builder.delete = vi.fn(returnSelf);
  builder.eq = vi.fn(returnSelf);
  builder.order = vi.fn(returnSelf);
  builder.limit = vi.fn(returnSelf);
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const callLog: string[] = [];

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

beforeEach(() => {
  callLog.length = 0;
  vi.clearAllMocks();
});

describe('saveToolOutput', () => {
  it('inserts and returns the created row', async () => {
    const { supabase } = await import('./supabase');
    const row = { id: 't1', org_id: 'org1', domain: 'ads', tool: 'strategy', campaign_id: null, payload: { a: 1 }, asset_refs: [], status: 'saved', created_at: '2026-07-30T00:00:00Z' };
    vi.mocked(supabase.from).mockReturnValueOnce(makeBuilder({ data: row, error: null }) as never);

    const { saveToolOutput } = await import('./history-service');
    const result = await saveToolOutput({ orgId: 'org1', domain: 'ads', tool: 'strategy', payload: { a: 1 } });

    expect(result).toEqual(row);
    expect(supabase.from).toHaveBeenCalledWith('tool_outputs');
  });

  it('throws with the Postgres error message when the insert fails', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.from).mockReturnValueOnce(makeBuilder({ data: null, error: { message: 'RLS violation' } }) as never);

    const { saveToolOutput } = await import('./history-service');
    await expect(saveToolOutput({ orgId: 'org1', domain: 'ads', tool: 'strategy', payload: {} }))
      .rejects.toThrow('RLS violation');
  });

  it('throws a specific error when insert succeeds but no row comes back (RLS SELECT gap)', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.from).mockReturnValueOnce(makeBuilder({ data: null, error: null }) as never);

    const { saveToolOutput } = await import('./history-service');
    await expect(saveToolOutput({ orgId: 'org1', domain: 'ads', tool: 'strategy', payload: {} }))
      .rejects.toThrow(/RLS SELECT policy/);
  });
});

describe('listToolOutputs', () => {
  it('filters by tool when provided', async () => {
    const { supabase } = await import('./supabase');
    const builder = makeBuilder({ data: [{ id: 't1' }], error: null });
    vi.mocked(supabase.from).mockReturnValueOnce(builder as never);

    const { listToolOutputs } = await import('./history-service');
    const result = await listToolOutputs('org1', 'ads', 'strategy', 10);

    expect(result).toEqual([{ id: 't1' }]);
    expect(builder.eq).toHaveBeenCalledWith('org_id', 'org1');
    expect(builder.eq).toHaveBeenCalledWith('domain', 'ads');
    expect(builder.eq).toHaveBeenCalledWith('tool', 'strategy');
    expect(builder.limit).toHaveBeenCalledWith(10);
  });

  it('omits the tool filter when not provided', async () => {
    const { supabase } = await import('./supabase');
    const builder = makeBuilder({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValueOnce(builder as never);

    const { listToolOutputs } = await import('./history-service');
    await listToolOutputs('org1', 'social');

    expect((builder.eq as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['org_id', 'domain']);
  });
});

describe('getCampaignJourney', () => {
  it('orders tool_outputs strategy -> ad_config -> ad_creatives -> ad_review regardless of insert order', async () => {
    const { supabase } = await import('./supabase');
    const outputs = [
      { id: 'o3', tool: 'ad_creatives', created_at: '2026-07-30T02:00:00Z' },
      { id: 'o1', tool: 'strategy', created_at: '2026-07-30T00:00:00Z' },
      { id: 'o4', tool: 'ad_review', created_at: '2026-07-30T03:00:00Z' },
      { id: 'o2', tool: 'ad_config', created_at: '2026-07-30T01:00:00Z' },
    ];
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'tool_outputs') return makeBuilder({ data: outputs, error: null });
      return makeBuilder({ data: [], error: null });
    }) as never);

    const { getCampaignJourney } = await import('./history-service');
    const journey = await getCampaignJourney('camp1');

    expect(journey.toolOutputs.map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
  });
});

describe('markStatus', () => {
  it('updates status by id', async () => {
    const { supabase } = await import('./supabase');
    const builder = makeBuilder({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValueOnce(builder as never);

    const { markStatus } = await import('./history-service');
    await markStatus('t1', 'completed');

    expect(builder.update).toHaveBeenCalledWith({ status: 'completed' });
    expect(builder.eq).toHaveBeenCalledWith('id', 't1');
  });

  it('throws on update failure', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.from).mockReturnValueOnce(makeBuilder({ data: null, error: { message: 'not found' } }) as never);

    const { markStatus } = await import('./history-service');
    await expect(markStatus('missing', 'completed')).rejects.toThrow('not found');
  });
});

describe('deleteToolOutput', () => {
  it('deletes storage objects from asset_refs BEFORE deleting the row (ordering)', async () => {
    const { supabase } = await import('./supabase');
    const assetRefs = [
      { bucket: 'brand-assets', path: 'a/1.png', creative_asset_id: 'ca1' },
      { bucket: 'brand-assets', path: 'a/2.png', creative_asset_id: 'ca2' },
    ];
    const fetchBuilder = makeBuilder({ data: { asset_refs: assetRefs }, error: null });
    const deleteBuilder = makeBuilder({ data: null, error: null });
    vi.mocked(supabase.from)
      .mockReturnValueOnce(fetchBuilder as never)  // select asset_refs
      .mockReturnValueOnce(deleteBuilder as never); // delete row

    const removeMock = vi.fn().mockImplementation(() => { callLog.push('storage.remove'); return Promise.resolve({ data: null, error: null }); });
    vi.mocked(supabase.storage.from).mockReturnValue({ remove: removeMock } as never);
    (deleteBuilder.delete as ReturnType<typeof vi.fn>).mockImplementation(() => { callLog.push('db.delete'); return deleteBuilder; });

    const { deleteToolOutput } = await import('./history-service');
    await deleteToolOutput('t1');

    expect(callLog).toEqual(['storage.remove', 'db.delete']);
    expect(removeMock).toHaveBeenCalledWith(['a/1.png', 'a/2.png']);
  });

  it('groups asset_refs by bucket into separate remove() calls', async () => {
    const { supabase } = await import('./supabase');
    const assetRefs = [
      { bucket: 'brand-assets', path: 'a/1.png' },
      { bucket: 'creative-assets', path: 'b/1.png' },
    ];
    vi.mocked(supabase.from)
      .mockReturnValueOnce(makeBuilder({ data: { asset_refs: assetRefs }, error: null }) as never)
      .mockReturnValueOnce(makeBuilder({ data: null, error: null }) as never);

    const removeMock = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(supabase.storage.from).mockReturnValue({ remove: removeMock } as never);

    const { deleteToolOutput } = await import('./history-service');
    await deleteToolOutput('t1');

    expect(supabase.storage.from).toHaveBeenCalledWith('brand-assets');
    expect(supabase.storage.from).toHaveBeenCalledWith('creative-assets');
    expect(removeMock).toHaveBeenCalledTimes(2);
  });

  it('still deletes the DB row when storage cleanup fails (non-fatal)', async () => {
    const { supabase } = await import('./supabase');
    const assetRefs = [{ bucket: 'brand-assets', path: 'a/1.png' }];
    const deleteBuilder = makeBuilder({ data: null, error: null });
    vi.mocked(supabase.from)
      .mockReturnValueOnce(makeBuilder({ data: { asset_refs: assetRefs }, error: null }) as never)
      .mockReturnValueOnce(deleteBuilder as never);

    vi.mocked(supabase.storage.from).mockReturnValue({
      remove: vi.fn().mockResolvedValue({ data: null, error: { message: 'storage down' } }),
    } as never);
    const deleteSpy = vi.fn(() => deleteBuilder);
    deleteBuilder.delete = deleteSpy;

    const { deleteToolOutput } = await import('./history-service');
    await expect(deleteToolOutput('t1')).resolves.toBeUndefined();
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('deletes the row directly when asset_refs is empty (no storage calls)', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.from)
      .mockReturnValueOnce(makeBuilder({ data: { asset_refs: [] }, error: null }) as never)
      .mockReturnValueOnce(makeBuilder({ data: null, error: null }) as never);

    const { deleteToolOutput } = await import('./history-service');
    await deleteToolOutput('t1');

    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it('throws if the final DB delete fails', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.from)
      .mockReturnValueOnce(makeBuilder({ data: { asset_refs: [] }, error: null }) as never)
      .mockReturnValueOnce(makeBuilder({ data: null, error: { message: 'fk violation' } }) as never);

    const { deleteToolOutput } = await import('./history-service');
    await expect(deleteToolOutput('t1')).rejects.toThrow('fk violation');
  });
});

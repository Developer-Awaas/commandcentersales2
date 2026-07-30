import { describe, it, expect, vi, beforeEach } from 'vitest';

// No chainable Supabase query-builder mock exists yet in this repo (the
// only precedent, ai-service.mock.test.ts, mocks a flat object with no
// chained methods) — built one here. Each `.from()` call returns its own
// independent, mutation-free chainable builder resolving to a
// pre-configured { data, error } result: every chain method (select,
// insert, update, delete, eq, order, limit) returns the same builder, and
// the builder is thenable (awaiting it directly resolves the result) as
// well as exposing `.single()` for the single-row call shape.
function makeBuilder(result: { data: unknown; error: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = {};
  const returnSelf = () => builder;
  builder.select = vi.fn(returnSelf);
  builder.insert = vi.fn(returnSelf);
  builder.update = vi.fn(returnSelf);
  builder.delete = vi.fn(returnSelf);
  builder.eq = vi.fn(returnSelf);
  builder.in = vi.fn(returnSelf);
  builder.not = vi.fn(returnSelf);
  builder.order = vi.fn(returnSelf);
  builder.limit = vi.fn(returnSelf);
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

// Queues one builder per call to `.from(table)`, keyed by table name —
// needed for distillCampaign, which hits several different tables (some
// more than once) in a fixed sequence.
function makeTableQueue(queues: Record<string, Array<{ data: unknown; error: unknown; count?: number | null }>>) {
  const cursors: Record<string, number> = {};
  return (table: string) => {
    const queue = queues[table] ?? [];
    const i = cursors[table] ?? 0;
    cursors[table] = i + 1;
    const result = queue[Math.min(i, queue.length - 1)] ?? { data: null, error: null };
    return makeBuilder(result) as never;
  };
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

describe('enforceRetentionCap', () => {
  it('does nothing when at or under the 30-row cap', async () => {
    const { supabase } = await import('./supabase');
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}` }));
    vi.mocked(supabase.from).mockReturnValueOnce(makeBuilder({ data: rows, error: null }) as never);

    const { enforceRetentionCap } = await import('./history-service');
    await enforceRetentionCap('org1', 'strategy');

    // Only the listing call — no deletes attempted.
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('deletes the oldest overflow rows beyond the 30-row cap', async () => {
    const { supabase } = await import('./supabase');
    // 33 rows, newest-first (matches the service's own ordering) — rows
    // beyond index 29 (3 of them) are the overflow to delete. Each overflow
    // row's deleteToolOutput makes two further `.from('tool_outputs')`
    // calls (select asset_refs, then delete) — dispatch by call order:
    // call 0 is the listing query, every pair after that is one row's
    // select+delete.
    const rows = Array.from({ length: 33 }, (_, i) => ({ id: `t${i}` }));
    const deleteCalls: string[] = [];
    let callIndex = -1;
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table !== 'tool_outputs') return makeBuilder({ data: null, error: null }) as never;
      callIndex += 1;
      if (callIndex === 0) return makeBuilder({ data: rows, error: null }) as never;
      const isSelectCall = (callIndex - 1) % 2 === 0;
      if (isSelectCall) return makeBuilder({ data: { asset_refs: [] }, error: null }) as never;
      const b = makeBuilder({ data: null, error: null });
      b.delete = vi.fn(() => ({
        eq: vi.fn((_col: string, id: string) => { deleteCalls.push(id); return Promise.resolve({ data: null, error: null }); }),
      }));
      return b as never;
    }) as never);

    const { enforceRetentionCap } = await import('./history-service');
    await enforceRetentionCap('org1', 'strategy');

    expect(deleteCalls.sort()).toEqual(['t30', 't31', 't32']);
  });
});

describe('distillCampaign', () => {
  it('dedupes on storage_path — skips assets already in aanya_training_creatives', async () => {
    const { supabase } = await import('./supabase');
    const from = makeTableQueue({
      campaigns: [{ data: { id: 'camp1', org_id: 'org1' }, error: null }],
      creative_assets: [
        { data: [{ id: 'ca1', project_id: 'p1', creative_id: null, image_url: 'https://x/a.png', storage_path: 'a.png', status: 'approved' }], error: null },
        { data: [], error: null }, // cleanupCampaignHistory's creative_assets re-fetch
      ],
      aanya_training_creatives: [
        { data: [{ storage_path: 'a.png' }], error: null }, // existing check — already distilled
      ],
      tool_outputs: [
        { data: [], error: null }, // cleanupCampaignHistory's tool_outputs fetch
      ],
    });
    vi.mocked(supabase.from).mockImplementation(from);

    const { distillCampaign } = await import('./history-service');
    const result = await distillCampaign('camp1');

    expect(result).toEqual({ distilledCount: 0, skippedDuplicateCount: 1 });
  });

  it('inserts new (non-duplicate) assets into aanya_training_creatives, then cleans up history', async () => {
    const { supabase } = await import('./supabase');
    const insertedRows: unknown[] = [];
    const deletedCreativeAssetsCampaigns: string[] = [];
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'campaigns') return makeBuilder({ data: { id: 'camp1', org_id: 'org1' }, error: null });
      if (table === 'creative_assets') {
        const b = makeBuilder({
          data: [{ id: 'ca1', project_id: 'p1', creative_id: null, image_url: 'https://x/new.png', storage_path: 'new.png', status: 'approved' }],
          error: null,
        });
        b.delete = vi.fn(() => ({
          eq: vi.fn((_col: string, val: string) => { deletedCreativeAssetsCampaigns.push(val); return Promise.resolve({ data: null, error: null }); }),
        }));
        return b;
      }
      if (table === 'aanya_training_creatives') {
        const b = makeBuilder({ data: [], error: null, count: 0 }); // existing check: empty, and liveCount check: 0
        b.insert = vi.fn((row: unknown) => { insertedRows.push(row); return makeBuilder({ data: null, error: null }); });
        return b;
      }
      if (table === 'tool_outputs') return makeBuilder({ data: [], error: null });
      return makeBuilder({ data: null, error: null });
    }) as never);

    const { distillCampaign } = await import('./history-service');
    const result = await distillCampaign('camp1');

    expect(result).toEqual({ distilledCount: 1, skippedDuplicateCount: 0 });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ org_id: 'org1', storage_path: 'new.png', source: 'own_ad', is_live: true });
    expect(deletedCreativeAssetsCampaigns).toEqual(['camp1']);
  });

  it('still cleans up history when the campaign has no creative_assets', async () => {
    const { supabase } = await import('./supabase');
    const from = makeTableQueue({
      campaigns: [{ data: { id: 'camp1', org_id: 'org1' }, error: null }],
      creative_assets: [{ data: [], error: null }],
      tool_outputs: [{ data: [], error: null }],
    });
    vi.mocked(supabase.from).mockImplementation(from);

    const { distillCampaign } = await import('./history-service');
    const result = await distillCampaign('camp1');

    expect(result).toEqual({ distilledCount: 0, skippedDuplicateCount: 0 });
  });
});

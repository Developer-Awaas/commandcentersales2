import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Async image-generation job flow (20260811120000).
 *
 * Context: Supabase returns 504 if a function hasn't responded in 150s, and a
 * quality:'high' multi-reference edit measures 129.4s live — so generation was
 * intermittently losing that race and hanging the browser request.
 * generate-image now returns a jobId and finishes in the background; these
 * tests pin the client half of that contract.
 *
 * The poll-fallback test is the important one: Realtime dropping is SILENT, and
 * without the poll a lost subscription reproduces the exact "request that never
 * completes" symptom this change exists to remove.
 */

const channelHandlers: ((payload: { new: unknown }) => void)[] = [];

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    storage: { from: vi.fn() },
    channel: vi.fn(() => {
      const ch: Record<string, unknown> = {};
      ch.on = vi.fn((_evt: string, _cfg: unknown, cb: (p: { new: unknown }) => void) => {
        channelHandlers.push(cb);
        return ch;
      });
      ch.subscribe = vi.fn(() => ch);
      return ch;
    }),
    removeChannel: vi.fn(),
  },
}));

vi.mock('./constants', () => ({ getOrgId: () => 'org1', getUserId: () => 'user1' }));
vi.mock('./feature-flags', () => ({ MOCK_AI_ENABLED: false, SINGLE_IMAGE_TESTING_MODE: false }));

// FileReader isn't in the jsdom-less path this module takes; stub the minimum.
class StubFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(_blob: Blob) {
    this.result = 'data:image/png;base64,QUJD';
    setTimeout(() => this.onload?.(), 0);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  channelHandlers.length = 0;
  vi.stubGlobal('FileReader', StubFileReader);
});
afterEach(() => { vi.unstubAllGlobals(); });

function mockJobRow(row: { status: string; storage_path: string | null; error: string | null } | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
}

async function callGenerate() {
  const { generateImageWithGemini } = await import('./gemini-service');
  return generateImageWithGemini('a prompt', '1:1', 'high', undefined, { feature: 'creatives' });
}

describe('generateImageWithGemini — async job flow', () => {
  it('resolves with the downloaded image once the job reaches done', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { jobId: 'job1' }, error: null } as never);
    // Realtime delivers the terminal state.
    vi.mocked(supabase.from).mockReturnValue(mockJobRow(null) as never);
    vi.mocked(supabase.storage.from).mockReturnValue({
      download: vi.fn().mockResolvedValue({ data: new Blob(['ABC'], { type: 'image/png' }), error: null }),
    } as never);

    const promise = callGenerate();
    // Let the invoke + subscription settle, then push the UPDATE.
    await vi.waitFor(() => expect(channelHandlers.length).toBe(1));
    channelHandlers[0]({ new: { status: 'done', storage_path: 'image-jobs/org1/job1.png', error: null } });

    const out = await promise;
    expect(out).toHaveLength(1);
    expect(out[0].base64).toBe('QUJD');
    expect(out[0].mimeType).toBe('image/png');
    // The subscription must be torn down, not leaked, on the success path.
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('throws the job error when the job reaches failed', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { jobId: 'job2' }, error: null } as never);
    vi.mocked(supabase.from).mockReturnValue(mockJobRow(null) as never);

    const promise = callGenerate();
    await vi.waitFor(() => expect(channelHandlers.length).toBe(1));
    channelHandlers[0]({ new: { status: 'failed', storage_path: null, error: 'OpenAI API error 502' } });

    await expect(promise).rejects.toThrow('OpenAI API error 502');
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('still completes via the 3s poll when Realtime never fires', async () => {
    vi.useFakeTimers();
    try {
      const { supabase } = await import('./supabase');
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { jobId: 'job3' }, error: null } as never);
      // Realtime stays silent for the whole test — only the poll can settle this.
      vi.mocked(supabase.from).mockReturnValue(
        mockJobRow({ status: 'done', storage_path: 'image-jobs/org1/job3.png', error: null }) as never,
      );
      vi.mocked(supabase.storage.from).mockReturnValue({
        download: vi.fn().mockResolvedValue({ data: new Blob(['ABC'], { type: 'image/png' }), error: null }),
      } as never);

      const promise = callGenerate();
      await vi.advanceTimersByTimeAsync(3_500);
      await vi.advanceTimersByTimeAsync(100);

      const out = await promise;
      expect(out[0].base64).toBe('QUJD');
      expect(channelHandlers).toHaveLength(1); // subscribed, but never delivered
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects rather than hanging forever when the job never settles', async () => {
    vi.useFakeTimers();
    try {
      const { supabase } = await import('./supabase');
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { jobId: 'job4' }, error: null } as never);
      vi.mocked(supabase.from).mockReturnValue(mockJobRow({ status: 'queued', storage_path: null, error: null }) as never);

      const promise = callGenerate();
      const assertion = expect(promise).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000 + 1_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a missing jobId instead of silently returning no image', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: {}, error: null } as never);
    await expect(callGenerate()).rejects.toThrow(/job id/i);
  });
});

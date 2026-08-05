import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force MOCK_AI_ENABLED without depending on import.meta.env at test time.
vi.mock('./feature-flags', () => ({
  MOCK_AI_ENABLED: true,
  LEADGEN_V2_ENABLED: false,
  SINGLE_IMAGE_TESTING_MODE: false,
}));

// ai-service.ts imports supabase.ts at module scope purely to call
// supabase.functions.invoke() inside logToLangfuse/checkQuota — neither of
// which the MOCK_AI_ENABLED branch reaches. Stub it so module import never
// touches real env-derived client construction in the test environment.
vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

describe('MOCK_AI_ENABLED — text choke point (aiCall/aiVision/describeImageForFlux)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aiCall returns the canned fixture and never calls the network', async () => {
    const { aiCall } = await import('./ai-service');
    const { supabase } = await import('./supabase');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await aiCall('any prompt', 'any system');

    expect(result.idea).toBeDefined();
    expect(result.creative_concept).toBeDefined();
    expect(result.nanobanana_prompt_main).toBeDefined();
    expect(result._inputTokens).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('aiVision returns the same superset fixture and never calls the network', async () => {
    const { aiVision } = await import('./ai-service');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await aiVision([{ role: 'user', content: [] }], 'system');

    expect(result.ad_copy).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('describeImageForFlux returns canned prose, not JSON, and never calls the network', async () => {
    const { describeImageForFlux } = await import('./ai-service');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await describeImageForFlux('https://example.com/x.jpg');

    expect(typeof result).toBe('string');
    expect(() => JSON.parse(result as string)).toThrow(); // prose, not JSON
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('MOCK_AI_ENABLED — image generation (generateImageWithGemini)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the placeholder image without invoking generate-image', async () => {
    vi.doMock('./constants', () => ({ getOrgId: () => 'org-1', getUserId: () => 'user-1' }));
    const { generateImageWithGemini } = await import('./gemini-service');
    const { supabase } = await import('./supabase');

    const images = await generateImageWithGemini('any prompt', '1:1');

    expect(images).toHaveLength(1);
    expect(images[0].mimeType).toBe('image/png');
    expect(images[0].base64.length).toBeGreaterThan(0);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});

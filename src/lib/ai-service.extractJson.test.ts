import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// extractJson is a pure function — no need for the MOCK_AI_ENABLED/supabase
// mocking boilerplate ai-service.mock.test.ts uses for aiCall.
vi.mock('./feature-flags', () => ({
  MOCK_AI_ENABLED: false,
  LEADGEN_V2_ENABLED: false,
  SINGLE_IMAGE_TESTING_MODE: false,
}));
vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('extractJson (T-025)', () => {
  let extractJson: (text: string) => unknown;

  beforeAll(async () => {
    ({ extractJson } = await import('./ai-service'));
  });

  it('parses plain unfenced JSON', () => {
    const text = '{"a": 1, "b": "two"}';
    expect(extractJson(text)).toEqual({ a: 1, b: 'two' });
  });

  it('parses a fenced ```json block with nothing else around it', () => {
    const text = '```json\n{"a": 1, "b": "two"}\n```';
    expect(extractJson(text)).toEqual({ a: 1, b: 'two' });
  });

  it('parses a fenced block surrounded by leading and trailing commentary', () => {
    const text = [
      "Sure, here's the JSON you asked for:",
      '```json',
      '{"a": 1, "b": "two"}',
      '```',
      'Let me know if you would like any changes!',
    ].join('\n');
    expect(extractJson(text)).toEqual({ a: 1, b: 'two' });
  });

  it('parses a fence with no "json" language tag', () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it('repairs a literal unescaped double-quote used for a nested quotation', () => {
    const synthetic = '{"testimonial": "They said "great service" and left happy"}';
    const result = extractJson(synthetic) as { testimonial: string };
    expect(result.testimonial).toBe('They said "great service" and left happy');
  });

  it('does not corrupt a normal string that legitimately ends right after a quoted word', () => {
    const text = '{"a": "ends with \\"quoted\\"", "b": 2}';
    expect(extractJson(text)).toEqual({ a: 'ends with "quoted"', b: 2 });
  });

  it('returns null for unparseable garbage', () => {
    expect(extractJson('not json at all')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractJson('')).toBeNull();
  });

  // T-025 regression fixture: real raw text captured live from aiCall() on
  // the SMM Creatives carousel path (cc.awaas.world, e2e account), where the
  // model wrote a genuinely unescaped literal `"` for a nested testimonial
  // quote inside carouselSlides[6] — not a fence/commentary issue. Captured
  // programmatically (never hand-transcribed) so the fixture is byte-faithful
  // to the actual failure this ticket was opened for.
  it('parses the real T-025 specimen (unescaped nested quote in a carousel slide)', () => {
    const raw = fs.readFileSync(join(__dirname, '__fixtures__', 't025-unescaped-quote-specimen.txt'), 'utf8');
    const result = extractJson(raw) as { carouselSlides: string[] };
    expect(result).not.toBeNull();
    expect(result.carouselSlides).toHaveLength(8);
    expect(result.carouselSlides[6]).toContain('"ZZ-INTERNAL-TEST didn\'t just find us a flat');
    expect(result.carouselSlides[6]).toContain('A Happy ZZ-INTERNAL-TEST Client');
  });
});

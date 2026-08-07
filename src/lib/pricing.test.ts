import { describe, it, expect, vi } from 'vitest';
import {
  textCostUsd, imageUnitCostUsd, MODEL_PRICING,
  OPENAI_IMAGE_COST_USD, GEMINI_IMAGE_COST_USD,
} from './pricing';

describe('pricing — text cost', () => {
  it('sonnet at $3/$15 per M', () => {
    // 1000 in + 500 out = (1000*3 + 500*15)/1e6 = 0.0105
    expect(textCostUsd('claude-sonnet-4-6', 1000, 500)).toBeCloseTo(0.0105, 8);
  });

  it('haiku at $1/$5 per M', () => {
    expect(textCostUsd('claude-haiku-4-5-20251001', 1000, 500)).toBeCloseTo(0.0035, 8);
  });

  it('unknown model -> null + warn (row still logs NULL, never skipped)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(textCostUsd('gpt-9-ultra', 1000, 500)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('zero tokens -> zero cost, not null', () => {
    expect(textCostUsd('claude-sonnet-4-6', 0, 0)).toBe(0);
  });
});

describe('pricing — image unit cost', () => {
  it('openai per-quality', () => {
    expect(imageUnitCostUsd('openai', 'low')).toBe(OPENAI_IMAGE_COST_USD.low);
    expect(imageUnitCostUsd('openai', 'high')).toBe(0.167);
  });

  it('gemini flat', () => {
    expect(imageUnitCostUsd('gemini', 'medium')).toBe(GEMINI_IMAGE_COST_USD);
  });

  it('unknown provider -> null + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(imageUnitCostUsd('midjourney', 'high')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

// Drift guard: these known values are duplicated in the edge mirror
// (supabase/functions/_shared/pricing.ts + pricing_test.ts). If a price
// changes, BOTH sides' tests must be updated — that's the "keep in sync" gate.
describe('pricing — known values (edge mirror must match)', () => {
  it('model rates', () => {
    expect(MODEL_PRICING['claude-sonnet-4-6']).toEqual({ inPerM: 3, outPerM: 15 });
    expect(MODEL_PRICING['claude-haiku-4-5-20251001']).toEqual({ inPerM: 1, outPerM: 5 });
  });
  it('image rates', () => {
    expect(OPENAI_IMAGE_COST_USD).toEqual({ low: 0.011, medium: 0.042, high: 0.167 });
    expect(GEMINI_IMAGE_COST_USD).toBe(0.039);
  });
});

/**
 * Per-model / per-image pricing map — the ONE place client-side cost figures
 * come from (mirrored, deliberately, in supabase/functions/_shared/pricing.ts
 * for the edge side — the two can't share a file across the Vite/Deno module
 * boundary). KEEP THE NUMBERS IN SYNC; pricing.test.ts on each side asserts the
 * same known values so drift trips CI.
 *
 * These are approximate published rates for cost-tracking/attribution, NOT
 * invoicing-grade. Re-verify against the providers' pricing pages before using
 * for real billing. Unknown model/provider -> null cost + a console.warn (the
 * row is still written, never silently skipped).
 */

export interface ModelPrice {
  inPerM: number; // USD per 1M input tokens
  outPerM: number; // USD per 1M output tokens
}

// Every model actually invoked in this repo (ai-service.ts + the specialists).
export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5-20251001': { inPerM: 1, outPerM: 5 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
};

export function textCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = MODEL_PRICING[model];
  if (!p) {
    console.warn(`[pricing] unknown model "${model}" — cost logged as NULL`);
    return null;
  }
  return (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000;
}

export type ImageQuality = 'low' | 'medium' | 'high';

// Matches OPENAI_IMAGE_COST_USD in _shared/image-provider.ts (per-image, 1024²).
export const OPENAI_IMAGE_COST_USD: Record<ImageQuality, number> = {
  low: 0.011,
  medium: 0.042,
  high: 0.167,
};
export const GEMINI_IMAGE_COST_USD = 0.039;

export function imageUnitCostUsd(provider: string, quality: ImageQuality): number | null {
  if (provider === 'openai') return OPENAI_IMAGE_COST_USD[quality] ?? null;
  if (provider === 'gemini') return GEMINI_IMAGE_COST_USD;
  console.warn(`[pricing] unknown image provider "${provider}" — cost logged as NULL`);
  return null;
}

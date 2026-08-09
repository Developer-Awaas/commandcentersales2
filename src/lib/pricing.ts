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

// RB-P7 — gpt-image-2 per-image rates (the new default). From OpenAI's published
// rates: text in $5/M, image in $8/M (refs ~3k tok high-fidelity), image out $30/M →
// portrait (1024x1536) ≈ $0.041 medium, ≈ $0.165 high. gpt-image-2 always runs high
// fidelity and REJECTS input_fidelity → no separate surcharge for it.
export const OPENAI_IMAGE_2_COST_USD: Record<ImageQuality, number> = { low: 0.011, medium: 0.041, high: 0.165 };
// gpt-image-1.5 rates (rollback tier). ⚠️ PLACEHOLDER = gpt-image-1 until confirmed.
export const OPENAI_IMAGE_15_COST_USD: Record<ImageQuality, number> = { low: 0.011, medium: 0.042, high: 0.167 };
// input_fidelity:'high' edit surcharge — gpt-image-1 / 1.5 only (gpt-image-2 rejects it).
export const INPUT_FIDELITY_HIGH_SURCHARGE_USD = 0.01;
// RB-P9 — per-input-reference image-token cost on edits (multi-view = more refs).
// Mirror of image-provider.ts (authoritative). ≈3k tok/ref × $8/M.
export const IMAGE_INPUT_REF_COST_USD = 0.024;

// AUTHORITATIVE image cost for the ledger is the edge `openaiImageUnitCost()` in
// supabase/functions/_shared/image-provider.ts — keep this client mirror in sync.
export function imageUnitCostUsd(provider: string, quality: ImageQuality, model?: string): number | null {
  if (provider === 'openai') {
    const table = model?.startsWith('gpt-image-2') ? OPENAI_IMAGE_2_COST_USD
      : model?.startsWith('gpt-image-1.5') ? OPENAI_IMAGE_15_COST_USD
      : OPENAI_IMAGE_COST_USD;
    return table[quality] ?? null;
  }
  if (provider === 'gemini') return GEMINI_IMAGE_COST_USD;
  console.warn(`[pricing] unknown image provider "${provider}" — cost logged as NULL`);
  return null;
}

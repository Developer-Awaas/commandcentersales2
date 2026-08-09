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

// RB-P6 — gpt-image-1.5 per-image rates. ⚠️ PLACEHOLDER / UNVERIFIED (= gpt-image-1
// until confirmed against OpenAI's published gpt-image-1.5 pricing in the migration
// spike; flag any mismatch). The AUTHORITATIVE image cost for the ledger is the edge
// `openaiImageUnitCost()` in supabase/functions/_shared/image-provider.ts — keep this
// mirror in sync. input_fidelity:'high' on /images/edits adds input-image tokens
// (~+$0.01/edit estimate); the ledger's unit_cost_usd already carries a re-verify caveat.
export const OPENAI_IMAGE_15_COST_USD: Record<ImageQuality, number> = { low: 0.011, medium: 0.042, high: 0.167 };
export const INPUT_FIDELITY_HIGH_SURCHARGE_USD = 0.01;

export function imageUnitCostUsd(provider: string, quality: ImageQuality, model?: string): number | null {
  if (provider === 'openai') {
    const table = model?.startsWith('gpt-image-1.5') ? OPENAI_IMAGE_15_COST_USD : OPENAI_IMAGE_COST_USD;
    return table[quality] ?? null;
  }
  if (provider === 'gemini') return GEMINI_IMAGE_COST_USD;
  console.warn(`[pricing] unknown image provider "${provider}" — cost logged as NULL`);
  return null;
}

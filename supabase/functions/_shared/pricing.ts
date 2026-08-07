/**
 * Per-model / per-image pricing map (edge side). Mirror of src/lib/pricing.ts
 * — the two can't share a file across the Vite/Deno module boundary, so KEEP
 * THE NUMBERS IN SYNC (pricing_test.ts / pricing.test.ts on each side assert
 * the same known values so drift trips CI).
 *
 * Approximate published rates for cost-tracking/attribution, NOT invoicing-grade.
 * Unknown model/provider -> null cost + console.warn (row still written).
 */

export interface ModelPrice {
  inPerM: number; // USD per 1M input tokens
  outPerM: number; // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5-20251001': { inPerM: 1, outPerM: 5 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
}

export function textCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = MODEL_PRICING[model]
  if (!p) {
    console.warn(`[pricing] unknown model "${model}" — cost logged as NULL`)
    return null
  }
  return (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000
}

export type ImageQuality = 'low' | 'medium' | 'high'

// Matches OPENAI_IMAGE_COST_USD in image-provider.ts (per-image, 1024²).
export const OPENAI_IMAGE_COST_USD: Record<ImageQuality, number> = {
  low: 0.011,
  medium: 0.042,
  high: 0.167,
}
export const GEMINI_IMAGE_COST_USD = 0.039

export function imageUnitCostUsd(provider: string, quality: ImageQuality): number | null {
  if (provider === 'openai') return OPENAI_IMAGE_COST_USD[quality] ?? null
  if (provider === 'gemini') return GEMINI_IMAGE_COST_USD
  console.warn(`[pricing] unknown image provider "${provider}" — cost logged as NULL`)
  return null
}

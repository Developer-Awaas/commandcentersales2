/**
 * Per-account-tier server-side configuration.
 *
 * The ceilings here are per-INTERACTION limits (not monthly/periodic volume).
 * They cap the total USD Aanya may spend in a single runAanya call across
 * ideation + critique loops + image generation.
 *
 * Separate per-period (monthly) volume quotas are not yet implemented.
 * That decision is deferred — this per-interaction cap handles the
 * anti-runaway protection described in spec §5.11 without needing a
 * rolling counter table.
 *
 * Cost reference (OpenAI GPT-Image-1, high quality at 1024×1024 ≈ $0.167):
 *   profile_1: $0.85 → ~5 image gens (3 angles × 1 iter + 2 budget headroom)
 *   profile_2: $3.00 → ~18 image gens (3 angles × 3 iters × 2 providers,
 *                         with critique token cost negligible at <$0.05 total)
 *   profile_3: $10.00 → enterprise; generous headroom for large batches
 */

export type ProfileTier = 'profile_1' | 'profile_2' | 'profile_3'

export interface TierConfig {
  // Maximum USD Aanya may spend per runAanya invocation (image gen + critiques).
  aanyaCostCeilingUsd: number
}

export const TIER_CONFIG: Record<ProfileTier, TierConfig> = {
  profile_1: { aanyaCostCeilingUsd: 0.85  },
  profile_2: { aanyaCostCeilingUsd: 3.00  },
  profile_3: { aanyaCostCeilingUsd: 10.00 },
}

export function getTierConfig(tier: string): TierConfig {
  const key = tier as ProfileTier
  return TIER_CONFIG[key] ?? TIER_CONFIG['profile_2']
}

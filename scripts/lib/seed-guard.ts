/**
 * Hard allowlist for seeding SYNTHETIC METRICS.
 *
 * Why this exists: the review org (Demo Builder Pvt Ltd on CC-TEST) was seeded
 * with 90 fake campaign_metrics rows and 4 fake smm_metrics rows. Once a real
 * Meta account is connected there, those rows are indistinguishable from live
 * data in every UI that reads the table — and the org is what a Meta app
 * reviewer logs into. Fabricated ad metrics presented to a reviewer as live
 * performance is the kind of thing that fails a submission outright, and
 * "SMM Monitor showed 1050 avg reach from an account that was never connected"
 * was exactly that, already on screen.
 *
 * So metric seeding is opt-in per run and refuses by default.
 *
 * ALLOWED WITHOUT CEREMONY:
 *   ZZ-INTERNAL-TEST (PROD) — an org that exists only for demos and has no
 *   reviewer and no real integration.
 *
 * ANYTHING ELSE requires SEED_ALLOW_ORG to name that exact org id. Deliberately
 * an exact-match env var rather than a --force flag: a flag gets pasted from
 * scrollback and re-run against the wrong project, whereas the id has to be
 * typed for the org you actually mean.
 *
 * This guards METRIC tables specifically (campaign_metrics, smm_metrics,
 * daily_metrics). Seeding projects, brand kits or creatives is harmless — those
 * are obviously demo content and nothing presents them as measured facts.
 */

/** ZZ-INTERNAL-TEST on PROD — the one org synthetic metrics may target freely. */
export const ZZ_INTERNAL_TEST_ORG_ID = '983c7c08-ffaf-402b-981a-a9cd22615cae'

export class SeedTargetRefused extends Error {
  constructor(orgId: string) {
    super(
      `Refusing to seed synthetic METRICS into org ${orgId}.\n` +
      `Only ZZ-INTERNAL-TEST (${ZZ_INTERNAL_TEST_ORG_ID}) is allowed by default.\n` +
      `\n` +
      `If you genuinely mean this org, re-run with:\n` +
      `  SEED_ALLOW_ORG=${orgId}\n` +
      `\n` +
      `Before you do: is this the org a Meta reviewer logs into? Fake ad metrics\n` +
      `sitting next to real synced ones cannot be told apart in the UI.`,
    )
    this.name = 'SeedTargetRefused'
  }
}

/**
 * Throws unless `orgId` may receive synthetic metrics.
 * Pure and side-effect free apart from reading the env var, so it is testable.
 */
export function assertMetricSeedAllowed(
  orgId: string,
  env: { SEED_ALLOW_ORG?: string } = readEnv(),
): void {
  if (orgId === ZZ_INTERNAL_TEST_ORG_ID) return
  if (env.SEED_ALLOW_ORG && env.SEED_ALLOW_ORG.trim() === orgId) return
  throw new SeedTargetRefused(orgId)
}

function readEnv(): { SEED_ALLOW_ORG?: string } {
  // Works under Deno and Node without importing either's types.
  const g = globalThis as { Deno?: { env: { get(k: string): string | undefined } }; process?: { env: Record<string, string | undefined> } }
  if (g.Deno?.env) return { SEED_ALLOW_ORG: g.Deno.env.get('SEED_ALLOW_ORG') }
  return { SEED_ALLOW_ORG: g.process?.env?.SEED_ALLOW_ORG }
}

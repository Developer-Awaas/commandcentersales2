/**
 * ================================================================
 * review-build ONLY — DO NOT MERGE TO MAIN.
 * ================================================================
 *
 * Fail-closed hard guard: this branch's Edge Functions are physically
 * incapable of running against any Supabase project except CC-TEST.
 *
 * Deliberately hardcoded, not env-var-gated. An "IS_REVIEW_BUILD=true"
 * flag that must be SET to activate the guard fails OPEN — deploy this
 * branch anywhere with that var missing (the most likely misconfiguration,
 * not the least likely) and the guard is silently inert, which is exactly
 * the one mistake it exists to catch. Hardcoding the allowlisted ref means
 * there is no configuration to omit: every entry point that imports this
 * module (side-effect import, no call needed) throws at MODULE LOAD time
 * — before Deno.serve ever registers a handler — if SUPABASE_URL isn't
 * the CC-TEST project. The function fails to boot at all, not just to
 * write.
 *
 * This file, and the one-line side-effect import added to every Edge
 * Function entry point to wire it in, must stay in its own commit,
 * separable from the budget-cap / Canva-versioning work on this branch —
 * those are designed to back-port to main; this guard must never go
 * with them.
 */

const CC_TEST_PROJECT_REF = 'yelmuykbqdyeikgbmkoq'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
if (!supabaseUrl.includes(CC_TEST_PROJECT_REF)) {
  throw new Error(
    `review-build refuses to start — SUPABASE_URL ("${supabaseUrl || '(unset)'}") is not the CC-TEST project ` +
    `(${CC_TEST_PROJECT_REF}). This branch is hardcoded to run against CC-TEST only and must never be deployed ` +
    `against any other Supabase project, including production.`
  )
}

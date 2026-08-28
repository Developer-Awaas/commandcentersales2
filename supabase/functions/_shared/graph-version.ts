/**
 * THE Graph API version. One constant, every call site.
 *
 * Before this file the version was a string literal in five places
 * (`meta-oauth.ts` twice — the API host and the login dialog host, which are
 * different domains carrying the same version — `meta-publish.ts`,
 * `meta-sync-core.ts`, and a dead client-side copy in `src/lib/meta-api.ts`
 * that nothing imported). Five literals means a version bump silently becomes
 * a partial version bump, and the half that stayed behind is the half that
 * breaks first, on whichever endpoint deprecates soonest.
 *
 * v26.0 was VERIFIED LIVE, not assumed (2026-08-28). Probing
 * `/{version}/oauth/access_token` with no credentials distinguishes a routed
 * version from an unrouted one: v21–v26 answer `code 101 "Missing client_id
 * parameter"` (the request reached the endpoint), while v27.0 and beyond
 * answer HTTP 500 `code 1 "An unknown error has occurred"` (no such version).
 * A token-bearing probe cannot tell you this — an invalid-token error (code
 * 190) short-circuits before version routing, so v99.0 looks exactly as
 * healthy as v21.0. That false signal is why this was checked twice.
 *
 * NOTE for whoever bumps this next: the sync path (`meta-sync-core.ts`,
 * insights + ad-level) rides this constant too, so a bump moves campaign
 * reporting to the new version at the same time as publishing. Re-verify a
 * real sync after changing it — field deprecations are the usual casualty,
 * and they surface as NULL columns rather than as errors.
 */
export const GRAPH_API_VERSION = 'v26.0'

/** Graph API host + version. */
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

/** Login dialog host + version — a DIFFERENT domain, same version. */
export const FB_DIALOG_BASE = `https://www.facebook.com/${GRAPH_API_VERSION}`

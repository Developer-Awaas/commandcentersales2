/**
 * The gate for cron-only functions.
 *
 * FOUR functions are deployed `--no-verify-jwt` because pg_cron is their
 * caller: meta-insights-sync, dhruv-anomaly-check, dhruv-weekly-report,
 * history-retention-sweep. Every one of them took `_req` and ignored it —
 * no method check, no auth check — so any unauthenticated request to the
 * public function URL ran the whole job:
 *
 *   meta-insights-sync       a full all-org Meta sweep, burning Graph quota
 *                            against every org's rate limit, and returning a
 *                            list of org UUIDs to whoever asked
 *   dhruv-weekly-report      a Sonnet 4096-token call PER ORG. Real money.
 *   history-retention-sweep  DELETES tool_outputs rows and storage objects
 *
 * `meta-sync-now`'s docstring describes the OPTIONS half of this ("an OPTIONS
 * request ran a FULL ALL-ORG SWEEP") and fixed it by splitting the browser
 * path onto its own CORS-bearing function. That fixed the browser's route in;
 * it did not close the endpoint, because absent CORS stops a browser READING
 * a response, never a plain POST from anywhere else.
 *
 * NO NEW SECRET IS NEEDED. pg_cron already sends the service-role key —
 * verified live in cron.job.command:
 *
 *   headers := jsonb_build_object(
 *     'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'))
 *
 * so the fix is only to CHECK the header these functions are already handed.
 *
 * Deliberately returns no CORS headers, on any path. These functions are not
 * for browsers, and adding CORS is the exact mistake meta-sync-now exists to
 * avoid.
 */

/** Length-independent compare, so a wrong key cannot be narrowed by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Returns a Response to send back, or null when the caller may proceed.
 *
 * Usage, as the first line of the handler:
 *   const denied = denyUnlessCron(req); if (denied) return denied
 */
export function denyUnlessCron(req: Request): Response | null {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!expected) {
    // Refuse rather than fall open. A missing service-role key in a function
    // that runs on the service-role client is a broken deployment, and the
    // job would fail a line later anyway — failing here says why.
    return new Response(JSON.stringify({ error: 'Function is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const presented = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!presented || !timingSafeEqual(presented, expected)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return null
}

/**
 * "Is this caller an admin of their org?"
 *
 * WHY THIS IS NOT RLS. Bug #42 admin-gated `org_integrations` so that only an
 * admin could read or overwrite the org's Meta token. Those policies are real
 * and they work — for the client. Every function that touches that table does
 * so with the SERVICE-ROLE key, which bypasses RLS entirely, so an RLS policy
 * is not a check these functions ever meet. The gate has to be written out.
 *
 * `meta-publish-targets` did write it out. Two other entry points that can
 * overwrite the same org connection did not:
 *
 *   meta-token-connect   paste-a-token path — any org member could replace the
 *                        org's Meta access token
 *   meta-oauth-start     OAuth path — any org member could start a flow whose
 *                        callback overwrites the same row
 *
 * Returns a boolean rather than a Response on purpose: each function builds
 * its own CORS headers, and a helper that returned a Response would either
 * have to know about those or quietly drop them.
 */
// deno-lint-ignore no-explicit-any
type AnyClient = { from: (t: string) => any }

export async function isOrgAdmin(supabase: AnyClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle()
  return (data as { role?: string } | null)?.role === 'admin'
}

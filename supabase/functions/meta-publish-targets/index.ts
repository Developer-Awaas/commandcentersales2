/**
 * meta-publish-targets — choosing WHERE this org publishes.
 *
 * Split from meta-publish deliberately. That function's whole value is being
 * narrow: it takes a caption and an image and it can only post to one
 * pre-approved place. Folding "and also reconfigure where that place is" into
 * the same endpoint would put the gate and the thing that moves the gate
 * behind one permission check.
 *
 * Three actions:
 *   list      — the Pages this org's token can actually reach (/me/accounts),
 *               annotated with whether each is on the deployment allowlist.
 *   set       — write publish_page_id / publish_ig_user_id (+ display names).
 *   page_info — READ-ONLY. Name, follower count and linked IG handle for one
 *               allowlisted Page, for the Page Info card in Settings.
 *
 * page_info lives here rather than in its own function because everything it
 * needs is already established above the action dispatch: the admin check, the
 * connection lookup, the verified-token gate, and the reachable+allowlisted
 * Page set. A sibling function would re-implement all four to serve one GET,
 * and would give the client a second endpoint to know about for a section that
 * already talks only to this one. It writes nothing.
 *
 * NO FREE-TEXT IDS. `set` accepts only a page_id that appeared in this same
 * token's /me/accounts AND is on the allowlist — both re-checked server-side,
 * because a picker is a convenience, not a control. Typing an arbitrary id
 * into the request body gets you nothing.
 *
 * ADMIN ONLY. org_integrations is admin-gated at the RLS layer (bug #42), but
 * this function holds the service-role key and bypasses RLS entirely, so the
 * role check has to be made here explicitly — a service-role function that
 * "inherits" an RLS guarantee inherits nothing.
 */
import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { resolveCallerIdentity } from '../_shared/canva-oauth.ts'
import { isOrgAdmin } from '../_shared/require-admin.ts'
import { graphErrorMessage, graphGet, parseAllowlist } from '../_shared/meta-publish.ts'

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() })
}

interface PageOption {
  page_id: string
  page_name: string
  ig_user_id: string | null
  ig_username: string | null
  allowed: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)

  const identity = await resolveCallerIdentity(req)
  if (!identity.ok) return json({ error: identity.error }, identity.status)
  const { orgId, userId } = identity.identity

  let body: { action?: string; page_id?: string; ig_user_id?: string | null }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Explicit admin check — see the header. This client bypasses RLS, so
  // org_integrations' admin-only policies do not apply to it.
  if (!(await isOrgAdmin(supabase, userId))) {
    return json({ error: 'Only an organisation admin can change publishing targets.' }, 403)
  }

  const { data: integration } = await supabase
    .from('org_integrations')
    .select('id, meta_access_token, meta_verified_at, status, publish_page_id')
    .eq('org_id', orgId)
    .eq('provider', 'meta')
    .maybeSingle()

  const conn = integration as { id: string; meta_access_token: string | null; meta_verified_at: string | null; status: string; publish_page_id: string | null } | null
  if (!conn?.meta_access_token) {
    return json({ error: 'No Meta connection for this organisation. Connect one first.' }, 404)
  }
  if (!conn.meta_verified_at) {
    return json({ error: 'This Meta token has never been verified. Reconnect in Settings before choosing publish targets.' }, 409)
  }

  const allowlist = parseAllowlist(Deno.env.get('PUBLISH_ALLOWED_PAGE_IDS'))

  // The token's ACTUAL reachable assets. Not a stored list, not free text —
  // whatever Meta says this token can see, right now.
  // `access_token` rides this existing round trip rather than costing
  // page_info a second one. It is collected into a Map that never leaves this
  // function — deliberately NOT a PageOption field, so the compiler's
  // excess-property check on the literal below makes leaking it into a
  // response a build error rather than a code-review question.
  const res = await graphGet('/me/accounts', {
    access_token: conn.meta_access_token,
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    limit: '50',
  })
  if (res.status !== 200 || !res.body.data) {
    return json({ error: `Could not list Pages: ${graphErrorMessage(res.body)}` }, 502)
  }

  const pageTokens = new Map<string, string>()
  const options: PageOption[] = (res.body.data as Record<string, unknown>[]).map((p) => {
    const ig = p.instagram_business_account as { id?: string; username?: string } | undefined
    const pageId = String(p.id ?? '')
    if (p.access_token) pageTokens.set(pageId, String(p.access_token))
    return {
      page_id: pageId,
      page_name: String(p.name ?? pageId),
      ig_user_id: ig?.id ? String(ig.id) : null,
      ig_username: ig?.username ? String(ig.username) : null,
      allowed: allowlist.includes(pageId),
    }
  })

  if (body.action === 'list') {
    // Only allowlisted Pages are OFFERED. The others exist on this token —
    // including real customer Pages — and showing them as greyed-out choices
    // would be an invitation to ask why. They are counted, not named.
    const selectable = options.filter((o) => o.allowed)
    return json({
      ok: true,
      pages: selectable,
      hidden_count: options.length - selectable.length,
      allowlist_configured: allowlist.length > 0,
      note: allowlist.length === 0
        ? 'PUBLISH_ALLOWED_PAGE_IDS is not set on this deployment, so no Page can be selected or published to.'
        : null,
    })
  }

  // READ-ONLY. Describes the Page the org has chosen (or an explicitly named
  // one, so the card can render immediately after a select without waiting for
  // the org row to round-trip). Same reachability + allowlist rules as `set`:
  // this must not become a way to read arbitrary Pages a token happens to see.
  if (body.action === 'page_info') {
    const pageId = body.page_id ?? conn.publish_page_id ?? null
    if (!pageId) return json({ error: 'No publishing target is set for this organisation.' }, 404)

    const chosen = options.find((o) => o.page_id === pageId)
    if (!chosen) return json({ error: 'That Page is not reachable with this organisation\'s Meta token.' }, 400)
    if (!chosen.allowed) {
      return json({ error: `Page ${pageId} is not on this deployment's publish allowlist.` }, 403)
    }

    const pageToken = pageTokens.get(pageId)
    if (!pageToken) {
      return json({ error: 'Meta returned no Page access token for that Page, so its details cannot be read.' }, 502)
    }

    const info = await graphGet(`/${pageId}`, {
      access_token: pageToken,
      fields: 'name,fan_count,followers_count,instagram_business_account{username}',
    })
    if (info.status !== 200 || info.body.error) {
      return json({ error: `Could not read Page details: ${graphErrorMessage(info.body)}` }, 502)
    }

    const b = info.body as Record<string, unknown>
    const ig = b.instagram_business_account as { username?: string } | undefined
    // Counts are nullable on purpose. Not every Page exposes followers_count,
    // and a Page with no followers genuinely returns 0 — rendering either as a
    // dash beats inventing a number, and `?? null` keeps 0 distinguishable
    // from absent (0 || null would collapse them).
    const num = (v: unknown) => (typeof v === 'number' ? v : null)
    return json({
      ok: true,
      page_id: pageId,
      name: String(b.name ?? chosen.page_name),
      fan_count: num(b.fan_count),
      followers_count: num(b.followers_count),
      // Prefer the freshly-read handle; fall back to the one /me/accounts gave.
      ig_username: ig?.username ? String(ig.username) : chosen.ig_username,
    })
  }

  if (body.action === 'set') {
    const chosen = options.find((o) => o.page_id === body.page_id)
    if (!chosen) {
      return json({ error: 'That Page is not reachable with this organisation\'s Meta token.' }, 400)
    }
    if (!chosen.allowed) {
      return json({
        error: `Page ${chosen.page_id} is not on this deployment's publish allowlist and cannot be selected.`,
      }, 403)
    }
    // IG is optional, but if one is named it must be the one LINKED to the
    // chosen Page — an IG account from a different Page would publish through
    // a token that has no rights over it, and fail confusingly at post time.
    const wantsIg = body.ig_user_id ?? null
    if (wantsIg && wantsIg !== chosen.ig_user_id) {
      return json({ error: 'That Instagram account is not linked to the selected Page.' }, 400)
    }

    const { error } = await supabase
      .from('org_integrations')
      .update({
        publish_page_id: chosen.page_id,
        publish_page_name: chosen.page_name,
        publish_ig_user_id: wantsIg,
        publish_ig_username: wantsIg ? chosen.ig_username : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conn.id)

    // Bug #47 again: a wrong column name comes back in `error`, never as a throw.
    if (error) return json({ error: `Could not save the publish target: ${error.message}` }, 500)

    return json({
      ok: true,
      publish_page_id: chosen.page_id,
      publish_page_name: chosen.page_name,
      publish_ig_user_id: wantsIg,
      publish_ig_username: wantsIg ? chosen.ig_username : null,
    })
  }

  return json({ error: "action must be 'list', 'set' or 'page_info'" }, 400)
})

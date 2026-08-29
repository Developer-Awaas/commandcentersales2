/**
 * meta-publish-targets — choosing WHERE this org publishes.
 *
 * Split from meta-publish deliberately. That function's whole value is being
 * narrow: it takes a caption and an image and it can only post to one
 * pre-approved place. Folding "and also reconfigure where that place is" into
 * the same endpoint would put the gate and the thing that moves the gate
 * behind one permission check.
 *
 * Two actions:
 *   list — the Pages this org's token can actually reach (/me/accounts),
 *          annotated with whether each is on the deployment allowlist.
 *   set  — write publish_page_id / publish_ig_user_id (+ display names).
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
    .select('id, meta_access_token, meta_verified_at, status')
    .eq('org_id', orgId)
    .eq('provider', 'meta')
    .maybeSingle()

  const conn = integration as { id: string; meta_access_token: string | null; meta_verified_at: string | null; status: string } | null
  if (!conn?.meta_access_token) {
    return json({ error: 'No Meta connection for this organisation. Connect one first.' }, 404)
  }
  if (!conn.meta_verified_at) {
    return json({ error: 'This Meta token has never been verified. Reconnect in Settings before choosing publish targets.' }, 409)
  }

  const allowlist = parseAllowlist(Deno.env.get('PUBLISH_ALLOWED_PAGE_IDS'))

  // The token's ACTUAL reachable assets. Not a stored list, not free text —
  // whatever Meta says this token can see, right now.
  const res = await graphGet('/me/accounts', {
    access_token: conn.meta_access_token,
    fields: 'id,name,instagram_business_account{id,username}',
    limit: '50',
  })
  if (res.status !== 200 || !res.body.data) {
    return json({ error: `Could not list Pages: ${graphErrorMessage(res.body)}` }, 502)
  }

  const options: PageOption[] = (res.body.data as Record<string, unknown>[]).map((p) => {
    const ig = p.instagram_business_account as { id?: string; username?: string } | undefined
    const pageId = String(p.id ?? '')
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

  return json({ error: "action must be 'list' or 'set'" }, 400)
})

/**
 * meta-publish — the first code in this product that writes to somebody else's
 * property. Everything before it read from Meta; this one posts.
 *
 * THE ORDER OF THE GATES IS THE DESIGN. Nothing reaches Graph until it has
 * passed, in this sequence:
 *
 *   1. A valid Supabase JWT.                     org comes from the JWT, never the body
 *   2. An org_integrations row that is active.   a disabled connection cannot post
 *   3. A token with meta_verified_at set.        unverified provenance = no publish
 *   4. A target the ORG chose (publish_page_id). never the discovered meta_page_id
 *   5. A target on the deployment ALLOWLIST.     env secret, not a table row
 *   6. Content that validates.                   before a token is even fetched
 *   7. CREATE_CONTENT on that Page.              capability, not just a token
 *   8. A mode.                                   dry_run -> draft -> live
 *
 * Gate 4 is worth spelling out. org_integrations.meta_page_id holds whatever
 * /me/accounts happened to list first when the account was connected — on this
 * deployment's token, that is a real customer's Page. Publishing to a
 * discovered value would mean the target of a post is a side effect of an
 * unrelated sync. publish_page_id is set by a human, in Settings, on purpose,
 * and it is the only Page id this function will read.
 *
 * Gate 5 then assumes gate 4 may be wrong anyway — a bad row, a bad migration,
 * a bad admin click — and re-checks it against PUBLISH_ALLOWED_PAGE_IDS, which
 * lives outside the database entirely. Unset means refuse everything.
 *
 * THREE MODES, not two (RB-PUB STEP 2):
 *
 *   dry_run  assembles and validates the exact payload, writes a
 *            published_assets row with meta_post_id NULL, sends NOTHING.
 *   draft    a REAL Graph object nobody can see: an unpublished Facebook post,
 *            or an Instagram container that is deliberately never published.
 *            Real ids, real Meta acceptance, no public artefact.
 *   live     public. Needs META_PUBLISH_MODE=live on the deployment AND
 *            confirm_live on the call — two gates, two different owners.
 *
 * A live request that fails either gate DOWNGRADES to draft with a warning
 * rather than erroring. Erroring would train people to retry until something
 * works, which is the opposite of what a confirmation gate is for.
 */
import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { resolveCallerIdentity } from '../_shared/canva-oauth.ts'
import { recordApiCost } from '../_shared/api-cost.ts'
import { GRAPH_API_VERSION } from '../_shared/graph-version.ts'
import { langfuseSpan, langfuseTrace } from '../_shared/langfuse.ts'
import {
  type PageAccount,
  type PublishMode,
  type PublishTarget,
  buildFacebookPayload,
  buildInstagramContainerPayload,
  buildPublishedAssetRow,
  checkPublishTarget,
  facebookPermalink,
  graphErrorMessage,
  graphGet,
  graphPost,
  resolveDeploymentMode,
  resolvePageToken,
  resolvePublishMode,
  validatePublishInput,
  withDraftFlag,
} from '../_shared/meta-publish.ts'

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

interface PublishRequest {
  target?: string
  message?: string
  image_url?: string | null
  creative_asset_id?: string | null
  tool_output_id?: string | null
  project_id?: string | null
  dry_run?: boolean
  confirm_live?: boolean
}

/**
 * Instagram's container is asynchronous — the image is fetched by Meta, not by
 * us, so publishing immediately fails with a container-not-ready error.
 *
 * Capped at 10 polls / ~20s for the reason bug #2 records: a 30s poll loop in
 * canva-sync-design exceeded the Edge Function wall clock and the whole call
 * died with nothing written. A container that is still not FINISHED after 20s
 * is reported as such and left alone — it is not lost, it simply is not ours
 * to wait on inside a request.
 */
async function waitForContainer(containerId: string, pageToken: string): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let i = 0; i < 10; i++) {
    const { body } = await graphGet(`/${containerId}`, { fields: 'status_code,status', access_token: pageToken })
    const code = String(body.status_code ?? '')
    if (code === 'FINISHED') return { ok: true }
    if (code === 'ERROR' || code === 'EXPIRED') {
      return { ok: false, error: `Instagram could not process the image (${code}): ${String(body.status ?? 'no detail')}` }
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return {
    ok: false,
    error: 'Instagram is still processing the image after 20 seconds. Nothing was published — try again in a moment.',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)

  const startedAt = Date.now()
  const traceId = crypto.randomUUID()

  // GATE 1 — identity. org_id is derived from the caller's JWT via profiles;
  // a body-supplied org would make this "post to any org you can name".
  const identity = await resolveCallerIdentity(req)
  if (!identity.ok) return json({ error: identity.error }, identity.status)
  const { orgId, userId } = identity.identity

  let body: PublishRequest
  try { body = (await req.json()) as PublishRequest } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const target = body.target as PublishTarget
  if (target !== 'facebook' && target !== 'instagram') {
    return json({ error: "target must be 'facebook' or 'instagram'" }, 400)
  }
  // The default is NOT to post. An omitted or malformed dry_run is treated as
  // a dry run, and confirm_live must be exactly true — so the only way to
  // reach the public is to say so twice, explicitly.
  const dryRun = body.dry_run !== false
  const confirmLive = body.confirm_live === true
  const deployment = resolveDeploymentMode(Deno.env.get('META_PUBLISH_MODE'))
  const decision = resolvePublishMode({ deployment, dryRun, confirmLive })
  const mode: PublishMode = decision.mode

  const message = String(body.message ?? '')
  const imageUrl = body.image_url ?? null

  // One trace per publish attempt. Metadata only — no token, no caption body,
  // no image bytes. What is worth answering later is "what did this app post,
  // where, in which mode, and how long did Meta take", and none of that needs
  // the content.
  await langfuseTrace(traceId, {
    name: 'meta-publish',
    userId,
    tags: ['meta', 'publish', target, mode],
    metadata: { channel: target, mode, deployment_mode: deployment, org_id: orgId, graph_version: GRAPH_API_VERSION },
  })

  /** Terminal log for this attempt. `status` is the outcome, never the payload. */
  async function endSpan(status: string, level: 'DEFAULT' | 'WARNING' | 'ERROR' = 'DEFAULT', detail?: string) {
    await langfuseSpan(traceId, {
      name: `publish:${target}:${mode}`,
      level,
      statusMessage: detail,
      output: { status, latency_ms: Date.now() - startedAt },
    })
  }

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // GATE 2/3 — the connection itself.
  const { data: integration, error: intErr } = await supabase
    .from('org_integrations')
    .select('meta_access_token, meta_verified_at, meta_token_type, token_expires_at, status, publish_page_id, publish_ig_user_id, publish_page_name, publish_ig_username')
    .eq('org_id', orgId)
    .eq('provider', 'meta')
    .maybeSingle()

  if (intErr) { await endSpan('integration_read_failed', 'ERROR', intErr.message); return json({ error: intErr.message }, 500) }
  if (!integration) {
    await endSpan('no_connection', 'WARNING')
    return json({ error: 'No Meta connection for this organisation. Connect one in Settings first.' }, 404)
  }

  const row = integration as {
    meta_access_token: string | null
    meta_verified_at: string | null
    meta_token_type: string | null
    token_expires_at: string | null
    status: string
    publish_page_id: string | null
    publish_ig_user_id: string | null
    publish_page_name: string | null
    publish_ig_username: string | null
  }

  if (row.status === 'disabled') {
    await endSpan('connection_disabled', 'WARNING')
    return json({ error: 'This Meta connection is disabled. Re-enable it in Settings before publishing.' }, 409)
  }
  if (!row.meta_access_token) {
    await endSpan('no_token', 'WARNING')
    return json({ error: 'This organisation has no stored Meta token. Reconnect in Settings.' }, 409)
  }
  // Verified provenance is REQUIRED to publish, not merely preferred. An
  // unverified token is one we cannot attribute to our own app — the exact
  // condition that let a dead-app token sit in this table for a month looking
  // healthy (see 20260818120000). Reading is a cheap thing to get wrong;
  // posting is not.
  if (!row.meta_verified_at) {
    await endSpan('token_unverified', 'WARNING')
    return json({
      error:
        'This Meta token has never been verified against Meta, so publishing is refused. ' +
        'Reconnect in Settings — the connect path verifies the token before storing it.',
    }, 409)
  }

  // SYSTEM_USER preferred, USER accepted-with-a-warning that names the DATE.
  // "This token expires" is a shrug; "this stops working on 19 October" is
  // something a person can act on.
  const tokenWarning = row.meta_token_type === 'SYSTEM_USER'
    ? null
    : `Publishing with a ${row.meta_token_type ?? 'non-System-User'} token` +
      (row.token_expires_at
        ? `, which expires on ${new Date(row.token_expires_at).toDateString()} — publishing (and sync) will stop that day unless it is replaced.`
        : ', which is not a permanent System User token.') +
      ' A System User token is the durable choice for anything unattended.'

  // GATE 4 + 5 — the target the org chose, re-checked against the deployment
  // allowlist that no database row can influence.
  const gate = checkPublishTarget(row.publish_page_id, Deno.env.get('PUBLISH_ALLOWED_PAGE_IDS'))
  if (!gate.ok) {
    // Deliberately NO published_assets row here: nothing was assembled, no
    // Graph call was made, and a row would imply an attempt reached Meta.
    console.warn(`[meta-publish] refused org=${orgId} reason=${gate.reason} page=${row.publish_page_id ?? '(none)'}`)
    await endSpan(`refused:${gate.reason}`, 'WARNING')
    return json({ error: gate.error, reason: gate.reason, refused: true }, 403)
  }
  const pageId = gate.pageId

  const igUserId = row.publish_ig_user_id
  if (target === 'instagram' && !igUserId) {
    await endSpan('no_ig_target', 'WARNING')
    return json({
      error: 'No Instagram account is configured for publishing. Pick one in Settings → Publishing, or post to Facebook instead.',
    }, 409)
  }

  // GATE 6 — content. Before any token is fetched: an invalid caption should
  // never cost a Graph round trip, and an unfetchable image URL is a clearer
  // error from here than from Meta.
  const valid = validatePublishInput({ target, message, imageUrl })
  if (!valid.ok) { await endSpan('invalid_input', 'WARNING', valid.error); return json({ error: valid.error }, 400) }

  const basePayload = target === 'facebook'
    ? buildFacebookPayload(pageId, message, imageUrl)
    : buildInstagramContainerPayload(igUserId!, message, imageUrl!)
  const payload = withDraftFlag(basePayload, mode)

  const targetName = target === 'facebook'
    ? (row.publish_page_name ?? pageId)
    : (row.publish_ig_username ?? igUserId!)

  // GATE 8a — dry run. Everything above has run; nothing below does.
  if (mode === 'dry_run') {
    const dryRow = buildPublishedAssetRow({
      orgId, userId, target, pageId, igUserId,
      message, mode,
      projectId: body.project_id ?? null,
      creativeAssetId: body.creative_asset_id ?? null,
      toolOutputId: body.tool_output_id ?? null,
    })
    const { data: inserted, error: insErr } = await supabase
      .from('published_assets').insert(dryRow).select('id').single()
    // Bug #47: PostgREST returns a bad column in `error` rather than throwing.
    // A dry run whose only artefact failed to write is a failed dry run.
    if (insErr) {
      await endSpan('dry_run_record_failed', 'ERROR', insErr.message)
      return json({ error: `Dry run assembled but could not be recorded: ${insErr.message}` }, 500)
    }

    await endSpan('dry_run_ok')
    return json({
      ok: true,
      mode,
      dry_run: true,
      published: false,
      published_asset_id: (inserted as { id: string }).id,
      target,
      target_name: targetName,
      page_id: pageId,
      ig_user_id: igUserId ?? null,
      would_post: { endpoint: payload.endpoint, fields: payload.fields },
      token_warning: tokenWarning,
      note: 'Validated. Nothing was posted — no Graph write was made.',
    })
  }

  // ---- Graph from here (draft or live). ----
  try {
    // GATE 7 — capability, not just a token. /me/accounts returns the Page
    // token AND `tasks` in one response, so refusing a Page we can only
    // ANALYZE costs no extra round trip and happens before anything is sent.
    // The old `GET /{page}?fields=access_token` answered "is there a token"
    // and nothing else, which surfaced as a generic permissions failure from
    // the POST — at the exact moment the user had just confirmed a live post.
    const accounts = await graphGet('/me/accounts', {
      access_token: row.meta_access_token,
      fields: 'id,name,access_token,tasks',
      limit: '100',
    })
    if (accounts.status !== 200 || !accounts.body.data) {
      await endSpan('accounts_lookup_failed', 'ERROR')
      return json({ error: `Could not resolve Page permissions: ${graphErrorMessage(accounts.body)}` }, 502)
    }
    const tokenRes = resolvePageToken(accounts.body.data as PageAccount[], pageId)
    if (!tokenRes.ok) {
      await endSpan(`refused:${tokenRes.reason}`, 'WARNING')
      return json({ error: tokenRes.error, reason: tokenRes.reason, refused: true }, 403)
    }
    const pageToken = tokenRes.token

    let metaPostId: string
    let permalink: string | null = null

    if (target === 'facebook') {
      // Identical endpoint and fields for draft and live — the only difference
      // is `published=false`. A draft that took a different code path would
      // prove nothing about the live one.
      const res = await graphPost(payload.endpoint, { ...payload.fields, access_token: pageToken })
      if (res.status !== 200 || res.body.error) {
        await endSpan('fb_rejected', 'ERROR')
        return json({ error: `Facebook refused the post: ${graphErrorMessage(res.body)}` }, 502)
      }
      // /photos returns {id, post_id}; /feed returns {id}. post_id addresses
      // the Page post itself rather than the photo object. An unpublished
      // photo often has no post_id at all — the photo id is the real handle.
      const b = res.body as { id?: string; post_id?: string }
      metaPostId = String(b.post_id ?? b.id ?? '')
      // No permalink for a draft: there is nothing anyone could open.
      permalink = mode === 'live' && metaPostId ? facebookPermalink(metaPostId) : null
    } else {
      const container = await graphPost(payload.endpoint, { ...payload.fields, access_token: pageToken })
      if (container.status !== 200 || !container.body.id) {
        await endSpan('ig_container_rejected', 'ERROR')
        return json({ error: `Instagram rejected the media container: ${graphErrorMessage(container.body)}` }, 502)
      }
      const containerId = String(container.body.id)

      if (mode === 'draft') {
        // STOP. The container is a real Graph object Meta has accepted and
        // fetched the image for; publishing it is a SEPARATE second call, so
        // not making that call is not a workaround — it is just not finishing.
        // Nothing appears on the profile.
        metaPostId = containerId
      } else {
        const ready = await waitForContainer(containerId, pageToken)
        if (!ready.ok) { await endSpan('ig_container_not_ready', 'ERROR'); return json({ error: ready.error }, 502) }

        const publish = await graphPost(`/${igUserId}/media_publish`, { creation_id: containerId, access_token: pageToken })
        if (publish.status !== 200 || !publish.body.id) {
          await endSpan('ig_publish_rejected', 'ERROR')
          return json({ error: `Instagram refused to publish the container: ${graphErrorMessage(publish.body)}` }, 502)
        }
        metaPostId = String(publish.body.id)

        // IG hands back a real permalink — ask for it rather than constructing
        // one, since the media id is not the shortcode the URL uses.
        const meta = await graphGet(`/${metaPostId}`, { fields: 'permalink', access_token: pageToken })
        permalink = (meta.body as { permalink?: string }).permalink ?? null
      }
    }

    const liveRow = buildPublishedAssetRow({
      orgId, userId, target, pageId, igUserId,
      message, mode,
      projectId: body.project_id ?? null,
      creativeAssetId: body.creative_asset_id ?? null,
      toolOutputId: body.tool_output_id ?? null,
      metaPostId, permalink,
    })
    const { data: inserted, error: insErr } = await supabase
      .from('published_assets').insert(liveRow).select('id').single()
    // The object already exists on Meta at this point. A failed record is a
    // real problem — it means we cannot say what we created — but it is NOT a
    // reason to tell the user the post failed, because it did not.
    if (insErr) console.error('[meta-publish] Graph write succeeded but published_assets insert failed:', insErr.message)

    // Drafts are logged too: a draft is a real Graph call, and the ledger's
    // job is "what did this app do", not "what did this app pay for". Zero
    // model spend either way — a Graph publish costs nothing per call.
    await recordApiCost({
      orgId, userId,
      provider: 'meta',
      callType: 'publish',
      feature: mode === 'draft' ? 'meta-publish-draft' : 'meta-publish',
      model: `graph-${GRAPH_API_VERSION}`,
      costUsd: 0,
      projectId: body.project_id ?? null,
      traceId,
      client: supabase,
    })

    await endSpan(mode === 'live' ? 'live_ok' : 'draft_ok', decision.downgraded ? 'WARNING' : 'DEFAULT')
    return json({
      ok: true,
      mode,
      dry_run: false,
      published: mode === 'live',
      downgraded: decision.downgraded,
      mode_warning: decision.warning,
      published_asset_id: (inserted as { id: string } | null)?.id ?? null,
      recorded: !insErr,
      target,
      target_name: targetName,
      meta_post_id: metaPostId,
      permalink,
      token_warning: tokenWarning,
      note: mode === 'draft'
        ? 'Created on Meta as a DRAFT — a real object with a real id, not visible to the public.'
        : undefined,
    })
  } catch (err) {
    // ponytail: a Graph failure after the gates writes no published_assets row
    // — the error is returned to the caller and logged here. If "we tried and
    // Meta refused" ever needs to be queryable after the fact, that wants its
    // own status column, not a NULL meta_post_id (which already means dry run).
    const messageText = err instanceof Error ? err.message : String(err)
    console.error('[meta-publish] unexpected failure:', messageText)
    await endSpan('unexpected_failure', 'ERROR', messageText)
    return json({ error: `Publishing failed: ${messageText}` }, 502)
  }
})

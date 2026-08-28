/**
 * Shared publish helpers — the safety rails, kept pure so they can be tested
 * without a network, a database, or a token.
 *
 * THIS FILE IS THE FEATURE. Everything in meta-publish/index.ts is plumbing
 * around three decisions made here:
 *
 *   1. Is this Page one we are allowed to post to AT ALL?  (allowlist)
 *   2. Is the org's chosen target set, and does it survive (1)?
 *   3. What exactly would we send?                          (payload)
 *
 * The allowlist is deliberately an ENV secret and not a table. A database row
 * is reachable by anything holding the service-role key — including this very
 * function, and including a bug in it. The env var is not: no code path here
 * writes it, so the set of Pages this deployment can post to is fixed at
 * deploy time by a human with project access, and an org row naming some other
 * Page is simply refused. Two gates, two different owners.
 *
 * FAIL-CLOSED, stated plainly: an unset or empty PUBLISH_ALLOWED_PAGE_IDS
 * refuses EVERY publish. The opposite default — "no list configured, so allow
 * anything" — is the shape of every accidental-broadcast incident, and it
 * fails open at exactly the moment a misconfiguration makes it most dangerous.
 * The Meta app is currently in dev mode, which would also refuse most targets;
 * that is a second line of defence we do not get to rely on, because it
 * disappears the day the app is approved.
 */

import { GRAPH_BASE } from './graph-version.ts'

/** Re-exported for callers that already import from here. Single source: graph-version.ts. */
export const GRAPH = GRAPH_BASE

export type PublishTarget = 'facebook' | 'instagram'

/**
 * Splits the comma-separated env value. Tolerates whitespace and trailing
 * commas because a human types this into a secrets field, but does NOT
 * tolerate emptiness: [] is returned for unset/blank, and [] refuses all.
 */
export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

export type TargetCheck =
  | { ok: true; pageId: string }
  | { ok: false; error: string; reason: 'unconfigured' | 'no_target' | 'not_allowed' }

/**
 * The gate. `pageId` is the org's CHOSEN target (publish_page_id) — never a
 * discovered one, never anything from the request body.
 *
 * Order matters: the unconfigured case is reported before the not-allowed
 * case, because "this deployment has no allowlist" and "your Page is not on
 * it" need different people to fix them, and an error that conflates the two
 * sends the wrong one looking.
 */
export function checkPublishTarget(
  pageId: string | null | undefined,
  allowlistRaw: string | undefined | null,
): TargetCheck {
  const allowed = parseAllowlist(allowlistRaw)
  if (allowed.length === 0) {
    return {
      ok: false,
      reason: 'unconfigured',
      error:
        'Publishing is disabled on this deployment: the PUBLISH_ALLOWED_PAGE_IDS secret is not set. ' +
        'No publish target is accepted until a project admin sets it to the Page id(s) this environment may post to.',
    }
  }
  if (!pageId) {
    return {
      ok: false,
      reason: 'no_target',
      error: 'No publishing target is configured for this organisation. Choose a Page in Settings → Publishing first.',
    }
  }
  if (!allowed.includes(pageId)) {
    return {
      ok: false,
      reason: 'not_allowed',
      error:
        `Page ${pageId} is not on this deployment's publish allowlist, so no post was attempted. ` +
        'This is the guard that stops a test build posting to a customer Page.',
    }
  }
  return { ok: true, pageId }
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Content validation, separate from targeting so a bad caption never reaches
 * the allowlist check and a bad target never reaches Graph.
 *
 * Instagram REQUIRES an image — its container endpoint has no text-only mode.
 * Facebook does not, so a text-only Page post is legitimate there.
 */
export function validatePublishInput(input: {
  target: PublishTarget
  message: string
  imageUrl?: string | null
}): ValidationResult {
  const msg = (input.message ?? '').trim()
  if (!msg) return { ok: false, error: 'The caption is empty. Write something before posting.' }
  if (msg.length > 2200) {
    return { ok: false, error: `The caption is ${msg.length} characters; Facebook and Instagram cap captions at 2200.` }
  }
  if (input.target === 'instagram' && !input.imageUrl) {
    return { ok: false, error: 'Instagram cannot publish a text-only post — this creative has no persisted image URL.' }
  }
  if (input.imageUrl && !/^https:\/\//i.test(input.imageUrl)) {
    // Graph fetches the image itself, from the public internet. A blob:,
    // data:, or plain http: URL is not something Meta's servers can retrieve,
    // and the failure comes back as an opaque Graph code — say it here instead.
    return { ok: false, error: 'The image URL must be a public https:// URL that Meta can fetch.' }
  }
  return { ok: true }
}

export interface PublishPayload {
  /** Graph path the live call WOULD use — shown verbatim in the dry-run preview. */
  endpoint: string
  /** Body fields, minus the access token, which never appears anywhere it could be displayed or stored. */
  fields: Record<string, string>
}

/**
 * Facebook: a photo post when there is an image, a plain feed post when there
 * is not. Both take the PAGE token, not the user token — derived at call time.
 */
export function buildFacebookPayload(pageId: string, message: string, imageUrl?: string | null): PublishPayload {
  return imageUrl
    ? { endpoint: `/${pageId}/photos`, fields: { url: imageUrl, caption: message.trim() } }
    : { endpoint: `/${pageId}/feed`, fields: { message: message.trim() } }
}

/**
 * Instagram step 1 of 2 — the media container. Publishing it is a second call.
 *
 * `image_url` IS THE HANDOFF, and it is a hard dependency on the bucket being
 * public. Meta's servers fetch this URL themselves, unauthenticated, from the
 * open internet — we never upload bytes. `brand-assets` is a public Supabase
 * bucket (verified: `select public from storage.buckets` = true), which is the
 * only reason a `getPublicUrl()` link works here; the bucket's RLS policies are
 * `TO authenticated` and would block Meta entirely if the public flag were ever
 * turned off. If someone makes that bucket private, publishing breaks with an
 * opaque Graph media error and nothing in this file will explain why — hence
 * this note. Facebook's /photos `url` field has the same dependency.
 */
export function buildInstagramContainerPayload(igUserId: string, message: string, imageUrl: string): PublishPayload {
  return { endpoint: `/${igUserId}/media`, fields: { image_url: imageUrl, caption: message.trim() } }
}

/**
 * Best-effort permalink when Graph does not hand one back (the FB photo
 * endpoint returns ids, not a URL). www.facebook.com/{post_id} resolves for a
 * Page post; if that ever stops being true this is cosmetic — meta_post_id is
 * the durable identifier and is stored regardless.
 */
export function facebookPermalink(postId: string): string {
  return `https://www.facebook.com/${postId}`
}

/**
 * The row written for EVERY attempt, dry-run or live. Built here rather than
 * inline in the handler so its shape is asserted by a test that runs without
 * credentials — bug #47's lesson: a wrong column name on .insert() does not
 * throw, does not fail `deno check`, and silently writes nothing.
 */
export interface PublishedAssetRow {
  org_id: string
  project_id: string | null
  creative_asset_id: string | null
  tool_output_id: string | null
  page_id: string
  ig_user_id: string | null
  platform: PublishTarget
  meta_post_id: string | null
  permalink: string | null
  message: string
  dry_run: boolean
  /** Can anyone see it. false + dry_run false = DRAFT. See migration 20260828140000. */
  published: boolean
  posted_by: string | null
}

export function buildPublishedAssetRow(input: {
  orgId: string
  userId: string | null
  target: PublishTarget
  pageId: string
  igUserId?: string | null
  message: string
  mode: PublishMode
  projectId?: string | null
  creativeAssetId?: string | null
  toolOutputId?: string | null
  metaPostId?: string | null
  permalink?: string | null
}): PublishedAssetRow {
  return {
    org_id: input.orgId,
    project_id: input.projectId ?? null,
    creative_asset_id: input.creativeAssetId ?? null,
    tool_output_id: input.toolOutputId ?? null,
    page_id: input.pageId,
    ig_user_id: input.igUserId ?? null,
    platform: input.target,
    meta_post_id: input.metaPostId ?? null,
    permalink: input.permalink ?? null,
    message: input.message.trim(),
    // Derived from ONE input, so the pair can never disagree and trip the
    // schema CHECK that forbids dry_run + published together.
    dry_run: input.mode === 'dry_run',
    published: input.mode === 'live',
    posted_by: input.userId,
  }
}

// ---------------------------------------------------------------------------
// Graph IO. Not pure, so nothing above depends on it — but shared by both
// meta-publish and meta-publish-targets rather than copied into each, which is
// how the two would drift on timeouts and error shapes.
//
// EVERY call carries an AbortSignal timeout. A Graph call with no timeout is
// how bugs #35 and #41 both presented: the isolate hangs until the PLATFORM
// kills it, which surfaces as a resource error or as a request that never
// returns at all, never as "Meta was slow".
// ---------------------------------------------------------------------------

export interface GraphResponse {
  status: number
  body: Record<string, unknown>
}

/** Human-readable Graph error, without echoing the token that produced it. */
export function graphErrorMessage(body: Record<string, unknown>): string {
  const e = (body?.error ?? {}) as Record<string, unknown>
  const msg = String(e.message ?? 'Unknown Graph error')
  const code = e.code ? ` (code ${String(e.code)})` : ''
  const sub = e.error_user_msg ? ` — ${String(e.error_user_msg)}` : ''
  return msg + code + sub
}

export async function graphGet(path: string, params: Record<string, string>): Promise<GraphResponse> {
  const res = await fetch(`${GRAPH}${path}?${new URLSearchParams(params).toString()}`, {
    signal: AbortSignal.timeout(20_000),
  })
  let body: Record<string, unknown> = {}
  try { body = await res.json() } catch { /* non-JSON error page */ }
  return { status: res.status, body }
}

export async function graphPost(path: string, params: Record<string, string>): Promise<GraphResponse> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30_000),
  })
  let body: Record<string, unknown> = {}
  try { body = await res.json() } catch { /* non-JSON error page */ }
  return { status: res.status, body }
}

// ---------------------------------------------------------------------------
// PUBLISH MODE (RB-PUB STEP 2) — the draft tier.
// ---------------------------------------------------------------------------

/**
 * Three outcomes, in increasing order of consequence:
 *
 *   dry_run  nothing is sent to Graph at all
 *   draft    a REAL Graph object that nobody can see (unpublished FB post;
 *            IG container never published)
 *   live     a real Graph object the public can see
 *
 * Draft exists because dry_run and live were the only options, and the gap
 * between them is exactly where a demo lives: you cannot record a screencast
 * of a payload preview, and you should not have to post to a real Page to get
 * a real post id.
 */
export type PublishMode = 'dry_run' | 'draft' | 'live'

export type DeploymentMode = 'draft' | 'live'

/**
 * The deployment's CEILING, from META_PUBLISH_MODE. Anything unrecognised —
 * unset, typo'd, empty — resolves to 'draft'.
 *
 * This is the same fail-closed reasoning as PUBLISH_ALLOWED_PAGE_IDS: the
 * likeliest misconfiguration is the variable being absent, so absence must
 * mean the safe thing. A deployment that has never been told it may post
 * publicly, does not.
 */
export function resolveDeploymentMode(raw: string | undefined | null): DeploymentMode {
  return (raw ?? '').trim().toLowerCase() === 'live' ? 'live' : 'draft'
}

export interface ModeDecision {
  mode: PublishMode
  /** True when the caller asked to go live and the deployment would not let them. */
  downgraded: boolean
  /** Non-null whenever the caller should be told the outcome differs from the request. */
  warning: string | null
}

/**
 * TWO INDEPENDENT GATES for a public post, and they are owned by different
 * people on purpose:
 *
 *   META_PUBLISH_MODE=live   set on the deployment, by someone with project
 *                            access. Standing permission.
 *   confirmLive: true        sent on THIS call, by the person clicking.
 *                            Per-action intent.
 *
 * Either one missing means draft. That is deliberately not an error: a live
 * request under a draft deployment DOWNGRADES and says so. Erroring would
 * train people to retry until something works, which is the opposite of what
 * a confirmation gate is for — and the draft it produces is the evidence they
 * were probably after anyway.
 */
export function resolvePublishMode(input: {
  deployment: DeploymentMode
  dryRun: boolean
  confirmLive: boolean
}): ModeDecision {
  if (input.dryRun) return { mode: 'dry_run', downgraded: false, warning: null }

  if (input.deployment !== 'live') {
    return {
      mode: 'draft',
      downgraded: input.confirmLive,
      warning: input.confirmLive
        ? 'This deployment runs in draft mode (META_PUBLISH_MODE is not "live"), so a DRAFT was created instead of a public post. The post exists on Meta with a real id and is not visible on the Page.'
        : 'Created as a draft: a real Meta object that is not visible to the public.',
    }
  }
  if (!input.confirmLive) {
    return {
      mode: 'draft',
      downgraded: false,
      warning: 'Created as a draft because this call did not set confirm_live. The deployment permits live posts; this request did not ask for one.',
    }
  }
  return { mode: 'live', downgraded: false, warning: null }
}

/**
 * Facebook's draft switch. `published=false` on the same endpoint the live
 * call uses — the payload is otherwise IDENTICAL, which is the point: a draft
 * that took a different code path would prove nothing about the live one.
 */
export function withDraftFlag(payload: PublishPayload, mode: PublishMode): PublishPayload {
  if (mode !== 'draft') return payload
  return { endpoint: payload.endpoint, fields: { ...payload.fields, published: 'false' } }
}

// ---------------------------------------------------------------------------
// PAGE TOKEN + CAPABILITY (RB-PUB STEP 3)
// ---------------------------------------------------------------------------

export interface PageAccount {
  id: string
  name?: string
  access_token?: string
  tasks?: string[]
}

export type PageTokenResult =
  | { ok: true; token: string; pageName: string | null }
  | { ok: false; error: string; reason: 'page_not_on_token' | 'page_missing_create_content' | 'page_no_token' }

/**
 * Derives the Page token from `/me/accounts` rather than `GET /{page}?fields=
 * access_token`, and refuses a Page whose `tasks` do not include
 * CREATE_CONTENT.
 *
 * Why the change: `/{page}?fields=access_token` answers "is there a token" and
 * nothing else. A token can exist for a Page the System User can only ANALYZE
 * — read insights, not post. That request succeeds, and the failure then
 * arrives from the POST as a generic permissions error, at the one moment
 * when the user has already confirmed a live post and expects it to work.
 * `/me/accounts` returns the token and the capability in the SAME response,
 * so the check costs no extra round trip and happens before anything is sent.
 *
 * On this deployment's token: AWAAS Sandbox has ['ANALYZE','CREATE_CONTENT'],
 * so it passes; a Page with ANALYZE alone would now be refused up front.
 */
export function resolvePageToken(pages: PageAccount[], pageId: string): PageTokenResult {
  const page = pages.find((p) => String(p.id) === pageId)
  if (!page) {
    return {
      ok: false,
      reason: 'page_not_on_token',
      error: `Page ${pageId} is not among the Pages this organisation's Meta token can access. Reconnect, or pick a different Page in Settings → Publishing.`,
    }
  }
  const tasks = page.tasks ?? []
  if (!tasks.includes('CREATE_CONTENT')) {
    return {
      ok: false,
      reason: 'page_missing_create_content',
      error:
        `The connected user has no CREATE_CONTENT permission on ${page.name ?? pageId} (granted: ${tasks.join(', ') || 'none'}), ` +
        'so it cannot publish there. Grant content permission on that Page in Meta Business Settings.',
    }
  }
  if (!page.access_token) {
    return {
      ok: false,
      reason: 'page_no_token',
      error: `Meta returned no Page access token for ${page.name ?? pageId}, so the post cannot be authored as the Page.`,
    }
  }
  return { ok: true, token: page.access_token, pageName: page.name ?? null }
}

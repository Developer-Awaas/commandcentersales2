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

/** Graph version — pinned to match _shared/meta-oauth.ts. */
export const GRAPH = 'https://graph.facebook.com/v21.0'

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

/** Instagram step 1 of 2 — the media container. Publishing it is a second call. */
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
  posted_by: string | null
}

export function buildPublishedAssetRow(input: {
  orgId: string
  userId: string | null
  target: PublishTarget
  pageId: string
  igUserId?: string | null
  message: string
  dryRun: boolean
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
    dry_run: input.dryRun,
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

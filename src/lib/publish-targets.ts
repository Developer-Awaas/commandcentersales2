/**
 * Client half of publishing. Two responsibilities, kept apart on purpose:
 *
 *  - PURE (tested): given what the org has configured and what the creative
 *    has, decide whether a Post button may exist at all and what it would be
 *    posting to. No network, no Supabase, no React.
 *  - IO: read those targets through the RPC, and invoke meta-publish.
 *
 * The client decides only VISIBILITY. It never decides permission — the
 * allowlist gate lives server-side in meta-publish and is re-evaluated on
 * every call, so a stale or tampered client can at worst show a button that
 * then gets refused with a clear message.
 */
import { supabase, extractFunctionErrorMessage } from './supabase';

export type PublishPlatform = 'facebook' | 'instagram';

/** What meta_connection_status() returns about publishing, nothing more. */
export interface PublishTargets {
  pageId: string | null;
  pageName: string | null;
  igUserId: string | null;
  igUsername: string | null;
}

export const EMPTY_TARGETS: PublishTargets = {
  pageId: null, pageName: null, igUserId: null, igUsername: null,
};

export interface PublishOption {
  platform: PublishPlatform;
  /** What a human sees in the dialog — a Page name, never a numeric id when a name exists. */
  name: string;
}

/**
 * The platforms this org can actually post to right now.
 *
 * Instagram is gated on the FACEBOOK page too, not just on publish_ig_user_id:
 * an IG publish rides the linked Page's access token, so an IG target without
 * a Page target cannot work and must not be offered.
 */
export function publishOptions(t: PublishTargets): PublishOption[] {
  if (!t.pageId) return [];
  const out: PublishOption[] = [{ platform: 'facebook', name: t.pageName ?? t.pageId }];
  if (t.igUserId) {
    out.push({ platform: 'instagram', name: t.igUsername ? `@${t.igUsername}` : t.igUserId });
  }
  return out;
}

/**
 * Whether the Post button renders at all.
 *
 * Two conditions, both required, and the failure mode is HIDDEN rather than
 * disabled: a greyed-out button with no explanation is a support ticket, and
 * there is nothing the person looking at a creative can do about an org-level
 * publishing target they may not even have permission to set.
 */
export function canOfferPublish(t: PublishTargets, hasPersistedImage: boolean): boolean {
  return publishOptions(t).length > 0 && hasPersistedImage;
}

/**
 * Prefills the caption from whatever ad copy the creative already carries.
 * Headline first, CTA last, blank line between — the shape a Page post
 * actually reads in, rather than a JSON dump of the ad fields.
 *
 * Returns '' when there is nothing to prefill; the dialog then requires the
 * user to write something, which validatePublishInput enforces server-side too.
 */
export function buildDefaultCaption(parts: {
  headline?: string | null;
  body?: string | null;
  cta?: string | null;
}): string {
  return [parts.headline, parts.body, parts.cta]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

/**
 * Reads publish targets via meta_connection_status(), the same SECURITY
 * DEFINER RPC the Monitor uses. NOT a select on org_integrations: that table
 * is admin-only (bug #42), so a direct read returns nothing for a member and
 * the Post button would silently never appear for most of the team.
 */
export async function fetchPublishTargets(): Promise<PublishTargets> {
  const { data, error } = await supabase.rpc('meta_connection_status');
  if (error) {
    console.warn('[publish] meta_connection_status failed:', error.message);
    return EMPTY_TARGETS;
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    status?: string | null;
    publish_page_id?: string | null;
    publish_page_name?: string | null;
    publish_ig_user_id?: string | null;
    publish_ig_username?: string | null;
  } | undefined;
  // A disabled connection cannot publish — meta-publish refuses it server-side
  // anyway, so hiding the button here just avoids offering a dead action.
  if (!row || row.status === 'disabled') return EMPTY_TARGETS;
  return {
    pageId: row.publish_page_id ?? null,
    pageName: row.publish_page_name ?? null,
    igUserId: row.publish_ig_user_id ?? null,
    igUsername: row.publish_ig_username ?? null,
  };
}

/**
 * Three tiers, in increasing order of consequence — see _shared/meta-publish.ts.
 *   dry_run  nothing reaches Graph
 *   draft    a real Meta object nobody can see
 *   live     public; needs META_PUBLISH_MODE=live on the deployment TOO, and
 *            silently downgrades to draft if the deployment says otherwise
 */
export type PublishMode = 'dry_run' | 'draft' | 'live';

export interface PublishRequest {
  target: PublishPlatform;
  message: string;
  imageUrl?: string | null;
  creativeAssetId?: string | null;
  toolOutputId?: string | null;
  projectId?: string | null;
  mode: PublishMode;
}

export interface PublishResponse {
  ok: boolean;
  mode?: PublishMode;
  dry_run: boolean;
  published?: boolean;
  /** True when a live request ran as a draft because the deployment forbids live. */
  downgraded?: boolean;
  mode_warning?: string | null;
  target_name?: string;
  meta_post_id?: string | null;
  permalink?: string | null;
  published_asset_id?: string | null;
  would_post?: { endpoint: string; fields: Record<string, string> };
  token_warning?: string | null;
  note?: string;
  error?: string;
}

export async function publishToMeta(req: PublishRequest): Promise<PublishResponse> {
  const { data, error } = await supabase.functions.invoke('meta-publish', {
    body: {
      target: req.target,
      message: req.message,
      image_url: req.imageUrl ?? null,
      creative_asset_id: req.creativeAssetId ?? null,
      tool_output_id: req.toolOutputId ?? null,
      project_id: req.projectId ?? null,
      // Two independent flags, deliberately not one enum on the wire: the
      // server's default for a missing/garbled dry_run is TRUE, and for a
      // missing confirm_live is FALSE, so a malformed request degrades toward
      // safety instead of toward a public post.
      dry_run: req.mode === 'dry_run',
      confirm_live: req.mode === 'live',
    },
  });
  if (error) {
    // The readable server message lives on error.context, not error.message —
    // reading only .message turns "Page X is not on the allowlist" into
    // "non-2xx status code", which is the one thing the operator needs to know.
    return { ok: false, dry_run: req.mode === 'dry_run', error: await extractFunctionErrorMessage(error, 'Publish failed') };
  }
  return (data ?? { ok: false, dry_run: req.mode === 'dry_run', error: 'Empty response' }) as PublishResponse;
}

/**
 * Shared Meta (Facebook Login for Business) OAuth + token-provenance helpers.
 *
 * Same shape as _shared/canva-oauth.ts, second verse — with two deliberate
 * differences, both provider-driven rather than stylistic:
 *
 *  1. NO PKCE. Facebook Login does not support it. The single-use opaque state
 *     nonce in oauth_flow_sessions is the CSRF control, exactly as it is for
 *     Canva; PKCE was only ever the *additional* layer there. Storing a fake
 *     verifier to look symmetrical would misrepresent the flow.
 *
 *  2. A MANDATORY /debug_token check before anything is stored. This is the
 *     whole reason this file exists: the previous stored token was minted by
 *     an app that has since been DELETED, and nothing noticed for a month,
 *     because a populated-looking row is indistinguishable from a working one.
 *     verifyMetaToken() is the door, and both the OAuth callback and the
 *     manual paste path must come through it.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from './database.types.ts'

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * The R-A permission set — what we ASK for at dialog time. What was actually
 * GRANTED is read back from /debug_token and stored separately; a user can
 * decline individual scopes on Meta's consent screen and the difference is
 * exactly what breaks a review.
 */
export const META_SCOPES = [
  'ads_read',
  'ads_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
] as const

export function metaAppId(): string { return Deno.env.get('META_APP_ID') ?? '' }
function metaAppSecret(): string { return Deno.env.get('META_APP_SECRET') ?? '' }

/** App access token — `{app_id}|{app_secret}`. Required by /debug_token. */
function appAccessToken(): string { return metaAppId() + '|' + metaAppSecret() }

export function metaConfigured(): boolean { return !!metaAppId() && !!metaAppSecret() }

async function graphGet(
  path: string,
  params: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(GRAPH + path + '?' + qs, { signal: AbortSignal.timeout(20_000) })
  let body: Record<string, unknown> = {}
  try { body = await res.json() } catch { /* non-JSON error page */ }
  return { status: res.status, body }
}

/** Human-readable Graph error, without leaking the token that produced it. */
function graphError(body: Record<string, unknown>): string {
  const e = (body?.error ?? {}) as Record<string, unknown>
  const msg = String(e.message ?? 'Unknown Graph error')
  return e.code ? msg + ' (code ' + String(e.code) + ')' : msg
}

export interface MetaTokenFacts {
  appId: string
  tokenType: string
  userId: string | null
  /** ISO string, or null for tokens that never expire (System User). */
  expiresAt: string | null
  scopes: string[]
  isValid: boolean
}

export type VerifyResult =
  | { ok: true; facts: MetaTokenFacts }
  | { ok: false; error: string; reason: 'unconfigured' | 'invalid' | 'foreign_app' | 'graph_error' }

/**
 * THE DOOR. Verifies a token against /debug_token using the APP token, and
 * refuses anything not demonstrably ours and demonstrably alive.
 *
 * Rejecting here — rather than storing and discovering later — is the entire
 * lesson of the dead-app incident: a token stored without provenance fails
 * silently inside a cron job, where the only symptom is `skipped`.
 */
export async function verifyMetaToken(inputToken: string): Promise<VerifyResult> {
  if (!metaConfigured()) {
    return {
      ok: false,
      reason: 'unconfigured',
      error: 'META_APP_ID / META_APP_SECRET are not set on this project, so token provenance cannot be verified.',
    }
  }

  const { status, body } = await graphGet('/debug_token', {
    input_token: inputToken,
    access_token: appAccessToken(),
  })

  if (status !== 200 || !body.data) {
    // The dead-app case lands here: OAuthException 190 "Application has been
    // deleted" — surfaced verbatim so the cause is never a guess again.
    return { ok: false, reason: 'graph_error', error: graphError(body) }
  }

  const d = body.data as Record<string, unknown>
  const appId = String(d.app_id ?? '')

  if (d.is_valid !== true) {
    const inner = (d.error ?? {}) as Record<string, unknown>
    const detail = inner.message ? ': ' + String(inner.message) : '.'
    return { ok: false, reason: 'invalid', error: 'Meta reports this token is not valid' + detail }
  }

  if (appId && appId !== metaAppId()) {
    return {
      ok: false,
      reason: 'foreign_app',
      error: 'This token was minted by app ' + appId + ', not this application (' + metaAppId() + '). Re-mint it under the correct app.',
    }
  }

  // expires_at of 0 means "never" (System User tokens) — NOT the epoch.
  const expUnix = Number(d.expires_at ?? 0)
  return {
    ok: true,
    facts: {
      appId,
      tokenType: String(d.type ?? 'UNKNOWN'),
      userId: d.user_id ? String(d.user_id) : null,
      expiresAt: expUnix > 0 ? new Date(expUnix * 1000).toISOString() : null,
      scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [],
      isValid: true,
    },
  }
}

/** Login dialog URL. `state` carries the opaque single-use nonce and nothing else. */
export function buildMetaAuthUrl(nonce: string, redirectUri: string): string {
  const configId = Deno.env.get('META_CONFIG_ID') ?? ''
  const params = new URLSearchParams({
    client_id: metaAppId(),
    redirect_uri: redirectUri,
    state: nonce,
    response_type: 'code',
  })
  // Login for Business drives scopes from a saved configuration; classic Login
  // uses `scope`. Supporting both means this works before and after a config
  // is created in the dashboard, rather than blocking on it.
  if (configId) params.set('config_id', configId)
  else params.set('scope', META_SCOPES.join(','))
  return 'https://www.facebook.com/v21.0/dialog/oauth?' + params.toString()
}

export type ExchangeResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string }

/** code -> short-lived token -> long-lived token. Never returns the short-lived one. */
export async function exchangeCodeForLongLivedToken(code: string, redirectUri: string): Promise<ExchangeResult> {
  const short = await graphGet('/oauth/access_token', {
    client_id: metaAppId(),
    client_secret: metaAppSecret(),
    redirect_uri: redirectUri,
    code,
  })
  if (short.status !== 200 || !short.body.access_token) {
    return { ok: false, error: 'Code exchange failed: ' + graphError(short.body) }
  }

  // Short-lived user tokens last ~1-2 hours — useless for a 15-minute cron
  // sync and useless for a reviewer returning tomorrow. Always upgrade.
  const long = await graphGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: metaAppId(),
    client_secret: metaAppSecret(),
    fb_exchange_token: String(short.body.access_token),
  })
  if (long.status !== 200 || !long.body.access_token) {
    return { ok: false, error: 'Long-lived exchange failed: ' + graphError(long.body) }
  }
  return { ok: true, accessToken: String(long.body.access_token) }
}

export interface MetaAssets {
  adAccountId: string | null
  pageId: string | null
  igUserId: string | null
}

/**
 * Best-effort asset discovery. A failure here must NOT fail the connect: the
 * token is already verified and worth storing, and assets can be chosen later
 * in Settings. Losing a verified connection over a missing Page is the worse
 * outcome.
 */
export async function resolveMetaAssets(accessToken: string): Promise<MetaAssets> {
  const out: MetaAssets = { adAccountId: null, pageId: null, igUserId: null }

  const acct = await graphGet('/me/adaccounts', { access_token: accessToken, fields: 'account_id', limit: '1' })
  const acctRows = (acct.body.data ?? []) as Record<string, unknown>[]
  if (acctRows.length && acctRows[0].account_id) out.adAccountId = 'act_' + String(acctRows[0].account_id)

  const pages = await graphGet('/me/accounts', { access_token: accessToken, fields: 'id,instagram_business_account', limit: '1' })
  const pageRows = (pages.body.data ?? []) as Record<string, unknown>[]
  if (pageRows.length) {
    out.pageId = String(pageRows[0].id ?? '') || null
    const ig = pageRows[0].instagram_business_account as Record<string, unknown> | undefined
    if (ig && ig.id) out.igUserId = String(ig.id)
  }
  return out
}

/** The single write point for a verified Meta connection. */
export async function storeMetaConnection(
  serviceClient: SupabaseClient<Database>,
  orgId: string,
  accessToken: string,
  facts: MetaTokenFacts,
  assets: MetaAssets,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Typed against the table's own Insert shape rather than Record<string,
  // unknown>: that looseness is exactly what lets a wrong column name through
  // (bugs #47/#48), and here the compiler can catch it for us.
  type OrgIntegrationInsert = Database['public']['Tables']['org_integrations']['Insert']

  const row: OrgIntegrationInsert = {
    org_id: orgId,
    provider: 'meta',
    meta_access_token: accessToken,
    meta_app_id: facts.appId,
    meta_token_type: facts.tokenType,
    meta_user_id: facts.userId,
    meta_granted_scopes: facts.scopes,
    meta_verified_at: new Date().toISOString(),
    token_expires_at: facts.expiresAt,
    is_active: true,
    updated_at: new Date().toISOString(),
    // Only set an asset id when discovery actually found one — a failed lookup
    // must not wipe a selection the user made by hand.
    ...(assets.adAccountId ? { meta_ad_account_id: assets.adAccountId } : {}),
    ...(assets.pageId ? { meta_page_id: assets.pageId } : {}),
    ...(assets.igUserId ? { meta_ig_user_id: assets.igUserId } : {}),
  }

  const { data: existing } = await serviceClient
    .from('org_integrations')
    .select('id')
    .eq('org_id', orgId)
    .eq('provider', 'meta')
    .maybeSingle()

  const { error } = existing
    ? await serviceClient.from('org_integrations').update(row).eq('id', (existing as { id: string }).id)
    : await serviceClient.from('org_integrations').insert(row)

  // Bug #47/#48: a wrong column name here does NOT throw — PostgREST returns
  // it in `error` and the call resolves normally. Checking is the only way it
  // ever surfaces.
  if (error) return { ok: false, error: 'Could not store connection: ' + error.message }
  return { ok: true }
}

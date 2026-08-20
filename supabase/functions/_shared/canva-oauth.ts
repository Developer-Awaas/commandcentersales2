/**
 * Shared PKCE + server-authoritative identity resolution for Canva OAuth
 * initiation. Used by both canva-connect-init (Settings page "Connect
 * Canva" button) and canva-open-editor's cold-start fallback (first-ever
 * "Edit in Canva" click on a specific creative) — same treatment via one
 * helper, not two independently-maintained copies.
 *
 * Why this exists: Canva's Connect API requires PKCE (code_challenge,
 * SHA-256) on the authorize request — without it Canva rejects the request
 * before ever considering redirect_uri, which is indistinguishable from a
 * portal-misconfiguration from our side (confirmed against Canva's own
 * docs: https://www.canva.dev/docs/connect/authentication/). Previously
 * neither call site sent PKCE at all.
 *
 * Also: the OAuth `state` param used to carry {returnUrl, userId, orgId} as
 * client-visible JSON. That's a server-authoritative violation — the
 * eventual token write in canva-oauth-callback runs on the service-role
 * client (bypasses RLS), so whatever identity state carries gets trusted
 * blindly. state is now an opaque nonce only; the real identity and the
 * PKCE code_verifier live server-side in oauth_flow_sessions (RLS deny-all,
 * service-role only), single-use and short-lived.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Database } from './database.types.ts';

const CANVA_AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
const CANVA_SCOPE = 'design:content:read design:content:write asset:read asset:write';
const OAUTH_SESSION_TTL_MINUTES = 10;

// PKCE code_verifier charset per RFC 7636: unreserved characters only.
const VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

function base64UrlEncode(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const randomBytes = new Uint8Array(64);
  crypto.getRandomValues(randomBytes);
  let codeVerifier = '';
  for (const b of randomBytes) codeVerifier += VERIFIER_CHARSET[b % VERIFIER_CHARSET.length];
  codeVerifier = codeVerifier.slice(0, 128);

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));

  return { codeVerifier, codeChallenge };
}

export interface CallerIdentity {
  userId: string;
  orgId: string;
}

export type IdentityResult =
  | { ok: true; identity: CallerIdentity }
  | { ok: false; status: number; error: string };

// Mirrors aarav-orchestrate's pattern (index.ts ~line 195-225): never trust
// org_id/userId from the request body — derive from the caller's own JWT,
// then a profiles lookup.
export async function resolveCallerIdentity(req: Request): Promise<IdentityResult> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { ok: false, status: 401, error: 'Missing Authorization header' };

  const userClient = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return { ok: false, status: 401, error: 'Invalid or expired session' };
  const userId = userData.user.id;

  const { data: profile, error: profileErr } = await userClient
    .from('profiles').select('org_id').eq('id', userId).single();
  if (profileErr || !profile?.org_id) return { ok: false, status: 403, error: 'No organization found for this user' };

  return { ok: true, identity: { userId, orgId: profile.org_id as string } };
}

// Generates PKCE, stores {user_id, org_id, code_verifier, return_url,
// creative_id} behind a fresh opaque nonce (service-role only, RLS
// deny-all, single-use, 10 min TTL), and returns the authUrl with state =
// that nonce alone — no identity or verifier travels in the URL/redirect
// chain. creativeId is set only when initiated from a specific creative's
// "Edit in Canva" cold-start (canva-open-editor), so the return landing
// page can auto-resume that creative once connected.
export async function initiateCanvaOAuth(
  serviceClient: SupabaseClient<Database>,
  params: { userId: string; orgId: string; returnUrl: string; creativeId?: string }
): Promise<{ authUrl: string } | { error: string }> {
  const clientId = Deno.env.get('CANVA_CLIENT_ID');
  if (!clientId) return { error: 'CANVA_CLIENT_ID secret is not set' };

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const redirectUri = `${supabaseUrl}/functions/v1/canva-oauth-callback`;

  const { codeVerifier, codeChallenge } = await generatePkcePair();

  const { data: session, error } = await serviceClient
    .from('oauth_flow_sessions')
    .insert({
      provider: 'canva',
      user_id: params.userId,
      org_id: params.orgId,
      code_verifier: codeVerifier,
      return_url: params.returnUrl,
      creative_id: params.creativeId ?? null,
      expires_at: new Date(Date.now() + OAUTH_SESSION_TTL_MINUTES * 60_000).toISOString(),
    })
    .select('nonce')
    .single();

  if (error || !session) return { error: `Failed to create OAuth flow session: ${error?.message ?? 'no row returned'}` };

  const authUrl = [
    CANVA_AUTHORIZE_URL,
    `?client_id=${encodeURIComponent(clientId)}`,
    `&response_type=code`,
    `&scope=${encodeURIComponent(CANVA_SCOPE)}`,
    `&redirect_uri=${encodeURIComponent(redirectUri)}`,
    `&code_challenge=${encodeURIComponent(codeChallenge)}`,
    `&code_challenge_method=S256`,
    `&state=${encodeURIComponent(session.nonce as string)}`,
  ].join('');

  return { authUrl };
}

// Single-use lookup: deletes the row as part of resolving it, so a nonce
// can never be replayed even if the callback URL leaks (browser history,
// referrer headers, logs).
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
// Refresh a bit before actual expiry so a request never races a token that
// expires mid-flight.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type CanvaTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; needsReconnect: true; error: string };

/**
 * Returns a valid Canva access token for (userId, 'canva'), refreshing it
 * first if it's expired or close to it. Canva's refresh tokens are
 * single-use and rotate on every refresh (confirmed against their docs:
 * https://www.canva.dev/docs/connect/api-reference/authentication/generate-access-token/
 * — reusing a stale refresh token revokes the ENTIRE token family, not just
 * that one call), so the NEW refresh_token from the response is always
 * persisted alongside the new access_token — never just the access_token.
 * If the refresh itself fails (refresh token expired/already used/revoked),
 * the stale row is removed so the caller can fall back to needsAuth
 * (re-connect) instead of retrying with a token that will never work.
 */
export async function getValidCanvaAccessToken(
  serviceClient: SupabaseClient<Database>,
  userId: string
): Promise<CanvaTokenResult> {
  const { data: row, error } = await serviceClient
    .from('org_user_integrations')
    .select('access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .eq('provider', 'canva')
    .maybeSingle();

  if (error || !row?.access_token) {
    return { ok: false, needsReconnect: true, error: 'Canva is not connected' };
  }

  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at as string).getTime() : 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS;

  if (!needsRefresh) {
    return { ok: true, accessToken: row.access_token as string };
  }

  if (!row.refresh_token) {
    // Access token is expired/expiring and there's no refresh token to use
    // — nothing left to do but ask the user to reconnect.
    await serviceClient.from('org_user_integrations').delete().eq('user_id', userId).eq('provider', 'canva');
    return { ok: false, needsReconnect: true, error: 'Canva session expired — please reconnect' };
  }

  const clientId = Deno.env.get('CANVA_CLIENT_ID');
  const clientSecret = Deno.env.get('CANVA_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    return { ok: false, needsReconnect: true, error: 'CANVA_CLIENT_ID/CANVA_CLIENT_SECRET secret is not set' };
  }

  const refreshRes = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token as string,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const refreshJson = await refreshRes.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!refreshRes.ok || !refreshJson.access_token || !refreshJson.refresh_token) {
    // A used/expired/revoked refresh token means this connection is dead —
    // remove it rather than leaving a row that will fail forever.
    await serviceClient.from('org_user_integrations').delete().eq('user_id', userId).eq('provider', 'canva');
    return {
      ok: false,
      needsReconnect: true,
      error: refreshJson.error_description ?? refreshJson.error ?? 'Canva token refresh failed — please reconnect',
    };
  }

  const newExpiresAt = new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString();

  // Both the new access_token AND the new refresh_token must be saved —
  // the old refresh_token is now invalid (single-use rotation).
  await serviceClient.from('org_user_integrations').update({
    access_token: refreshJson.access_token,
    refresh_token: refreshJson.refresh_token,
    token_expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId).eq('provider', 'canva');

  return { ok: true, accessToken: refreshJson.access_token };
}

export async function consumeOAuthFlowSession(
  serviceClient: SupabaseClient<Database>,
  nonce: string
): Promise<
  | { ok: true; session: { userId: string; orgId: string; codeVerifier: string; returnUrl: string; creativeId: string | null } }
  // `reason` is additive — existing callers that only read `error` are
  // unaffected. It exists because "row missing" used to mean three different
  // bugs at once (replayed / forged / expired) and callers could not tell them
  // apart to say anything useful.
  | { ok: false; error: string; reason: 'not_found' | 'already_used' | 'expired' }
> {
  const { data: row, error } = await serviceClient
    .from('oauth_flow_sessions')
    .select('user_id, org_id, code_verifier, return_url, creative_id, expires_at, consumed_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (error) return { ok: false, error: `Lookup failed: ${error.message}`, reason: 'not_found' };
  if (!row) {
    return { ok: false, error: 'This sign-in link was not recognised. Start the connection again from Settings.', reason: 'not_found' };
  }

  // ALREADY USED is checked BEFORE expiry: a replayed callback on a session
  // that has since aged out is still a replay, and "you already finished this"
  // is the useful thing to say. Reporting it as expired would send someone to
  // redo a connection that already worked.
  if (row.consumed_at) {
    return { ok: false, error: 'This connection was already completed — nothing more to do.', reason: 'already_used' };
  }

  // Mark consumed rather than delete: single-use is preserved (the check above
  // refuses it next time) while the reason for a later miss survives.
  await serviceClient
    .from('oauth_flow_sessions')
    .update({ consumed_at: new Date().toISOString() })
    .eq('nonce', nonce);

  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: 'This sign-in link expired before it was used. Start again from Settings.', reason: 'expired' };
  }

  return {
    ok: true,
    session: {
      userId: row.user_id as string,
      orgId: row.org_id as string,
      codeVerifier: row.code_verifier as string,
      returnUrl: row.return_url as string,
      creativeId: row.creative_id as string | null,
    },
  };
}

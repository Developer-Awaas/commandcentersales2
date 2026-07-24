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

// Generates PKCE, stores {user_id, org_id, code_verifier, return_url} behind
// a fresh opaque nonce (service-role only, RLS deny-all, single-use, 10 min
// TTL), and returns the authUrl with state = that nonce alone — no identity
// or verifier travels in the URL/redirect chain.
export async function initiateCanvaOAuth(
  serviceClient: SupabaseClient<Database>,
  params: { userId: string; orgId: string; returnUrl: string }
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
export async function consumeOAuthFlowSession(
  serviceClient: SupabaseClient<Database>,
  nonce: string
): Promise<
  | { ok: true; session: { userId: string; orgId: string; codeVerifier: string; returnUrl: string } }
  | { ok: false; error: string }
> {
  const { data: row, error } = await serviceClient
    .from('oauth_flow_sessions')
    .select('user_id, org_id, code_verifier, return_url, expires_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (error) return { ok: false, error: `Lookup failed: ${error.message}` };
  if (!row) return { ok: false, error: 'OAuth flow session not found — expired, already used, or invalid state' };

  // Delete immediately after reading, regardless of expiry outcome below —
  // a nonce is single-use whether or not it was still valid.
  await serviceClient.from('oauth_flow_sessions').delete().eq('nonce', nonce);

  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: 'OAuth flow session expired — please try connecting again' };
  }

  return {
    ok: true,
    session: {
      userId: row.user_id as string,
      orgId: row.org_id as string,
      codeVerifier: row.code_verifier as string,
      returnUrl: row.return_url as string,
    },
  };
}

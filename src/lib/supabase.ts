import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// supabase.functions.invoke()'s error on a non-2xx response is always the
// generic FunctionsHttpError("Edge Function returned a non-2xx status
// code") — the actual JSON body our function sent (the readable message)
// lives on error.context (the raw Response), not error.message. Reading
// only .message silently discards it, which is exactly why detailed
// server-side error text was showing up as a bare, unhelpful status code
// on the client. Use this wherever a functions.invoke() error needs to be
// shown to a user.
export async function extractFunctionErrorMessage(error: unknown, fallback = 'Request failed'): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof (context as Response).json === 'function') {
    try {
      const body = await (context as Response).json();
      if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
        return (body as { error: string }).error;
      }
    } catch { /* not JSON or already consumed — fall through */ }
  }
  return error instanceof Error ? error.message : fallback;
}

// PARKED WIP — NOTE FOR REVIEW: this predates extractFunctionErrorMessage
// above (from PR#12, already on main) and overlaps with it — both exist to
// surface a real error message from a functions.invoke() failure, plus this
// one adds proactive JWT-refresh-and-retry. Keeping both here unresolved on
// purpose since deciding which pattern to standardize on (or whether
// invokeEdgeFn's retry behavior should be folded into extractFunctionErrorMessage's
// callers) is a real design decision, not something to silently pick while parking.
//
// Returns true if the JWT is expired or expires within bufferSeconds.
// JWTs use base64URL encoding (- and _ instead of + and /); atob requires
// standard base64, so we convert before decoding. Safe for client-side
// expiry pre-check only — not for security decisions.
function jwtExpiredOrExpiringSoon(token: string, bufferSeconds = 30): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    // base64URL → standard base64 with padding
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return Date.now() / 1000 > payload.exp - bufferSeconds;
  } catch {
    return false;
  }
}

/**
 * Invoke a Supabase Edge Function with the user's JWT explicitly included.
 *
 * Strategy:
 * 1. Get the current session. If the access_token is missing OR its JWT exp
 *    claim is expired/about to expire (within 30 s), proactively call
 *    refreshSession() to get a fresh token before making the call.
 * 2. If the call still returns an auth error (UNAUTHORIZED / non-2xx and we
 *    managed to refresh to a new token), retry exactly once — covers clock
 *    skew or background-refresh race conditions.
 *
 * @supabase/functions-js v2.4.x never auto-injects the session token —
 * it only uses the anon key set at FunctionsClient construction time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeEdgeFn<T = any>(
  fnName: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<{ data: T | null; error: Error | null }> {
  type InvokeResult = { data: T | null; error: Error | null };

  let { data: { session } } = await supabase.auth.getSession();

  const tokenExp = session?.access_token
    ? (() => {
        try {
          const b64 = session!.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
          return (JSON.parse(atob(padded)) as { exp?: number }).exp;
        } catch { return null; }
      })()
    : null;
  const nowSec = Math.floor(Date.now() / 1000);
  console.warn(`[invokeEdgeFn] ${fnName} — token exp=${tokenExp} now=${nowSec} diff=${tokenExp ? tokenExp - nowSec : 'n/a'}s session=${!!session}`);

  // Proactively refresh if: no token at all, OR token is expired/expiring soon.
  // getSession() returns the cached session even when the JWT inside it has expired.
  if (!session?.access_token || jwtExpiredOrExpiringSoon(session.access_token)) {
    console.warn(`[invokeEdgeFn] ${fnName} — proactive refresh triggered`);
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
      .catch((e) => ({ data: { session: null }, error: e as Error }));
    console.warn(`[invokeEdgeFn] ${fnName} — refresh result: session=${!!refreshed.session?.access_token} err=${(refreshErr as Error | null)?.message ?? 'none'}`);
    if (refreshed.session?.access_token) session = refreshed.session;
  }

  const buildHeaders = (tok: string | undefined) => {
    const h: Record<string, string> = {};
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    if (extraHeaders) Object.assign(h, extraHeaders);
    return h;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first = await (supabase.functions.invoke<T>(fnName, { body: body as any, headers: buildHeaders(session?.access_token) }) as Promise<InvokeResult>);

  // Determine the actual HTTP status to correctly classify the error.
  // FunctionsHttpError always has message "non-2xx" regardless of whether it's
  // a 401 (auth failure) or 546 (function crash) — we must read context.status.
  // Only 401/403 are authentication failures that warrant a token refresh + retry.
  // 500/546 are function crashes — retrying is pointless, show the real error.
  const httpStatus = (first.error as unknown as { context?: Response })?.context?.status ?? 0;
  const errMsg = first.error?.message ?? '';
  const isAuthErr = httpStatus === 401 || httpStatus === 403 ||
    errMsg.includes('UNAUTHORIZED') || errMsg.includes('Missing authorization');
  const isFetchErr = errMsg.includes('Failed to send a request');
  const isCrash = !isAuthErr && !isFetchErr && httpStatus >= 400;

  console.warn(`[invokeEdgeFn] ${fnName} — first attempt: status=${httpStatus} data=${!!first.data} error=${first.error?.message ?? 'none'} isAuth=${isAuthErr} isCrash=${isCrash}`);

  // For function crashes (500/546), try to surface the real error from the response body.
  if (first.error && isCrash) {
    let detail = `Edge Function error (HTTP ${httpStatus})`;
    try {
      const ctx = (first.error as unknown as { context?: Response }).context;
      if (ctx) {
        const body = await ctx.clone().text();
        console.warn(`[invokeEdgeFn] ${fnName} — crash body:`, body);
        const parsed = JSON.parse(body);
        detail = parsed?.error?.message ?? parsed?.message ?? parsed?.msg ?? body.slice(0, 300);
      }
    } catch { /* ignore */ }
    return { data: null, error: new Error(detail) };
  }

  if (first.error && (isAuthErr || isFetchErr)) {
    let retryToken = session?.access_token;
    if (isAuthErr) {
      const { data: retryRefreshed } = await supabase.auth.refreshSession().catch(() => ({ data: { session: null } }));
      const newToken = retryRefreshed.session?.access_token;
      console.warn(`[invokeEdgeFn] ${fnName} — auth error retry: refreshed=${!!newToken} same=${newToken === session?.access_token}`);
      if (newToken) retryToken = newToken;
      if (!newToken || newToken === session?.access_token) return first;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = await (supabase.functions.invoke<T>(fnName, { body: body as any, headers: buildHeaders(retryToken) }) as Promise<InvokeResult>);
    console.warn(`[invokeEdgeFn] ${fnName} — retry attempt: data=${!!second.data} error=${second.error?.message ?? 'none'}`);
    return second;
  }

  return first;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  org_id: string | null;
  module_access: Record<string, boolean> | string[];
  role: string;
  avatar_url?: string | null;
  learning_mode?: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}


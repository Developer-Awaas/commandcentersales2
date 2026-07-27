// Canva's own OAuth authorize endpoint sends X-Frame-Options: SAMEORIGIN
// (confirmed via a direct HEAD request) — it refuses to render inside an
// iframe from any other origin, so there is no iframe-embeddable path for
// the actual consent screen. A popup is the only alternative to a
// same-window redirect (which wipes all in-page React state).
//
// Two earlier popup attempts failed because they signalled completion via
// window.opener + postMessage (and later BroadcastChannel, which still
// implicitly assumed the popup could reliably reach back). Canva also sends
// Cross-Origin-Opener-Policy: same-origin (confirmed via the same request)
// — the popup's navigation path is this app -> canva.com -> this project's
// own Supabase edge function domain -> this app again, and that COOP header
// severs window.opener the moment the popup lands on Canva's origin. No
// signal mechanism that depends on the opener reference can survive that,
// which is exactly why postMessage-via-opener AND opener-gated
// BroadcastChannel both failed in practice.
//
// localStorage's `storage` event has no dependency on window.opener at
// all — it's pure same-origin storage, fired to every OTHER same-origin
// tab whenever a key changes, regardless of how those tabs relate to each
// other. Once the popup's OAuth round-trip lands back on THIS app's own
// origin (via canva-oauth-callback's redirect), it can write to this
// app's localStorage exactly as any other tab of this origin would,
// entirely independent of whatever COOP severed on Canva's side.
const STORAGE_KEY = 'canva_oauth_popup_result';

interface CanvaOAuthResult {
  connected: boolean;
  error?: string;
  ts: number;
}

// Called by CanvaReturn.tsx once it lands back on this app's origin inside
// the popup, before attempting to close itself.
export function signalCanvaOAuthComplete(result: { connected: boolean; error?: string }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...result, ts: Date.now() } satisfies CanvaOAuthResult));
    // Immediately remove it — only the storage *event* (fired to other
    // tabs at the moment of the write) matters, not a lingering value that
    // a later mount could misread as a stale "already complete" signal.
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* localStorage unavailable (rare) — nothing else to fall back to here */ }
}

/**
 * Opens Canva's OAuth authorize URL in an already-open (blank) popup tab —
 * see `pendingTab` in ImageGalleryViewer.tsx / CreativeViewer.tsx for why
 * it's opened synchronously by the caller rather than here: window.open()
 * after an await can lose "user activation" and get silently blocked.
 * Falls back to a same-window redirect if the popup was never actually
 * opened (blocked, or the caller had no synchronous gesture to spend).
 */
export function openCanvaOAuthPopup(
  pendingTab: Window | null,
  authUrl: string,
  onConnected: () => void,
  onError?: (message: string) => void
): void {
  if (!pendingTab) {
    window.location.href = authUrl;
    return;
  }
  pendingTab.location.href = authUrl;

  function handleStorage(e: StorageEvent) {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    let result: CanvaOAuthResult;
    try { result = JSON.parse(e.newValue); } catch { return; }
    window.removeEventListener('storage', handleStorage);
    window.clearInterval(pollClosed);
    // Bring this (the original) tab back into focus — the popup closing
    // itself doesn't always return focus to the tab that opened it.
    window.focus();
    if (result.connected) onConnected();
    else if (result.error) onError?.(result.error);
  }
  window.addEventListener('storage', handleStorage);

  // The user may just close the popup without finishing — nothing else
  // will ever fire in that case, so stop listening rather than leak it.
  const pollClosed = window.setInterval(() => {
    if (pendingTab.closed) {
      window.clearInterval(pollClosed);
      window.removeEventListener('storage', handleStorage);
    }
  }, 500);
}

// ─── Canva's separate "Return Navigation" feature ──────────────────────────
//
// Distinct from the OAuth connect flow above. Once "Return navigation" is
// enabled for this integration in the Canva Developer Portal (a single
// fixed return URL configured there, not something this app sets
// per-request), Canva's editor shows a "Return" button once the user opens
// a design created via the API. Clicking it navigates that SAME editor tab
// to `{returnUrl}?correlation_jwt=...` — landing in the tab this app
// originally opened via `pendingTab` for the editor, not the tab that
// opened it. Signalled back the same way as the OAuth flow, via
// localStorage (see above for why, not window.opener/postMessage).
const EDITOR_RETURN_KEY = 'canva_editor_return_result';

// Called by CanvaEditorReturn.tsx once it has verified the correlation_jwt
// server-side (never trust it unverified — see canva-verify-return-nav).
export function signalCanvaEditorReturn(ok: boolean): void {
  try {
    localStorage.setItem(EDITOR_RETURN_KEY, JSON.stringify({ ok, ts: Date.now() }));
    localStorage.removeItem(EDITOR_RETURN_KEY);
  } catch { /* localStorage unavailable (rare) */ }
}

/**
 * Listens for the editor-return signal on the tab that opened the Canva
 * editor. `pendingTab` is polled so the listener cleans itself up if the
 * user just closes the editor tab without ever clicking "Return".
 */
export function listenForCanvaEditorReturn(pendingTab: Window | null, onReturned: (ok: boolean) => void): void {
  if (!pendingTab) return; // no popup was actually opened — nothing to listen for
  function handleStorage(e: StorageEvent) {
    if (e.key !== EDITOR_RETURN_KEY || !e.newValue) return;
    window.removeEventListener('storage', handleStorage);
    window.clearInterval(pollClosed);
    let result: { ok: boolean };
    try { result = JSON.parse(e.newValue); } catch { return; }
    window.focus();
    onReturned(result.ok);
  }
  window.addEventListener('storage', handleStorage);

  const pollClosed = window.setInterval(() => {
    if (pendingTab.closed) {
      window.clearInterval(pollClosed);
      window.removeEventListener('storage', handleStorage);
    }
  }, 500);
}

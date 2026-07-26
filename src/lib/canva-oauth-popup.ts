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

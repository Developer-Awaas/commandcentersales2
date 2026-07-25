// Opens Canva's OAuth authorize screen in a real popup window instead of
// navigating the current tab away — the previous same-tab
// `window.location.href = authUrl` approach wiped all in-page React state
// (whatever strategy/creatives had just been generated) and tripped
// `beforeunload` "unsaved changes" guards on the very first Edit-in-Canva
// click after a fresh generation, since that's a genuine top-level
// navigation. A popup means the calling tab is never touched at all.
//
// Completion is signalled back via postMessage from CanvaReturn.tsx (which
// detects `window.opener` and hands off instead of navigating itself) —
// see that file for the other half of this flow.
export function openCanvaOAuthPopup(
  authUrl: string,
  onConnected: () => void,
  onError?: (message: string) => void
): void {
  const popup = window.open(authUrl, 'canva-oauth', 'width=640,height=760');

  if (!popup) {
    // Blocked by the browser (some popup blockers reject even
    // user-gesture-triggered opens after an intervening await). Fall back
    // to the old same-tab redirect — still recoverable: Strategy.tsx's
    // DB-backed resume and ImageGalleryViewer's own auto-resume effect
    // reconstruct state after CanvaReturn.tsx lands back on this page.
    window.location.href = authUrl;
    return;
  }

  function handleMessage(e: MessageEvent) {
    if (e.origin !== window.location.origin) return;
    if (!e.data || e.data.type !== 'canva-oauth-complete') return;
    window.removeEventListener('message', handleMessage);
    window.clearInterval(pollClosed);
    if (e.data.connected) onConnected();
    else if (e.data.error) onError?.(e.data.error);
  }
  window.addEventListener('message', handleMessage);

  // The user may just close the popup without finishing — nothing else
  // will ever fire in that case, so stop listening rather than leak it.
  const pollClosed = window.setInterval(() => {
    if (popup.closed) {
      window.clearInterval(pollClosed);
      window.removeEventListener('message', handleMessage);
    }
  }, 500);
}

// Opens Canva's OAuth authorize screen in a real popup window instead of
// navigating the current tab away — the previous same-tab
// `window.location.href = authUrl` approach wiped all in-page React state
// (whatever strategy/creatives had just been generated) and tripped
// `beforeunload` "unsaved changes" guards on the very first Edit-in-Canva
// click after a fresh generation, since that's a genuine top-level
// navigation. A popup means the calling tab is never touched at all.
//
// Completion is signalled back via BroadcastChannel, not window.opener +
// postMessage — the popup's actual navigation path is app -> canva.com ->
// this project's own Supabase edge function domain (canva-oauth-callback)
// -> the app again, three distinct origins. Browsers can and do sever
// window.opener across cross-origin hops like this as a security default
// (independent of any COOP header we'd have to opt into), which would
// silently turn the popup into an orphaned second copy of the app instead
// of ever notifying the tab that opened it. BroadcastChannel doesn't
// reference the opening window at all — any same-origin browsing context
// can listen on the named channel — so it isn't exposed to that failure
// mode. See CanvaReturn.tsx for the broadcasting half of this.
const CHANNEL_NAME = 'canva-oauth-return';

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

  if (typeof BroadcastChannel === 'undefined') {
    // Very old browser without BroadcastChannel support — window.opener is
    // the best available signal, even though it's the less reliable one.
    function handleMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== 'canva-oauth-complete') return;
      window.removeEventListener('message', handleMessage);
      window.clearInterval(pollClosedFallback);
      if (e.data.connected) onConnected();
      else if (e.data.error) onError?.(e.data.error);
    }
    window.addEventListener('message', handleMessage);
    const pollClosedFallback = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(pollClosedFallback);
        window.removeEventListener('message', handleMessage);
      }
    }, 500);
    return;
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent) => {
    if (!e.data || e.data.type !== 'canva-oauth-complete') return;
    channel.close();
    window.clearInterval(pollClosed);
    if (e.data.connected) onConnected();
    else if (e.data.error) onError?.(e.data.error);
  };

  // The user may just close the popup without finishing — nothing else
  // will ever broadcast in that case, so stop listening rather than leak it.
  const pollClosed = window.setInterval(() => {
    if (popup.closed) {
      window.clearInterval(pollClosed);
      channel.close();
    }
  }, 500);
}

import { useEffect } from 'react';
import { useNavigation } from '../contexts/NavigationContext';
import { Spinner } from '../components/ui/Spinner';

// Landing page for the Canva OAuth callback's redirect. canva-oauth-callback
// (server) never redirects directly to an arbitrary returnUrl — only ever
// to this fixed, same-origin page — avoiding an open-redirect. This page
// re-validates returnUrl's origin client-side before actually navigating
// there (defense in depth), extracts which app "page" to land on (this
// app has no real URL routing — pages are React state — so returnUrl is
// `${origin}/?page=<name>`, not a literal path), and stashes creativeId /
// connected state in sessionStorage for that page to consume (e.g.
// auto-resuming a specific creative's Canva editor instead of leaving the
// user to click "Edit in Canva" again).
const SAFE_DEFAULT_PAGE = 'creatives';

export function CanvaReturn() {
  const { navigate } = useNavigation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected') === '1';
    const errorMsg = params.get('error');
    const rawReturnUrl = params.get('returnUrl');
    const creativeId = params.get('creativeId');

    // If this is the popup opened by openCanvaOAuthPopup, hand the result
    // back to the tab that opened it and close — that tab never left its
    // page, so there's no state to restore there at all. Broadcasting is
    // unconditional and doesn't check window.opener: getting here involved
    // three distinct origins (this app -> canva.com -> this project's own
    // Supabase edge function domain -> this app again), and browsers can
    // sever window.opener across cross-origin hops like that as a security
    // default. BroadcastChannel has no such dependency — any same-origin
    // browsing context can pick it up.
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('canva-oauth-return');
      channel.postMessage({ type: 'canva-oauth-complete', connected, error: errorMsg, creativeId });
      channel.close();
    }
    // window.close() only actually closes a window that was opened by
    // script (our popup case) — on a real tab the user navigated to
    // directly, it's a silent no-op and execution just continues into the
    // same-tab fallback below, which is exactly what should happen there.
    window.close();

    let targetPage = SAFE_DEFAULT_PAGE;
    if (rawReturnUrl) {
      try {
        const parsed = new URL(rawReturnUrl);
        if (parsed.origin === window.location.origin) {
          const page = parsed.searchParams.get('page');
          if (page) targetPage = page;
        }
      } catch { /* invalid returnUrl — fall back to the safe default */ }
    }

    if (connected) sessionStorage.setItem('canva_just_connected', '1');
    if (errorMsg) sessionStorage.setItem('canva_connect_error', errorMsg);
    if (creativeId) sessionStorage.setItem('canva_resume_creative_id', creativeId);

    // Clean the query string before navigating away so a refresh never replays this.
    window.history.replaceState({}, '', window.location.pathname);
    navigate(targetPage);
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

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

    // Opened as a popup (openCanvaOAuthPopup) rather than a same-tab
    // redirect — hand the result back to the tab that opened us via
    // postMessage and close, instead of navigating ourselves. The opener
    // never left its page, so there's no state to restore there at all.
    // (window.opener can be severed by cross-origin COOP policy on Canva's
    // side, outside our control — falls through to the same-tab logic
    // below if so, which still works, just as a second window instead of
    // a handoff.)
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'canva-oauth-complete', connected, error: errorMsg, creativeId },
        window.location.origin
      );
      window.close();
      return;
    }

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

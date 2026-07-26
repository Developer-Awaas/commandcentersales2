import { useEffect } from 'react';
import { useNavigation } from '../contexts/NavigationContext';
import { signalCanvaOAuthComplete } from '../lib/canva-oauth-popup';
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

    // If this is the popup opened by openCanvaOAuthPopup, signal the tab
    // that opened it via localStorage's storage event (not window.opener —
    // Canva sends Cross-Origin-Opener-Policy: same-origin, which severs
    // that reference the moment this popup navigated to Canva's domain,
    // regardless of anything on our side) and close. window.close() only
    // actually closes a window opened by script — on a real tab the user
    // navigated to directly, it's a silent no-op and execution falls
    // through to the same-tab landing logic below, which is what should
    // happen there anyway.
    signalCanvaOAuthComplete({ connected, error: errorMsg ?? undefined });
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

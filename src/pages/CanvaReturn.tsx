import { useEffect, useState } from 'react';
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
  // Set only when this landing IS the popup (returnUrl carries `via=popup`,
  // see openCanvaOAuthPopup callers) AND window.close() didn't actually
  // close it. Renders a minimal "you can close this tab" message instead
  // of the app — never falls through to navigate(targetPage) in that case,
  // which would otherwise show a completely empty Strategy page inside
  // what should have been a disappearing popup (the actual bug reported:
  // the original tab still had everything, but a second window landed on
  // Strategy empty).
  const [stuckPopup, setStuckPopup] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected') === '1';
    const errorMsg = params.get('error');
    const rawReturnUrl = params.get('returnUrl');
    const creativeId = params.get('creativeId');

    let targetPage = SAFE_DEFAULT_PAGE;
    let isPopupReturn = false;
    if (rawReturnUrl) {
      try {
        const parsed = new URL(rawReturnUrl);
        if (parsed.origin === window.location.origin) {
          const page = parsed.searchParams.get('page');
          if (page) targetPage = page;
          isPopupReturn = parsed.searchParams.get('via') === 'popup';
        }
      } catch { /* invalid returnUrl — fall back to the safe default */ }
    }

    // Signal the tab that opened this popup via localStorage's storage
    // event — not window.opener, which Canva's Cross-Origin-Opener-Policy:
    // same-origin header severs the moment this window navigated to
    // Canva's domain, regardless of anything on our side. Harmless no-op
    // if nobody's actually listening (a real same-tab fallback landing).
    signalCanvaOAuthComplete({ connected, error: errorMsg ?? undefined });

    if (isPopupReturn) {
      // Known FOR CERTAIN via the returnUrl marker that this is the popup
      // — not inferred from window.opener or window.close()'s success,
      // both of which can be unreliable here: the same COOP header above
      // can cause a browser to "forget" that this window was originally
      // script-opened by the time it navigates back from Canva's origin,
      // making close() silently do nothing. Never render/navigate to the
      // real app in this window either way, regardless of whether any of
      // these actually succeed.
      window.close();
      // A commonly-used workaround for the same "browser forgot this was
      // script-opened" case above — reassigning the window via
      // open('', '_self') can make some browsers treat the current script
      // as authoritative over closing it. Not guaranteed, but cheap to try
      // before falling back to asking the user to close it manually.
      try { window.open('', '_self'); window.close(); } catch { /* ignore */ }
      setStuckPopup(true);
      return;
    }

    if (connected) sessionStorage.setItem('canva_just_connected', '1');
    if (errorMsg) sessionStorage.setItem('canva_connect_error', errorMsg);
    if (creativeId) sessionStorage.setItem('canva_resume_creative_id', creativeId);

    // Clean the query string before navigating away so a refresh never replays this.
    window.history.replaceState({}, '', window.location.pathname);
    navigate(targetPage);
  }, [navigate]);

  if (stuckPopup) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6">
        <p className="text-sm text-text-tertiary">Connected! You can close this tab and return to the one you started from.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

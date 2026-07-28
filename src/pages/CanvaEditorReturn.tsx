import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { signalCanvaEditorReturn } from '../lib/canva-oauth-popup';
import { Spinner } from '../components/ui/Spinner';

// Landing page for Canva's "Return Navigation" feature — distinct from
// CanvaReturn.tsx (the OAuth connect callback). Once the user clicks
// "Return" inside Canva's editor, Canva navigates that same editor tab to
// this app's single fixed return URL (configured in the Canva Developer
// Portal, not per-request) with a `?correlation_jwt=...` param. Presence of
// that param is itself the only signal needed — a real user could never
// construct this token, and it's short-lived and audience-bound to this
// integration, so landing here always means "this is the editor tab
// returning," never the tab that originally opened it.
export function CanvaEditorReturn() {
  const [status, setStatus] = useState<'verifying' | 'done' | 'error'>('verifying');

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const correlationJwt = params.get('correlation_jwt');
      // Clean the query string immediately so a refresh never replays this.
      window.history.replaceState({}, '', window.location.pathname);

      if (!correlationJwt) {
        signalCanvaEditorReturn(false);
        setStatus('error');
        return;
      }

      // Never trust correlation_jwt unverified — it arrives via a plain
      // redirect with no Authorization header, so its signature must be
      // checked against Canva's own published keys first.
      const { data, error } = await supabase.functions.invoke<{ valid?: boolean; designId?: string; correlationState?: string; error?: string }>(
        'canva-verify-return-nav',
        { body: { correlationJwt } }
      );

      signalCanvaEditorReturn(!error && !!data?.valid);
      setStatus(!error && data?.valid ? 'done' : 'error');

      // Best-effort close, same as CanvaReturn.tsx — a popup's navigation
      // history spans multiple pages here too (blank -> Canva editor ->
      // this return URL), which some browsers restrict window.close() on
      // regardless of anything this app does.
      window.close();
      try { window.open('', '_self'); window.close(); } catch { /* ignore */ }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-center px-6">
      {status === 'verifying' && <Spinner size="lg" />}
      {status === 'done' && (
        <p className="text-sm text-text-tertiary">Done! You can close this tab and return to the one you started from.</p>
      )}
      {status === 'error' && (
        <p className="text-sm text-text-tertiary">Something went wrong verifying that request — you can close this tab.</p>
      )}
    </div>
  );
}

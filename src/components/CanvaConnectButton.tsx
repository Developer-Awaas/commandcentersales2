import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigation } from '../contexts/NavigationContext';
import { openCanvaOAuthPopup } from '../lib/canva-oauth-popup';
import { ExternalLink, Check, Trash2 } from 'lucide-react';
import { Spinner } from './ui/Spinner';

interface CanvaConnectButtonProps {
  userId: string;
  onConnected?: () => void;
}

export function CanvaConnectButton({ userId, onConnected }: CanvaConnectButtonProps) {
  const { activePage } = useNavigation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    checkConnection();

    // Handle OAuth callback result — set by CanvaReturn.tsx after the
    // server-side callback redirects there and validates same-origin; the
    // query string itself is cleaned before we ever get here, so this
    // reads sessionStorage instead of a URL param.
    if (sessionStorage.getItem('canva_just_connected') === '1') {
      sessionStorage.removeItem('canva_just_connected');
      setConnected(true);
      onConnected?.();
    }
  }, [userId]);

  async function checkConnection() {
    const { data } = await supabase
      .from('org_user_integrations')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'canva')
      .maybeSingle();
    setConnected(!!data);
  }

  async function handleConnect() {
    // Open the tab SYNCHRONOUSLY, before any await — window.open() called
    // after an async gap (the canva-connect-init round-trip below) can lose
    // "user activation" in stricter browsers and get silently blocked, even
    // though it was triggered by a real click.
    const pendingTab = window.open('', '_blank');
    // Identity (userId/orgId) is resolved server-side from the caller's own
    // session JWT — canva-connect-init never trusts a client-supplied value.
    // PKCE + the returned nonce-based state are handled entirely server-side
    // too; see _shared/canva-oauth.ts for why.
    setConnecting(true);
    try {
      // This app has no real URL routing — "pages" are React state, and
      // window.location.href never changes between them — so returnUrl is
      // constructed to actually encode which page to land back on. &via=popup
      // is ONLY added when pendingTab actually opened — if it's null (the
      // blank tab itself got blocked), openCanvaOAuthPopup falls back to a
      // real same-window redirect, and that tab must still land on the
      // real app, not get stuck showing "you can close this tab" forever.
      const returnUrl = `${window.location.origin}/?page=${encodeURIComponent(activePage)}${pendingTab ? '&via=popup' : ''}`;
      const { data, error } = await supabase.functions.invoke<{ authUrl?: string; error?: string }>(
        'canva-connect-init',
        { body: { returnUrl } }
      );
      if (error) throw new Error(error.message);
      if (!data?.authUrl) throw new Error(data?.error ?? 'No authUrl returned');
      // Popup, not a same-window redirect — see canva-oauth-popup.ts for why
      // (Canva's OAuth screen can't be iframed at all, and severs
      // window.opener the moment it navigates there, so completion is
      // signalled via localStorage's storage event instead).
      openCanvaOAuthPopup(
        pendingTab,
        data.authUrl,
        () => { setConnecting(false); setConnected(true); onConnected?.(); },
        (msg) => { setConnecting(false); alert(msg); }
      );
    } catch (err: unknown) {
      pendingTab?.close();
      alert(err instanceof Error ? err.message : 'Failed to start Canva connect');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    await supabase
      .from('org_user_integrations')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'canva');
    setConnected(false);
    setDisconnecting(false);
  }

  if (connected === null) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Spinner size="sm" />
        <span className="text-xs text-text-tertiary">Checking Canva…</span>
      </div>
    );
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-medium">
          <Check size={12} />
          Connected to Canva
        </div>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-tertiary text-xs hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
        >
          {disconnecting ? <Spinner size="sm" /> : <Trash2 size={11} />}
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={connecting}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium hover:bg-teal-500/20 transition-all disabled:opacity-40"
    >
      {connecting ? <Spinner size="sm" /> : <ExternalLink size={14} />}
      {connecting ? 'Connecting…' : 'Connect Canva'}
    </button>
  );
}

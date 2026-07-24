import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ExternalLink, Check, Trash2 } from 'lucide-react';
import { Spinner } from './ui/Spinner';

interface CanvaConnectButtonProps {
  userId: string;
  onConnected?: () => void;
}

export function CanvaConnectButton({ userId, onConnected }: CanvaConnectButtonProps) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    checkConnection();

    // Handle OAuth callback result
    const params = new URLSearchParams(window.location.search);
    if (params.get('canva_connected') === '1') {
      setConnected(true);
      onConnected?.();
      // Remove the query param without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('canva_connected');
      window.history.replaceState({}, '', url.toString());
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
    // Identity (userId/orgId) is resolved server-side from the caller's own
    // session JWT — canva-connect-init never trusts a client-supplied value.
    // PKCE + the returned nonce-based state are handled entirely server-side
    // too; see _shared/canva-oauth.ts for why.
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ authUrl?: string; error?: string }>(
        'canva-connect-init',
        { body: { returnUrl: window.location.href } }
      );
      if (error) throw new Error(error.message);
      if (!data?.authUrl) throw new Error(data?.error ?? 'No authUrl returned');
      window.location.href = data.authUrl;
    } catch (err: unknown) {
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

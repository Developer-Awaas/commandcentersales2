import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';

type FreshnessState = 'live' | 'stale' | 'offline' | 'loading';

interface MetricsFreshnessBadgeProps {
  orgId?: string;
}

function timeAgoMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

export function MetricsFreshnessBadge({ orgId }: MetricsFreshnessBadgeProps) {
  const resolvedOrgId = orgId ?? getOrgId();
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [state, setState] = useState<FreshnessState>('loading');

  function computeState(at: string | null): FreshnessState {
    if (!at) return 'offline';
    const mins = timeAgoMinutes(at);
    if (mins < 20) return 'live';
    if (mins < 240) return 'stale';
    return 'offline';
  }

  useEffect(() => {
    async function fetchLatest() {
      const { data } = await supabase
        .from('campaign_metrics')
        .select('synced_at')
        .eq('org_id', resolvedOrgId)
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const at = (data as { synced_at: string } | null)?.synced_at ?? null;
      setSyncedAt(at);
      setState(computeState(at));
    }
    fetchLatest();

    // Realtime subscription
    const channel = supabase
      .channel(`metrics-freshness-${resolvedOrgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_metrics', filter: `org_id=eq.${resolvedOrgId}` },
        (payload) => {
          const at = (payload.new as { synced_at?: string })?.synced_at ?? null;
          if (at) {
            setSyncedAt(at);
            setState(computeState(at));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [resolvedOrgId]);

  // Recompute freshness label every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setState(computeState(syncedAt));
    }, 60000);
    return () => clearInterval(interval);
  }, [syncedAt]);

  if (state === 'loading') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface text-[10px] text-text-tertiary">
        <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-pulse" />
        Checking…
      </div>
    );
  }

  if (state === 'live') {
    const mins = syncedAt ? timeAgoMinutes(syncedAt) : 0;
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Live · {mins === 0 ? 'just now' : `${mins}m ago`}
      </div>
    );
  }

  if (state === 'stale') {
    const mins = syncedAt ? timeAgoMinutes(syncedAt) : 0;
    const hrs = Math.floor(mins / 60);
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Stale · {hrs > 0 ? `${hrs}hr ago` : `${mins}m ago`}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface text-[10px] text-text-tertiary">
      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
      Screenshot fallback
    </div>
  );
}

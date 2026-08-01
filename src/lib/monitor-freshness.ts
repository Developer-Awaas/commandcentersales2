// CC-P4 Step 3/7 — pure staleness logic for the Performance Monitor, extracted
// so the auto-sync decision is unit-testable (no React/Supabase).

export function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

// Auto-sync fires when the org is connected AND there's nothing fresh to show:
// zero rows, or the last sync is older than staleMinutes (or never synced).
// Not connected -> never auto-sync (the empty-state connect CTA shows instead).
export function shouldAutoSync(input: {
  connected: boolean;
  lastSyncAt: string | null;
  hasRows: boolean;
  staleMinutes: number;
}): boolean {
  if (!input.connected) return false;
  const mins = minutesSince(input.lastSyncAt);
  const stale = mins === null || mins > input.staleMinutes;
  return !input.hasRows || stale;
}

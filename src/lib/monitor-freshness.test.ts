import { describe, it, expect } from 'vitest';
import { minutesSince, shouldAutoSync } from './monitor-freshness';

describe('minutesSince', () => {
  it('null for a null timestamp', () => {
    expect(minutesSince(null)).toBeNull();
  });
  it('~N minutes for a timestamp N minutes ago', () => {
    const iso = new Date(Date.now() - 90 * 60000).toISOString();
    expect(minutesSince(iso)).toBe(90);
  });
});

describe('shouldAutoSync', () => {
  it('never syncs when not connected (connect CTA shows instead)', () => {
    expect(shouldAutoSync({ connected: false, lastSyncAt: null, hasRows: false, staleMinutes: 60 })).toBe(false);
  });
  it('syncs when connected with zero rows', () => {
    const fresh = new Date().toISOString();
    expect(shouldAutoSync({ connected: true, lastSyncAt: fresh, hasRows: false, staleMinutes: 60 })).toBe(true);
  });
  it('syncs when connected and last sync is stale (> staleMinutes)', () => {
    const old = new Date(Date.now() - 120 * 60000).toISOString();
    expect(shouldAutoSync({ connected: true, lastSyncAt: old, hasRows: true, staleMinutes: 60 })).toBe(true);
  });
  it('syncs when connected and never synced', () => {
    expect(shouldAutoSync({ connected: true, lastSyncAt: null, hasRows: true, staleMinutes: 60 })).toBe(true);
  });
  it('does NOT sync when connected, fresh, and has rows', () => {
    const fresh = new Date(Date.now() - 5 * 60000).toISOString();
    expect(shouldAutoSync({ connected: true, lastSyncAt: fresh, hasRows: true, staleMinutes: 60 })).toBe(false);
  });
});

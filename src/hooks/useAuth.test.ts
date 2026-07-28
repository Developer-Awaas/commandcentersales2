import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Regression coverage for the bug documented in CLAUDE.md "Known-Fixed Bugs" #32:
// fetchOrCreateProfile() used to call supabase.auth.signOut() on ANY thrown
// error, including transient failures during Supabase's silent background
// TOKEN_REFRESHED re-check. That silently killed valid sessions and surfaced
// to users as a spurious "Session expired" error every ~50-60 minutes.
//
// These tests pin the contract: signOut() may ONLY be triggered by a
// genuinely confirmed "no org_id" (unprovisioned account) result — never by
// a transient/network failure on the profile lookup itself.

const mocks = vi.hoisted(() => {
  return {
    maybeSingleMock: vi.fn(),
    signOutMock: vi.fn().mockResolvedValue({ error: null }),
    fakeSession: {
      access_token: 'tok',
      user: { id: 'user-1', email: 'a@b.com', user_metadata: {} },
    },
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: mocks.fakeSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: mocks.signOutMock,
    },
    from: vi.fn((table: string) => {
      if (table !== 'profiles') throw new Error(`Unexpected table in test mock: ${table}`);
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: mocks.maybeSingleMock }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ maybeSingle: vi.fn() }),
        }),
      };
    }),
  },
}));

vi.mock('../lib/constants', () => ({
  setStoredOrgId: vi.fn(),
  clearStoredOrgId: vi.fn(),
}));

vi.mock('../lib/ai-service', () => ({
  setUserEmail: vi.fn(),
}));

import { useAuth } from './useAuth';

describe('useAuth fetchOrCreateProfile', () => {
  beforeEach(() => {
    mocks.maybeSingleMock.mockReset();
    mocks.signOutMock.mockClear();
    mocks.signOutMock.mockResolvedValue({ error: null });
  });

  it('does NOT sign out when the profile SELECT throws transiently', async () => {
    mocks.maybeSingleMock.mockRejectedValue(new Error('network blip'));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.signOutMock).not.toHaveBeenCalled();
  });

  it('signs out when the profile exists but has no org_id (genuinely unprovisioned)', async () => {
    mocks.maybeSingleMock.mockResolvedValue({ data: { id: 'user-1', org_id: null }, error: null });

    renderHook(() => useAuth());

    await waitFor(() => expect(mocks.signOutMock).toHaveBeenCalledTimes(1));
  });

  it('does NOT sign out when the profile exists with a valid org_id', async () => {
    mocks.maybeSingleMock.mockResolvedValue({ data: { id: 'user-1', org_id: 'org-1' }, error: null });

    renderHook(() => useAuth());

    await waitFor(() => expect(mocks.maybeSingleMock).toHaveBeenCalled());
    expect(mocks.signOutMock).not.toHaveBeenCalled();
  });
});

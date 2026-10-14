import { describe, it, expect } from 'vitest';
import { authView } from './access';

const base = { loading: false, hasSession: true, hasProfile: false, error: null as string | null };

describe('authView', () => {
  it('spins while the initial session check runs', () => {
    expect(authView({ ...base, loading: true, hasSession: false })).toBe('spinner');
  });
  it('shows login with no session', () => {
    expect(authView({ ...base, hasSession: false })).toBe('login');
  });
  it('spins (never AccessDenied) in the post-sign-in window: session set, profile not yet', () => {
    expect(authView(base)).toBe('spinner');
  });
  it('shows the error instead of spinning forever when the profile load failed', () => {
    expect(authView({ ...base, error: 'Could not load your profile. Please try again.' })).toBe('profile-error');
  });
  it('renders the app once the profile is loaded', () => {
    expect(authView({ ...base, hasProfile: true })).toBe('app');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

// T-026: fetchOrCreateProfile (this file) previously ran a blind `catch {
// signOut() }` around the profile lookup/create — any transient failure
// (network, RLS, timeout) triggered a global sign-out on a shared/reviewer
// account (T-023's exact mechanism, but reachable on every auth-state tick,
// not just a failed generation). Fixed to: never sign out on an unconfirmed
// failure, and always use scope 'local' when it does sign out.
vi.mock('../lib/ai-service', () => ({ setUserEmail: vi.fn() }));

function makeQueryBuilder() {
  const builder: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.insert.mockReturnValue(builder);
  return builder;
}

const signOutMock = vi.fn().mockResolvedValue({ error: null });
const queryBuilder = makeQueryBuilder();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: (...args: unknown[]) => signOutMock(...args),
      signInWithPassword: vi.fn(),
    },
    from: vi.fn(() => queryBuilder),
  },
}));

const mockUser = { id: 'user-1', email: 'reviewer@awaas.internal', user_metadata: {} };

describe('useAuth — fetchOrCreateProfile signOut safety (T-026)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryBuilder.select.mockReturnValue(queryBuilder);
    queryBuilder.eq.mockReturnValue(queryBuilder);
    queryBuilder.insert.mockReturnValue(queryBuilder);
    signOutMock.mockResolvedValue({ error: null });
  });

  it('does NOT sign out on a transient failure (profile lookup throws)', async () => {
    const { supabase } = await import('../lib/supabase');
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: { user: mockUser } },
    });
    queryBuilder.maybeSingle.mockRejectedValueOnce(new Error('network blip'));

    const { useAuth } = await import('./useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(signOutMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Could not load your profile. Please try again.');
    expect(result.current.session).not.toBeNull();
  });

  it('DOES sign out, with scope "local", on a confirmed unprovisioned profile', async () => {
    const { supabase } = await import('../lib/supabase');
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: { user: mockUser } },
    });
    queryBuilder.maybeSingle.mockResolvedValueOnce({ data: { id: mockUser.id, org_id: null }, error: null });

    const { useAuth } = await import('./useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(signOutMock).toHaveBeenCalled());

    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
    expect(result.current.error).toBe('Account not fully provisioned — please contact admin.');
  });
});

describe('every supabase.auth.signOut( call site in src/ (T-026 guard)', () => {
  it('passes { scope: \'local\' } — never bare, never scope: \'global\'', () => {
    const srcDir = path.resolve(__dirname, '..');
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;

        const text = fs.readFileSync(full, 'utf8');
        const re = /\.auth\.signOut\(/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const afterCall = text.slice(m.index + m[0].length);
          const closeIdx = afterCall.indexOf(')');
          const args = closeIdx === -1 ? afterCall : afterCall.slice(0, closeIdx);
          if (!/scope\s*:\s*['"]local['"]/.test(args)) {
            offenders.push(`${path.relative(srcDir, full)}: ${JSON.stringify(args.trim())}`);
          }
        }
      }
    }
    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});

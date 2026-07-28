---
name: superpowers
description: Engineering discipline skill — enforces "build each unit, test each failure path, then confirm success" before any task is declared done. Use this at the START of any non-trivial task (new hook, new Edge Function, new auth path, new catch block) to set up the test contract FIRST, then implement against it. Trigger on "build a new X", "implement Y", "add Z to the auth flow."
---

# Superpowers — Test-Driven Build Discipline

This skill exists because most bugs that cost multiple debugging sessions share a root cause: **untested failure paths in code that runs silently in the background.** The fix is to pin the contract in a test *before* or *alongside* the implementation — not after the symptom is reported.

---

## The discipline: 3 steps before "done"

### Step 1 — Identify the failure modes, not just the happy path

Before writing any code, ask:

- What happens if the **network blips** mid-operation?
- What happens if the **DB returns nothing** (RLS blocks silently, not an error)?
- What happens if this code **runs again on a background timer** (auth state change, pg_cron, Realtime subscription) while an earlier invocation is still in flight?
- Does this code have a **catch block with a side effect** (signOut, navigate, delete, state clear)? If yes: is the side effect only triggered for the *genuine* failure case, not any failure?

Write those scenarios down. They become the test cases.

### Step 2 — Write the test first (or alongside)

**Client-side hooks / components** (Vitest + React Testing Library):

```bash
# Run tests once
npm test

# Watch mode (fast re-run on save)
npm run test:watch
```

Test file location: colocate with the source — `src/hooks/useMyHook.test.ts` next to `useMyHook.ts`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock supabase at the module boundary — vi.hoisted for mocks referenced in factory
const mocks = vi.hoisted(() => ({ myMock: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { ... } }));

describe('useMyHook', () => {
  it('does NOT [destructive action] when [failure condition]', async () => {
    mocks.myMock.mockRejectedValue(new Error('transient'));
    const { result } = renderHook(() => useMyHook());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.destructiveSideEffectMock).not.toHaveBeenCalled();
  });
});
```

**Edge Functions** (Deno test):

File: `supabase/functions/_shared/agents/myAgent_test.ts`

```typescript
import { describe, it } from 'jsr:@std/testing/bdd';
import { assertEquals } from 'jsr:@std/assert';

// Credential-free by default — gate live calls with ignore: !Deno.env.get('ANTHROPIC_API_KEY')
Deno.test('does not throw on empty input', () => { ... });
```

```bash
deno test --allow-env supabase/functions/_shared/agents/
```

### Step 3 — Run ALL gates before declaring done

```bash
# 1. Unit tests (behavior)
npm test

# 2. TypeScript (structure)
npm run typecheck

# 3. Build (bundler)
npm run build
```

All three must pass. TypeScript passing alone is NOT done. Build passing alone is NOT done. Tests passing alone is NOT done. All three.

If there are Edge Function changes, also:
```bash
deno check supabase/functions/<changed-function>/index.ts
deno test --allow-env supabase/functions/_shared/agents/
```

---

## High-risk patterns that always need a test

These patterns have burned this project before and must always have a paired test:

| Pattern | Required test |
|---|---|
| `catch { sideEffect() }` where sideEffect is destructive | Test that transient/unexpected error does NOT trigger sideEffect |
| Function that runs on `onAuthStateChange` or any recurring event | Test rejection of any async call inside it — confirm state is preserved, not cleared |
| Supabase query that could return 0 rows (RLS silent block) | Test `data: null` path — confirm UI shows correct empty state, not crash |
| Any new Edge Function handling | Test the error response shape — confirm client gets a usable error message, not a stack trace |
| Any new `signOut()` call | Test that it only fires for the specific case it's designed for, not as a catch-all |

---

## Quick reference: what each gate catches

| Gate | Catches |
|---|---|
| `npm test` | Logic bugs — wrong behavior in success AND failure paths |
| `npm run typecheck` | Structural bugs — wrong types, missing fields, incompatible APIs |
| `npm run build` | Bundler issues — circular deps, missing exports, asset errors |
| `deno check` | Edge function type errors — Deno-specific TS issues |
| `deno test` | Edge function logic — unit behavior of specialists |
| `/code-review` | Dangerous patterns — catch-alls, RLS gaps, secret exposure |

None of these substitutes for the others. All six run on every push via CI.

---

## Adding a new client-side test file

1. Create `src/<path>/myThing.test.ts` — vitest auto-discovers all `*.test.ts` under `src/`.
2. Import from `'vitest'` explicitly (no globals) — `import { describe, it, expect, vi } from 'vitest'`.
3. Mock at module boundaries using `vi.hoisted` + `vi.mock` for anything that calls Supabase, the DOM, or external APIs.
4. `npm test` — confirm it passes.
5. If the test covers a regression (a bug you just fixed): add a comment in the test explaining what broke and what the test enforces. Future you will thank present you.

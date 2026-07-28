---
name: code-review
description: Use this skill to audit any diff or set of changed files BEFORE declaring a task done. Catches dangerous patterns (catch-all signOut, swallowed auth errors, missing tests on new failure paths, RLS gaps, destructive side-effects in catch blocks) that TypeScript alone cannot catch. Trigger when finishing any change that touches auth, payments, DB writes, or external API calls — or any time the user says "review this" or "is this safe?"
---

# Code Review — Command Center V2

Run this before finishing any non-trivial task. The goal is catching **logic bugs that pass the type-checker** — the class of bug that burned multiple sessions (see CLAUDE.md Known-Fixed Bugs).

## How to invoke

```
/code-review
```

Then provide the diff, file list, or describe what changed. The review runs as a checklist — call out every concern with file:line, severity, and a one-line fix suggestion.

---

## Checklist

### 1. Catch-block audit (HIGH — the class that caused bug #32)

For every `catch` block in the diff:

- [ ] Does the catch call a **destructive action** (`signOut()`, `delete`, `reset`, navigate-to-login, `DROP`, `clear`)? If yes: is that destruction *only* triggered when the error is **definitively** the right cause (e.g. explicit `if (!org_id)`, not just "something threw")? **A generic `catch { destructiveAction() }` is always wrong.**
- [ ] Does the catch **swallow the error without logging**? Empty `catch {}` on any code path that touches auth, money, or DB writes must at least `console.error` the original error so there is evidence in the browser console when it fires.
- [ ] Does the catch sit around a function that **runs on a background timer or recurring event** (`onAuthStateChange`, `setInterval`, pg_cron callback)? Background-recurring catch-alls are the highest-risk pattern — one transient failure poisons every subsequent invocation.

### 2. Auth & session

- [ ] Does any new code call `supabase.auth.signOut()` from a catch block or error handler? Check whether the error is genuinely "session invalid" vs "something else failed while the session was fine."
- [ ] Is every Edge Function call going through `invokeEdgeFn()` (not raw `supabase.functions.invoke()`)? `invokeEdgeFn` explicitly injects the Authorization header; raw invoke uses the anon key only.
- [ ] Is there a new `assertSession()` or pre-flight session check added before an edge-function call? Remove it — `invokeEdgeFn` handles this; double-checks create failure modes (the pre-flight's race window can fail even when the actual call would succeed).

### 3. RLS & data isolation

- [ ] Any new `supabase.from(...)` query — does it scope by `org_id` or does it rely on RLS automatically? If relying on RLS, confirm the table has an org-scoped policy (see CLAUDE.md Key Tables). Client-side queries that would silently return nothing (no RLS error, just 0 rows) on a missing policy are invisible bugs.
- [ ] Any new server-side query using the service role? Service role bypasses RLS — confirm the query has explicit `org_id` filter.

### 4. Error surfacing (never silent)

- [ ] Does every new user-triggerable flow surface errors back to the UI? Errors must not disappear into `console.log` only. Use the existing error state pattern (set `error` string, show in red) or throw so the caller can surface it.
- [ ] Does any new `generate-image` / `claude-proxy` / `aarav-orchestrate` call handle `data?.error` (Anthropic-level error inside a 200 OK response) separately from `error` (network/4xx/5xx from Supabase functions layer)? Both must be checked.

### 5. Tests

- [ ] Is there a new function with a `catch` block that has a non-trivial side effect? → **A unit test is required pinning that the side effect does NOT fire on a transient error.** Add it before marking the task done.
- [ ] Is there a new Supabase query in a hook that runs on mount or on a recurring event? → **A unit test with a mocked rejection is required** (renders the hook, verifies no sign-out / no navigation / no data corruption on fetch failure).
- [ ] Edge function: any new logic branch that's not covered by the existing `*_test.ts` files? Add a credential-free test (mock the LLM/DB response) for the new branch.

### 6. Secrets

- [ ] No `VITE_ANTHROPIC_API_KEY`, `VITE_OPENAI_API_KEY`, or any `sk-` / `eyJ` value in the diff. All keys stay in Edge Function Deno.env or Supabase secrets.
- [ ] No API key concatenated into a URL string or printed to console.

### 7. DB / migrations

- [ ] Any new migration — does it ADD only (no column drops, no type changes on existing data)? Per CLAUDE.md rules: never modify existing tables destructively.
- [ ] Any new `CHECK` constraint or enum extension — does the corresponding `database.types.ts` hand-written file get updated? (CI `deno check` will catch a type mismatch, but the review should call it out proactively.)

---

## Severity tiers

| Tier | Meaning |
|---|---|
| **BLOCK** | Do not ship until fixed — data loss, auth bypass, secret exposure, or silent sign-out on transient error |
| **HIGH** | Fix before this PR merges — missing test for a catch with side effects, missing RLS scope, unhandled auth error path |
| **MED** | Fix in a follow-up before the next session — swallowed error with no log, no explicit `data?.error` check |
| **LOW** | Nice-to-have — explicit `traceName` on a Langfuse call, more test coverage on a happy path |

---

## What this skill does NOT replace

- `npm run typecheck` — run it; TypeScript catches structural errors this checklist misses.
- `npm test` — run it; unit tests confirm behavior, this checklist only identifies gaps.
- Deno type-check on Edge Functions — run it after any edge function change.

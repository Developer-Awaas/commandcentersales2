# WS1.6 isolation harness — Command Center

Cross-tenant RLS probes, primarily targeting `agent_memory_chunks` (the
table WS1.6 was opened against), plus `profiles` since chunk isolation is
meaningless if org membership itself can be read or tampered cross-org.
Also covers the service-role write path in `handleApprove` (`aarav-orchestrate`),
which bypasses RLS by design and can't be tested by a JWT-based probe alone.

Modeled on `awaas-suite`'s Gate P (`supabase/tests/isolation/` there) — same
probe function *shapes* (`crossOrgReadDenied`/`crossOrgWriteDenied`/etc. in
`lib.ts`), but a separate implementation, not a shared import. Two different
repos, two different Supabase projects; "generalized" means the pattern is
reusable, not that the code is literally shared.

## ⚠️ Runs against production — there is no separate TEST project

Command Center has one linked Supabase project: `CommandCentre_Prod`
(`mpvdpdxzqnidwyihyhbn`). Decided 2026-07-21 to run the harness against it
directly rather than standing up a second project, with these safeguards:

- Every row created is identifiably prefixed (`isolation-probe-org-a`/`-b`
  as org names; probe user emails end in `@commandcentersales2.test`).
- `seed-isolation-probes.sh` is idempotent — safe to re-run.
- `cleanup-isolation-probes.sh` removes everything the seed script creates.
  CI runs it via `if: always()` so a failing probe never strands data;
  running it locally after a manual run is on you.
- No production org/user data is ever touched — every probe operates only
  on rows this suite itself seeded.

## Running

```
export REST_BASE=... ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
export PROBE_ORG_A_EMAIL=... PROBE_ORG_A_PASSWORD=...
export PROBE_ORG_B_EMAIL=... PROBE_ORG_B_PASSWORD=...
./supabase/tests/isolation/seed-isolation-probes.sh
deno test --allow-net --allow-env --allow-read --lock=supabase/functions/deno.lock \
  supabase/tests/isolation/isolation_test.ts
./supabase/tests/isolation/cleanup-isolation-probes.sh   # optional, run when done
```

Or copy `.env.isolation.local` (gitignored, template committed) and source it
— see that file for exactly where each credential comes from.

## The 9 tests (8 probes + 1 static check)

Unlike Gate P, Command Center has no `assign_role`/`provision_org` RPCs, so
probe 6 substitutes the real equivalent for this schema.

1. **Cross-org read** — org A cannot read org B's `agent_memory_chunks` rows.
2. **Cross-org write** — org A cannot insert a chunk spoofing org B's `org_id`.
3. **Cross-org update** — org A cannot modify org B's chunk.
4. **Cross-org delete** — org A cannot delete org B's chunk.
5. **Cross-org read (profiles)** — org A cannot read org B's `profiles` row.
6. **Self-escalation** — org A's probe user cannot change their own `role`
   or `org_id` via direct UPDATE (`prevent_self_privilege_escalation()`
   trigger). Verified two ways: the UPDATE response, and a fresh re-read of
   the row afterward — don't just trust a 200 with an empty body.
7. **Service-role tenancy check** — calls the live `aarav-orchestrate` with
   `action:'approve'` as org A against org B's `agent_turns.id`; asserts the
   HTTP-level rejection (404) *and* that org B's turn is unchanged afterward.
   Tests `handleApprove`'s manual `org_id` re-filter on the service-role
   client — the one path a pure-RLS probe can't reach.
8. **`match_memory_chunks` RPC** — org A's call never returns org B's
   seeded (embedded) chunk content, regardless of query.
8b. **Static check** — greps every migration's `match_memory_chunks`
    definition and fails if any ever specifies `SECURITY DEFINER` instead of
    `INVOKER`. Genuinely offline: reads `supabase/migrations/*.sql` directly,
    no network call, no trusting a code comment.

## Not covered yet

Scope documentation, not a claim of full coverage. 36 tables have RLS enabled
across this schema (verified via `grep 'ENABLE ROW LEVEL SECURITY'` across
`supabase/migrations/*.sql` — see `CLAUDE.md` → "Key Tables" for the current
list). Only `agent_memory_chunks`, `profiles`, and `agent_turns` (via probe 7)
are probed here. Extending to other org-scoped tables is straightforward with
the existing `lib.ts` helpers — the harder cases are tables scoped via a join
rather than a direct column, tables scoped by `user_id` instead of `org_id`
(`notifications`, `org_user_integrations`), and tables with no `authenticated`
write path to seed through legitimately.

## CI wiring

Wired into `.github/workflows/typecheck.yml` as `ws1-6-isolation` — job-level
secrets only (`REST_BASE`, `ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`PROBE_ORG_A/B_EMAIL/PASSWORD`), never promoted to workflow-level `env:`, so
the other jobs never see the service-role key. Runs on every push/PR to
`main`. First green CI run: [`29828405683`](https://github.com/Developer-Awaas/commandcentersales2/actions/runs/29828405683).

# WS1.6 isolation harness — Command Center

Cross-tenant RLS probes, primarily targeting `agent_memory_chunks` (the
table WS1.6 was opened against), plus `profiles` since chunk isolation is
meaningless if org membership itself can be read or tampered cross-org.

Modeled on awaas-suite's Gate P (`supabase/tests/isolation/` there) — same
probe function *shapes* (`crossOrgReadDenied`/`crossOrgWriteDenied`/etc. in
`lib.ts`), but a separate implementation, not a shared import. These are two
different repos against two different Supabase projects; "generalized"
means the pattern is reusable, not that the code is literally shared.

## ⚠️ Runs against production — there is no separate TEST project

Command Center has one linked Supabase project: `CommandCentre_Prod`
(`mpvdpdxzqnidwyihyhbn`). Decided 2026-07-21 to run the harness against it
directly rather than standing up a second project, with these safeguards:

- Every row created is identifiably prefixed (`isolation-probe-org-a`/`-b`
  as org names; probe user emails end in `@commandcentersales2.test`).
- `seed-isolation-probes.sh` is idempotent — safe to re-run.
- `cleanup-isolation-probes.sh` removes everything the seed script creates.
  Not run automatically; run it manually after a local run, or on a schedule
  if this becomes a recurring CI job.
- No production org/user data is ever touched — every probe operates only
  on rows this suite itself seeded.

## Running

```
export REST_BASE=... ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
export PROBE_ORG_A_EMAIL=... PROBE_ORG_A_PASSWORD=...
export PROBE_ORG_B_EMAIL=... PROBE_ORG_B_PASSWORD=...
./supabase/tests/isolation/seed-isolation-probes.sh
deno test --allow-net --allow-env supabase/tests/isolation/isolation_test.ts
./supabase/tests/isolation/cleanup-isolation-probes.sh   # optional, run when done
```

Or copy `.env.isolation.local` (gitignored) and `export $(cat ...)` it —
see that file for exactly where each credential comes from.

## The 6 probes

Unlike Gate P, Command Center has no `assign_role`/`provision_org` RPCs, so
there's no direct equivalent for those probes. Instead:

1. **Cross-org read** — org A cannot read org B's `agent_memory_chunks` rows.
2. **Cross-org write** — org A cannot insert a chunk spoofing org B's `org_id`.
3. **Cross-org update** — org A cannot modify org B's chunk.
4. **Cross-org delete** — org A cannot delete org B's chunk.
5. **Cross-org read (profiles)** — org A cannot read org B's `profiles` row.
6. **Self-escalation** — org A's probe user cannot change their own `role`
   or `org_id` via direct UPDATE (`prevent_self_privilege_escalation()`
   trigger, `20260610150000_fix_rls_org_scope.sql`) — the Command-Center
   equivalent of Gate P's `org_members` self-escalation probe. Verified two
   ways: the UPDATE response itself, and a fresh re-read of the row
   afterward (belt-and-suspenders — don't just trust a 200 with an empty
   body, confirm nothing actually changed).

## Not covered yet

Same spirit as awaas-suite's README: this is scope documentation, not a
claim of full coverage. 36 tables have RLS enabled across this schema (see
`COMMAND_CENTER_STATUS.md` at the repo root for the full list, cross-checked
against migrations directly). Only `agent_memory_chunks` and `profiles` are
probed here. Extending to other org-scoped tables (`projects`, `campaigns`,
`creative_assets`, etc.) is straightforward with the existing `lib.ts`
helpers — the harder cases are the same three shapes awaas-suite's README
calls out: tables scoped via a join rather than a direct column, tables
scoped by `user_id` instead of `org_id` (`notifications`,
`org_user_integrations`), and tables with no `authenticated` write path to
seed through legitimately.

## CI wiring — deliberately not done yet

Not wired into `.github/workflows/typecheck.yml`. Adding a job that reads
`secrets.SUPABASE_SERVICE_ROLE_KEY` etc. before those secrets exist in the
repo would fail on every push and break CI for everyone. Wire it in once the
GitHub repo secrets are actually set (see the chat message that shipped this
harness for the exact names) — mirror `isolation-tests` in awaas-suite's
`.github/workflows/ci.yml`, but there's no `db-lint`/local-Supabase step to
depend on here since this always targets the one hosted project.

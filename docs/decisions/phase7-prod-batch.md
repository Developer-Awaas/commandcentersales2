# Phase 7 — PROD batch

The single ordered list of everything PROD (`mpvdpdxzqnidwyihyhbn`) needs when
`review-build` work merges. Apply in the order written. **Every future
PROD-affecting item is appended here** — nowhere else.

CC PROD is a frozen source-of-truth baseline with no traffic, so nothing below
is exploitable today. It still ships in this batch, in this order.

**Entry gate** (`docs/closeout-inventory.md`, merge-readiness): (a) Meta
submission ID logged, (b) Phases 3–5 closed, (c) internal reviewer sign-off,
(d) e2e green on `review-build`. No step below runs before all four hold.

---

## 0. Pre-flight

| # | Item | Kind | Detail |
|---|---|---|---|
| 0.1 | **SEC-01** | manual | Rotate the PROD `service_role` key and DB password. The pasted values were invalidated on 2026-09-16; confirm both are rotated. Re-seed the repo-level GitHub secrets that use them (`ws1-6-isolation`'s `SUPABASE_SERVICE_ROLE_KEY`, plus any other secret holding the old values). Then confirm a `main` CI run is fully green. |
| 0.2 | Read-only role | manual | Create the PROD read-only role (`docs/runbooks/db-access.md`). It does not exist yet; 0.3 and 0.4 depend on it. |
| 0.3 | **Schema baseline dump** | manual, read-only | `pg_dump --schema-only` through the read-only role. Still required: every Phase 2 count so far is TEST-only. |
| 0.4 | Pre-flight counts | manual, read-only | Re-run the gate-doc checks on PROD: `meta_ad_account_id !~ '^act_\d+$'` in `org_integrations` and `projects`; `image_jobs` status values; `published_assets` rows with neither provenance column, split by `published`; `#`-prefixed tags in `smm_calendar`. Also diff `supabase_migrations.schema_migrations` against `supabase/migrations/` — PROD may be missing earlier files (P1-CM-16 hypothesis: `20260814120000`). |

## 1. Migrations (timestamp order)

| # | File | Item | Note |
|---|---|---|---|
| 1.1 | `supabase/migrations/20260909120000_t5m_surface_partition.sql` | T-5M, A3 (NOT VALID), D2b | Rewrites `#`-prefixed `smm_calendar` tags; the backfill cannot be undone. |
| 1.2 | `supabase/migrations/20260909120500_a3_validate.sql` | A3 | Fails if 0.4 found `act_` violators — fix those rows first. |
| 1.3 | `supabase/migrations/20260909121000_new2_image_jobs.sql` | NEW-2, T-006a schema | Only widens the status vocabulary; `'done'` is kept. |
| 1.4 | `supabase/migrations/20260909122000_r1_review_schema.sql` | R1, NEW-3 | Creates `integration_health` and `cron_run_log`. |
| 1.5 | `supabase/migrations/20260909123000_new4_publish_idempotency.sql` | NEW-4 schema | |
| 1.6 | `supabase/migrations/20260916120000_fix_creative_assets_rls.sql` | **T-008** | |
| 1.7 | `supabase/migrations/20260916121000_r1_cleanup.sql` | duplicate policy, **R-02** | R-02 deletes only never-published orphans, then VALIDATEs. **If PROD holds a published orphan, this file FAILS instead of deleting it. That is intended**: stop, and decide what to do with that row by hand. |
| 1.8 | `supabase/migrations/20260917120000_t010_org_user_integrations_rls.sql` | **T-010** 1/3 | |
| 1.9 | `supabase/migrations/20260917121000_t010_awaas_data_pool_rls.sql` | **T-010** 2/3 | |
| 1.10 | `supabase/migrations/20260917122000_t010_chatbot_log_rls.sql` | **T-010** 3/3 | |

DOWN files for all ten are in `supabase/rollbacks/`. They are applied only by
hand. The T-008 and T-010 DOWN files reopen the holes.

## 2. Post-apply verification

| # | Item | Detail |
|---|---|---|
| 2.1 | Constraint probes | `docs/decisions/phase2-schema-gate.md` probes, each inside `BEGIN…ROLLBACK`, scoped to ZZ-INTERNAL-TEST (`983c7c08-ffaf-402b-981a-a9cd22615cae`). |
| 2.2 | RLS audit | `pg_policies` where `qual = 'true'`, `with_check = 'true'`, or roles include `anon` → expect 0 rows. |
| 2.3 | Types | `supabase/functions/_shared/database.types.ts` already matches these files; spot-check it against PROD. |

## 3. Tooling and follow-ups

| # | Item | Detail |
|---|---|---|
| 3.1 | **R-01** | `scripts/seed-internal-test-org.ts` refuses any URL without the PROD ref, so it cannot seed TEST. Make the target an explicit per-environment input. |

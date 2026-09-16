# Phase 2 schema gate

Three drafted migrations (five after the 2026-09-16 revision). **Applied to TEST 2026-09-16; not PROD** — see the inventory session state. Every count below is from CC-TEST
(`yelmuykbqdyeikgbmkoq`) on 2026-09-09. PROD counts are missing — see the last
section.

Apply order is timestamp order and matters: `20260909122000` ALTERs
`project_creative_guidelines`, which `20260909120000` creates.

---

## 20260909120000 — T5-M surface partition, A3, D2b

| Table | Change |
|---|---|
| `aanya_training_creatives` | ADD `surface` NOT NULL DEFAULT `'leadgen'` + CHECK |
| `project_creative_guidelines` | CREATE (absent on TEST) + RLS full CRUD |
| `curation_log` | CREATE (absent on TEST) + RLS full CRUD |
| `org_integrations` | ADD `act_` format CHECK on `meta_ad_account_id` |
| `projects` | ADD `act_` format CHECK on `meta_ad_account_id` |
| `smm_calendar` | BEFORE INSERT/UPDATE hashtag-normalising trigger + one-time backfill |

**Pre-flight counts**

| Check | Violating rows | Verdict |
|---|---|---|
| `org_integrations.meta_ad_account_id !~ '^act_\d+$'` | **0** | safe to add VALID |
| `projects.meta_ad_account_id !~ '^act_\d+$'` | **0** | safe to add VALID |
| `smm_calendar` rows with a `#`-prefixed tag | **7 of 59** | backfill included; this is A1b's stored half |
| `aanya_training_creatives` total rows | 0 | `surface` default is uncontested |

**A5 is deliberately not in this migration.** The brief says to add the
`published_assets` provenance CHECK "only if step 4 shows it absent". It is
present — `published_assets_has_provenance_check`, added by `20260829150000`,
and it is `NOT VALID`. **1 of 13 rows still violates it** (the downgrade probe
recorded in CLAUDE.md). So the outstanding work is not adding a constraint; it
is deciding whether to delete that row and `VALIDATE CONSTRAINT`, or leave it.
That is a data-deletion call, not a schema one, and it is not made here.

**Impossible-state CHECKs: none added.** The brief sources them from
`CC_V2_ultracode_plan.md`, absent from this worktree. A guessed CHECK is the
most expensive kind of guess to undo.

---

## 20260909121000 — NEW-2 image_jobs

| Table | Change |
|---|---|
| `image_jobs` | ADD `job_type`, `provider`, `model`, `cost_usd numeric(10,6)`, `started_at`, `surface`; replace status CHECK |

**Pre-flight: distinct current status values**

| status | rows |
|---|---|
| `done` | 17 |
| `failed` | 5 |
| **total** | 22 |

**⚠️ This migration is not schema-only and cannot ship alone.** The specified
vocabulary (`queued, running, succeeded, failed, timed_out`) does not contain
`done`, which is what 17 live rows hold and what three code sites use:

- `supabase/functions/generate-image/index.ts:369` writes `status: 'done'`
- `src/lib/gemini-service.ts:106` resolves the job on `row.status === 'done'`
- `supabase/migrations/20260811120000_image_jobs.sql:37,85` — reaper and partial
  index (both on `'queued'`, which survives)

The migration renames existing rows before re-constraining, so the DDL itself
succeeds. The hazard is deployment order: a running old client polls for
`'done'` and would hang forever on a job now marked `'succeeded'` — the exact
symptom RB-P11 was written to remove. **Either** deploy migration → edge →
client in that order during a quiet window, **or** keep `'done'` as an accepted
value in the CHECK and retire it separately. Decide before apply.

---

## 20260909122000 — R1 review schema

| Table | Change |
|---|---|
| `review_events` | ADD `surface`, `rating_overall`, `processed_at`, `source`; INSERT-only RLS restated |
| `project_creative_guidelines` | ADD `scope`, `status`, `evidence_count`, `source_review_ids uuid[]`, `activated_at`, `retired_at` + 4 CHECKs |
| `integration_health` | CREATE (NEW-3) — SELECT-only RLS |
| `cron_run_log` | CREATE — RLS on, no policy (no `org_id` to scope by) |

**Pre-flight**: `review_events` holds **0 rows**, so every added column and
CHECK is uncontested. `project_creative_guidelines` does not exist yet.

**RLS shapes, and why they differ**

- `review_events` — INSERT only, no SELECT/UPDATE/DELETE. There is no
  review-management UI; rows are raw signal for `ingest-review` (service role).
- `project_creative_guidelines`, `curation_log` — full CRUD, because `src/`
  writes them (bug #46).
- `integration_health` — SELECT only. Every write is a service-role probe; a
  browser must not be able to forge a green health row.
- `cron_run_log` — RLS enabled, **no policy at all**, which denies every
  authenticated caller. It has no `org_id`, so no org-scoped policy exists to
  write. Surfacing it to admins needs a SECURITY DEFINER function.

---

## Constraint-rejection probes

Run each after apply, **inside a rolled-back transaction**, and record both
directions — a rejection alone proves the constraint exists, not that it lets
legitimate rows through. One INSERT per CHECK, each expected to fail:

| # | Probe | Expected |
|---|---|---|
| 1 | `INSERT aanya_training_creatives (surface) VALUES ('billboard')` | reject `aanya_training_creatives_surface_check` |
| 2 | `UPDATE org_integrations SET meta_ad_account_id = 'ACT_123'` | reject `org_integrations_ad_account_format_check` |
| 3 | `UPDATE org_integrations SET meta_ad_account_id = 'act_12ab34'` | reject — the exact pair `normalizeAdAccountId` was written for |
| 4 | `UPDATE projects SET meta_ad_account_id = '1538119047116545'` | reject `projects_ad_account_format_check` (bare digits, no prefix) |
| 5 | `INSERT smm_calendar (hashtags) VALUES (ARRAY['#Patia','##Patia','patia'])` | **accept**, and store `{Patia}` — trigger normalises and dedupes |
| 6 | `UPDATE image_jobs SET status = 'done'` | **accept** — `'done'` is kept per the NEW-2 ruling (no rename); `'succeeded'` is the value now rejected |
| 7 | `INSERT image_jobs (surface) VALUES ('billboard')` | reject `image_jobs_surface_check` |
| 8 | `INSERT review_events (rating_overall) VALUES (6)` | reject `review_events_rating_overall_check` |
| 9 | `INSERT project_creative_guidelines (status,activated_at) VALUES ('active', NULL)` | reject `pcg_lifecycle_consistency_check` |
| 10 | `INSERT project_creative_guidelines (status,activated_at,retired_at) VALUES ('retired', now(), NULL)` | reject `pcg_lifecycle_consistency_check` |
| 11 | `INSERT project_creative_guidelines (scope,project_id) VALUES ('project', NULL)` | reject `pcg_scope_project_check` |
| 12 | `INSERT project_creative_guidelines (evidence_count,source_review_ids) VALUES (3, '{}')` | reject `pcg_evidence_count_check` |
| 13 | `INSERT integration_health (status,error_code) VALUES ('ok','190')` | reject `integration_health_ok_check` |
| 14 | `INSERT integration_health` twice for one `(org_id, provider)` | reject `uq_integration_health_org_provider` |
| 15 | `INSERT cron_run_log (status,finished_at) VALUES ('succeeded', NULL)` | reject `cron_run_log_finished_check` |
| 16 | As an authenticated non-service role: `SELECT * FROM review_events` | 0 rows — no SELECT policy |
| 17 | As an authenticated non-service role: `INSERT integration_health` | reject — no INSERT policy |

Probes 2–4 double as the A3 regression test for A4b, the un-normalised writer
in `_shared/meta-oauth.ts:208` that is still under the Meta freeze: once the
CHECK is live, that path fails loudly at the database instead of writing a
value that dies on the first Graph call.

---

## What is missing before any of this is applied

1. **PROD schema baseline was not taken.** `docs/runbooks/db-access.md`
   requires a read-only role and `psql`; no such role or connection string
   exists in this worktree, and the runbook forbids `supabase link` to PROD for
   reads. `psql`/`pg_dump` 18.4 are installed and ready. **Every count above is
   TEST-only.** PROD may hold rows that violate the A3 or image_jobs checks —
   in particular PROD carries the legacy Neelachala `org_integrations` row.
   Re-run the pre-flight against PROD before applying anything there.
2. **`CC_Phase1_Digest.md` and `CC_V2_ultracode_plan.md` are absent**, so R1's,
   NEW-3's and T5-M's own column lists could not be read. The drafts note every
   place they were inferred.

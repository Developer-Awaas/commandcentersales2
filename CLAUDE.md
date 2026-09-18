# CLAUDE.md — Command Center V2

## Purpose & repo map

Real-estate marketing SaaS for AWAAS Services Pvt Ltd. React + TypeScript client, Supabase backend (Postgres, Edge Functions, Auth, Storage, Realtime).

This file carries **invariants and current state only**. Architecture description, bug history and branch divergences moved out on 2026-09-09 — see Pointers. A merged commit is not a deployed fact: verify server-side claims against what is live, never against source.

| | |
|---|---|
| `main` | PROD lineage. Supabase `mpvdpdxzqnidwyihyhbn` (`CommandCentre_Prod`). CI-gated, branch-protected, PR-only. |
| `review-build` | Preview/reviewer lineage, deployed to `cc.awaas.world`. Supabase `yelmuykbqdyeikgbmkoq` (`AwaasSuite_CC_Test`, "TEST"). |
| Merge direction | `main` into `review-build` **only**. The CC-TEST guard commit is `DO-NOT-MERGE`. |

Client: `src/`. Edge Functions: `supabase/functions/` (`_shared/` is server-only, never importable from `src/`). Migrations: `supabase/migrations/`; DOWN migrations: `supabase/rollbacks/`.

## Invariants

One line each. Reasoning lives in `docs/decisions/architecture.md`.

### Security

- Every table has RLS scoped by `org_id = get_current_user_org_id()`, `TO authenticated` only.
- A table written from `src/` needs the full INSERT/UPDATE/DELETE policy set, not the SELECT-only service-role shape.
- A table written only by a service-role function stays SELECT-only, so a browser cannot forge its rows.
- RLS is not a check a service-role function ever meets — the gate must be written out in the function (`isOrgAdmin()`, `_shared/require-admin.ts`).
- `org_id` is never taken from a request body; derive it from `auth.getUser()` and re-filter every service-role query with it.
- Cron-only functions call `denyUnlessCron()` first: non-POST 405, missing service-role key 503, wrong bearer 401.
- `profiles` has a BEFORE UPDATE trigger blocking self-escalation on `role`, `module_access`, `daily_ai_limit`, `org_id`.
- Service-role and API keys never reach the client; no `VITE_`-prefixed secret, ever.
- `org_integrations` and `org_user_integrations` are admin-gated; the latter also scopes to `user_id = auth.uid()`.
- PROD reads go through a read-only role and `psql` — never `supabase link` to PROD (`docs/runbooks/db-access.md`).
- Park uncommitted work by branch-carry with explicit paths, never `git stash` — the stack is shared across worktrees and sessions.

### Data & migrations

- Additive only: ADD columns and tables, never destructively modify an existing one.
- Migration timestamps `YYYYMMDDHHMMSS`; wrap `ALTER` in `DO` blocks.
- DOWN migrations live in `supabase/rollbacks/` and are applied by hand, never by the CLI.
- Guard any migration that assumes an extension with a `pg_extension` check that degrades to `RAISE WARNING`.
- A wrong column name on `.insert()` or `.select()` does not throw and `deno check` cannot see it — check `.error` explicitly on every new write and read path.
- `supabase/functions/_shared/database.types.ts` is hand-written; update it per migration and `deno check` before trusting generated output.
- `brand_kits` is strictly org-level (`UNIQUE org_id`, no `project_id`).
- `agent_memory` takes no new columns; semantic search is `agent_memory_chunks`.
- `match_memory_chunks` takes no `org_id` — it is SECURITY INVOKER and RLS enforces tenancy.
- Edited images overwrite the original storage path (`upsert: true`); files never accumulate.
- A stored path starting `generated-creatives/` lives in `brand-assets`; every other path in `creative-assets`.
- `agent_interactions` is the single row-per-external-API-call ledger for the whole app; no parallel tables.
- Pricing maps are mirrored at `src/lib/pricing.ts` and `_shared/pricing.ts` — update both, or CI trips.
- `normalizeAdAccountId()` (`src/lib/ad-account-id.ts` plus its `_shared` twin) is the sole owner of the `act_` prefix.
- `normalizeHashtags()` at ingest, `formatHashtag()` at render — canonical storage carries no leading hash, and `formatHashtag` is idempotent.

### Prompts & agents

- Every LLM call goes through `claude-proxy`; no key reaches the browser.
- LLM output is parsed with `parseJsonObject()`, never raw `JSON.parse`.
- Every LLM, image and vision call logs a Langfuse `GENERATION`, never a bare span; image bytes are never sent.
- Image generation goes through `_shared/image-provider.ts` — no caller constructs a provider request directly.
- Every fetch to a model provider carries an `AbortSignal.timeout`; a missing one surfaces as an unexplained platform kill rather than an error that names itself.
- `aarav-orchestrate` is the only Edge Function the client calls; `_shared/agents/` is never routable and never imported under `src/`.
- No Aanya creative reaches the user without a Diya verdict; a failed check flags the whole batch fail-safe.
- A failed specialist returns an Aarav-voiced fallback — raw provider errors never reach the response or the user.
- Prompt directive builders in `senior-designer-prompts.ts` are versioned artifacts: any edit needs one `scripts/prompt-eval.ts` run in the PR. Against a stochastic model, one manual generation is not evidence.
- A harness imports the real prompt builder from `src/`; it never restates prompt text.
- Prices render in rupees, never in dollars or USD.
- Keep LLM calls lean: only needed context, focused single-purpose prompts, `max_tokens` scoped to the expected output shape.

### CI, deploy & environments

- `.github/workflows/typecheck.yml` runs **six** jobs on push and PR to **`[main, review-build]`**: `build`, `client-unit-tests`, `edge-typecheck`, `edge-unit-tests`, `ws1-6-isolation`, `playwright-e2e`.
- `main` branch protection requires 4 checks with `enforce_admins: true` and no bypass — all changes go through a PR.
- `--no-verify` skips only the local hook mirror; CI is the real backstop.
- A new `supabase/functions/*/index.ts` must be added to `typecheck.yml`, `scripts/hooks/pre-push` and `deploy-functions.yml`.
- Every new `*.test.ts` must be added to the explicit `include:` list in `vitest.config.ts` or it does not run.
- Vitest runs files sequentially (`fileParallelism: false`) — deterministic; re-enabling parallelism reintroduces flakes.
- Any `catch` with a destructive side effect needs a paired test proving it does not fire on a transient error.
- Test writes on PROD scope to `ZZ-INTERNAL-TEST` (`983c7c08-ffaf-402b-981a-a9cd22615cae`), never to a customer org.
- Setting secrets, extracting a service key, and reading decrypted vault secrets are sandbox-blocked; a human runs those with a leading `!`.
- A static file's liveness is asserted on content, never on HTTP status — the SPA catch-all returns 200 for missing files.

### Meta — FROZEN surfaces

Do not edit without explicit instruction, including incidentally: `meta-publish*`, `meta-token-connect`, `meta-oauth*`, `_shared/meta-publish.ts`, `_shared/meta-oauth.ts`, `_shared/graph-version.ts`, the `SettingsPage` publishing section, `MetaPostDialog`, Monitor sync.

- Publishing needs two independent gates with different owners: `org_integrations.publish_page_id` (admin-chosen) and `PUBLISH_ALLOWED_PAGE_IDS` (deploy-time secret).
- Unset or empty `PUBLISH_ALLOWED_PAGE_IDS` refuses every publish — fail closed.
- An omitted or malformed `dry_run` is treated as true; anything unrecognised in `META_PUBLISH_MODE` resolves to `draft`.
- A live request that fails a gate downgrades to draft with a warning, never an error.
- Publish targets are the admin-chosen `publish_page_id`, never the discovered `meta_page_id`.
- Page tokens are derived per call from `/me/accounts` and checked for `CREATE_CONTENT`; never stored.
- `GRAPH_API_VERSION` is one constant (v26.0); a bump moves campaign sync with it and needs a real sync re-verified.
- Nothing reaches `org_integrations` until `verifyMetaToken()` confirms it; granted scopes are stored, not requested ones.

## Current state

IDs below are **defined** in `docs/closeout-inventory.md` — the Phase 1 intake
plus a dated session-state block per closeout. Read it before using any ID from
this table. Their working detail lives in `docs/decisions/phase2-schema-gate.md`
(the three unapplied drafts, pre-flight counts, 17 constraint probes),
`docs/runbooks/db-access.md` (PROD reads, parking work) and
`docs/runbooks/test-cron-parity.md` (CC-TEST cron).

| Inventory ID | Status | Owner | Evidence pointer |
|---|---|---|---|
| A1 | CLOSED | client | `a10e546`; `src/lib/hashtags.ts`, 15 tests |
| A1b | OPEN | client | legacy hash-prefixed rows in `smm_calendar.hashtags` / `tool_outputs` never backfilled; `StrategyResult.tsx:370,655,659` renders unformatted |
| A2 | CLOSED | client | `SMMCreatives.tsx:128-132`, `feature: 'smm-creative-gen'` |
| A3 | CLOSED | repo | `53c78bd`; `.gitignore` carries `supabase/.temp/` |
| A4 | CLOSED | client | `1fbda09`; `src/pages/projects/ProjectForm.tsx` |
| A4b | FROZEN | edge | `_shared/meta-oauth.ts:208` builds the prefix raw; under the Meta freeze |
| A5 | CLOSED | repo | `docs/runbooks/db-access.md` |
| A6 | CLOSED | repo | `docs/runbooks/test-cron-parity.md` |
| A7 | CLOSED | ci | `d589746`; `typecheck.yml:4-8` |
| A8 | CLOSED | tooling | Vercel CLI 59.13.1 installed; deliberately not linked |
| A9 | CLOSED | repo | `7c1688f` on `park/review-creative-button`; tree clean |
| T-001 | FIXED-UNVERIFIED | client | `7b924a7`; `submissionId` key in `Strategy.tsx`; e2e skips on absent credentials |
| D3a | OPEN | db | `supabase/scripts/test-cron-parity.sql` applied; `pg_net` and `project_url` in place, jobs await a hand-seeded `service_role_key` |
| P1-CM-01 | OPEN | edge | ad-level sync still org-level, `_shared/meta-sync-core.ts:238` |
| P1-CM-02 | OPEN | client | Kavya canvas unrendered; no `kavya` reference under `src/pages/leadgen-v2/` |
| P1-CM-03 | OPEN | client | call sites without an explicit `traceName` still default to `claude-call` |
| P1-CM-04 | DEFERRED | prompts | Section 6 reserve-negative-space A/B never run |
| P1-CM-05 | CLOSED | ci | `typecheck.yml:203`; `e2e/` holds 4 specs |
| P1-CM-06 | OPEN | edge | `retrieveMemory` (`_shared/agent-memory.ts:119`) has zero callers |
| P1-CM-07 | CLOSED | ci | `gh api .../branches/main/protection` 2026-09-10: 4 required checks (build, edge-typecheck, edge-unit-tests, client-unit-tests), `enforce_admins: true`, `strict: false`. `playwright-e2e` and `ws1-6-isolation` are advisory, by design |
| S1-E2E | OPEN | ci | `e2e/history-journey.spec.ts:64` red on review-build since its first-ever CI run (34485282542). Untouched by that push; wizard save throws, `saved` never flips. Hypothesis: e2e targets PROD, and `tool_outputs.platform` (migration `20260814120000`) may never have been applied there. Advisory job, not blocking |
| P1-CM-08 | DEFERRED | prompts | RB-P0 Rung-2 mask design documented, not built |
| P1-CM-09 | OPEN | prompts | Kolosus clean-template ghost-text measurement never run |
| P1-CM-10 | OPEN | prompts | Grand Mark visual A/B never run; default is `gpt-image-2`, `_shared/image-provider.ts:225` |
| P1-CM-11 | OPEN | prompts | run-out to emptied-blocks is a soft preference the model does not always honour |
| P1-CM-12 | OPEN | edge | measured on TEST 2026-09-10, three SMM 1:1 text-to-image jobs: 143s, 138s, 150s. All three exceed the 135s sync cap — the async path is load-bearing, not a margin. Plan-tier ceiling still unconfirmed |
| P1-CM-13 | OPEN | prompts | V5 panel assignment never run on a real multi-panel reference |
| P1-CM-14 | FROZEN | meta | Sandbox IG link absent from `/me/accounts`; re-selecting FB-only destroys `publish_ig_user_id` |
| P1-CM-15 | OPEN | client | T-001 two-generation SQL evidence not produced; `creatives` has no `strategy_id` or `session_id` — use `creative_assets.session_id` |
| T5-4 | OPEN | db | historic mislabelled `feature='creatives'` row left for pricing reconciliation |
| T5-6a | CLOSED | client | SMM publish via `MetaPostDialog`; IG post `18457596949139900` |
| T5-8 | DEFERRED | meta | Meta token owned by our system user, not the client's; migrate after R-A clears |
| T5-M | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| T5-1 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| T5-2 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| T5-3 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| T5-5 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| T5-7 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| NEW-1 … NEW-7 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| R1 … R6 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| M0, M1, M2 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| C3, C4 | DEFERRED | unassigned | no definition in repo or session transcript — define before use |
| T-008 | CLOSED (TEST) | db | `74ab075`; `creative_assets` anon DELETE removed. PROD via `docs/decisions/phase7-prod-batch.md` |
| T-009 | OPEN | client/edge | move `review-service.ts:59` + `ingest-review` to `entity_*`/`rating`, then drop legacy `review_events` columns. Phase 3, before R2/R3 |
| T-010 | CLOSED (TEST) | db | `41e9c37` `78cb813` `f891965`; 0 policies on TEST are `true` or anon. PROD via the Phase 7 batch |
| T-011 | OPEN | db/client | `chatbot_log` org/user ids are client-supplied text. P1, Phase 3 |
| PH2 | CLOSED | db | Phase 2 applied on TEST only; digest in `docs/closeout-inventory.md`. PROD = `docs/decisions/phase7-prod-batch.md`, behind the merge-readiness gate |
| T-007a/b | DONE (unpushed) | client | `3ba1a17` SMM uses org brand kit; `3939677` no unattached-logo claims. prompt-eval pending (golden refs absent) |
| T-007c/d | OPEN | client | logo compositing + `''` fallback (Ph3); brand_kit key mismatch, fonts, Aarav brand context (Ph3, T5-1) |
| T-012 | FIXED-UNDEPLOYED | prompts/edge | `2c5faf1`; cut raised to `MAX_PROMPT_CHARS` 32k + `prioritizeConstraints()` puts SECTION 7–9 first. Edge not deployed to TEST yet |
| R-A | OPEN | meta | Meta app review in flight; reviewer account `meta-review@awaas.world` |
| Q16 | CLOSED | meta | seeded-demo journey, one identity everywhere |

## Workflow rules

- **Diagnose before edit.** Trace the real flow end to end and grep every caller of the function you are about to change. Fix where all callers route through, not on the path the ticket names.
- **Typecheck**: `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json`). Bare `tsc --noEmit` checks nothing here — the root config only references sub-projects. Do not read its exit code through a pipe; use `${PIPESTATUS[0]}` or do not pipe.
- **Full local gate**: `npm run typecheck`, `npm test`, `npm run build`, `deno check`, `deno test`. Mirrored by `scripts/hooks/pre-push` (opt in with `git config core.hooksPath scripts/hooks`).
- **Insert-payload audit** after any new `.insert()` or `.upsert()`: `deno run --node-modules-dir=none --allow-read --allow-write --allow-run --allow-env scripts/audit-insert-columns.ts`.
- **Deploy** is push, CI green, promote, then confirm the build stamp. `deploy-functions.yml` auto-deploys `supabase/functions/**` on `main`; `workflow_dispatch` verifies the token before you trust it. review-build deploys to TEST by hand (`supabase functions deploy --use-api`, `supabase db push`). Confirm what is live before claiming it — `gh run list --workflow=deploy-functions.yml`, or the live behaviour itself.
- **Freeze policy**: the surfaces listed under Invariants → Meta are not edited without explicit instruction. If a fix appears to require one, stop and say so.
- **Model and token discipline**: lean prompts, focused single-purpose calls, `max_tokens` scoped to the output shape. Extended reasoning for architecture, schema changes and large refactors; act directly on obvious edits.
- **Keep this file current.** Invariants and the state table are the contract. New reasoning goes to `docs/decisions/`, new incidents to `docs/history/bugs.md` — not here.

## Pointers

- `docs/history/bugs.md` — every known-fixed bug (#1–#50) with its fix commit or migration. Read it before re-diagnosing anything that feels familiar.
- `docs/decisions/` — `architecture.md` (integrations, key tables, flows, UI components, and the full original Rules text) and `review-build-divergences.md` (RB-P0 through RB-PUB, P2.13, P2.14, V5, the RB-P3 ledger, RB-BRAND, Meta Publishing).
- `docs/runbooks/` — `db-access.md` (PROD reads, parking work), `test-cron-parity.md` (CC-TEST cron).
- `docs/spikes/`, `docs/aanya-memory-schema.md`, `docs/rb-p0-replicate-consolidation.md` — investigation records.
- `supabase/tests/isolation/README.md` — WS1.6 probe list and coverage gaps.
- `CC_V2_ultracode_plan.md` — **not present in this repo.** Held elsewhere; ask before relying on it.

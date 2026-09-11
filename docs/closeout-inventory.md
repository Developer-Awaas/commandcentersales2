# CC Closeout — Phase 1 Digest (State intake + hygiene)
Date: 2026-09-09 · Repo: commandcentersales2 · Worktree: D:/Developer-Awaas/wt/review-build
Serving: cc.awaas.world = 8a1d42c (UNCHANGED, R-A recording surface) · origin/review-build = 6af2758 · local head = 07e724c
Commit this file as docs/closeout-inventory.md at Phase 2 open. CLAUDE.md "Current state" references IDs here.

## Phase 1 outcome (≤300 words)
Discovery verified every §E claim; three digest contradictions surfaced and resolved (hashtag ownership wider than A1 scope; ProjectForm path + second act_ site A4b; TEST cron never fired — pg_net absent). PROD cron is healthy (5 jobs, 1,850/0 runs 7d). T-001 (stale image on re-generate) root-caused to an unkeyed result panel with one-shot ref guard; fixed in 3 lines + sanitised error copy. Hashtag `#` now has one owner both sides (7 render, 6 ingest, 10 tests). CI gated on review-build. CLAUDE.md 25,343 → 2,118 words; history/decisions split to docs/. `image_jobs` exists (thin) → NEW-2 becomes ALTER. `retrieveMemory` has zero callers → T5-1 is its second consumer. Playwright job exists (4 specs) → NEW-6 = extend.

**Exit blockers (human):** (1) TEST `service_role_key` vault seed → D3a first tick; (2) branch-protection readout (P1-CM-07); (3) manual two-generation run for T-001 (or defer to first post-freeze deploy); (4) H1/H7 golden refs; (5) `CC_V2_ultracode_plan.md` into docs/plans/.

**Locked decisions:** D1a D2ab D3a D4a D5a D6a D7a D8a (see Decisions).

## Queued push manifest (hold until freeze lifts + R-A D9 logged)
review-build: 53c78bd d589746 1fbda09 c4dc2a6 bcd3443 1b969f2 7b924a7 a10e546 07e724c (+ inventory commit)
park/review-creative-button: 7c1688f (Phase 5)
[R-A IMPACT on promote]: Strategy button/error copy; `#` prefix on SMMCreatives, SMMPlanner, SMMCalendar, ContentLibrary, AiSessionDetail.

## State table
| ID | Item | Status | Evidence |
|---|---|---|---|
| A1 | Hashtag ownership | CLOSED | a10e546; grep: only hashtags.ts prefixes |
| A1b | StrategyResult.tsx:370,655,659 bare tags | OPEN → Phase 2 batch 1 | after T-001 verified |
| A2 | costMeta label | CLOSED | SMMCreatives.tsx:128-132 |
| A3 | act_ CHECK constraint | OPEN → T5-M | — |
| A4 | ProjectForm normalizer | CLOSED | 1fbda09 |
| A4b | _shared/meta-oauth.ts:208 raw act_ | FROZEN → Phase 4 | — |
| A5 | published_assets at-least-one CHECK | PROBE → T5-M | — |
| A6 | Edit-path timeout margin | WATCH | P1-CM-12 related |
| A7 | CI on review-build | CLOSED | d589746 |
| A8 | Vercel CLI | CLOSED (59.13.1, not linked) | — |
| A9 | Tree hygiene | CLOSED | park branch 7c1688f; .gitignore 53c78bd |
| T-001 | Stale image on re-generate | FIXED-UNVERIFIED | 7b924a7; e2e/strategy-regenerate.spec.ts; manual run pending |
| D3a | CC-TEST cron parity | HALF-APPLIED | pg_net + project_url seeded; jobs await service_role_key |
| P1-CM-07 | Branch protection | PENDING HUMAN | — |

## Open inventory (definitions — authoritative)

**`CC_V2_ultracode_plan.md` is LOST.** It is not in this repo, not in the
session transcript, and is not recoverable. The definitions in this section are
therefore **authoritative** — the only source for every ID below. Do not defer to
the plan file; do not treat an ID as under-defined because the plan is missing.

**Wave 5 (specs were in the lost plan file; the lines below are the spec):** T5-M surface partition migration + A3/A5 CHECKs, runs alone · T5-1 RB-P3 synthesis cron + server-side prompt assembly (consumes retrieveMemory) · T5-6a SMM formats (gi2 size probe first) · T5-6b SMM directive module · T5-6c copy-creative + harness cells · T5-7 per-channel routing (retires FB-only) · T5-8 token USER→SYSTEM_USER (post-submission only) · T5-2 popup smoke · T5-3 P2.13 evidence · T5-4 pricing reconciliation · T5-5 differentiation verify-only.
**NEW (Phase 1 gap analysis):** NEW-1 hide FB-only behind flag (Ph4) · NEW-2 ALTER image_jobs: job_type, provider, cost, started_at, terminal-state CHECK (Ph2) — **status vocabulary is `queued|running|done|failed|timed_out`**: `'done'` is kept, not renamed to `'succeeded'`, so no UPDATE touches the 17 live rows and no deploy-order hazard exists · NEW-3 integration_health: **`token_expires_at timestamptz`** (that exact column name), last sync, last error + cron run-log (schema Ph2, UI Ph4) · NEW-4 publish idempotency key + unique meta_post_id (Ph4) · NEW-5 Integration Health card + admin alerts (Ph4) · NEW-6 extend Playwright: publish-draft path (Ph5) · NEW-7 org_audit_events light audit log (Ph5) · NEW-8 shared AsyncJobPanel (status line, version strip, plain-language errors) (Ph3, reused by T5-6a).
**Review/learning track (retires C1/C2, absorbs C4):** R1 schema review_events (creative|strategy, rating, intent_tags[], comment, parent_creative_id) + rule lifecycle columns (Ph2) · R2 regenerate-with-intent → server-side prompt delta → child creative (Ph3) · R3 rating 👍/👎 + 3-tap strategy questionnaire (Ph3) · R4 tiered promotion job: N=3 same tag/project → project candidate; 2 projects → org candidate; activate on mean ≥4 over next 5; auto-retire on decline; bumps agent_personality_versions (Ph5) · R5 K4 harness gate before any rule activates (Ph5) · R6 "Aanya learned…" surface + Memory UI (Ph6).
**Praveshika readiness:** M0 boundary rule + lint: brand-kit, meta-connect, projects, org only via adapters (Ph2) · M1 ports + local adapters + src/contracts/ DTOs (Ph5) · M2 meta-connect adapter (Ph4, frozen until then) · M3 Praveshika token-broker contract (Ph7): Praveshika holds the client-owned Meta token and Command Center asks it for a short-lived page token per call, so no long-lived client token is ever stored here. Consumes T5-8; blocked until R-A clears.
**From CLAUDE.md audit:** P1-CM-01 ad-level sync uses org-level ad account (P1, Ph4) · -02 Kavya canvas (Ph6) · -03 Langfuse trace names (Ph5) · -04 text-overlay phase 2 (Ph6) · -05/-10 stale claims (CORRECTED) · -06 retrieveMemory unconsumed (Ph2, T5-1) · -07 branch protection (human) · -08 zone extraction / Rung-2 mask (register) · -09 Kolosus directive unmeasured (Ph5, K4) · -11 run-out soft preference (register; R4 learns it) · -12 Edge 150s plan tier (Gate P decision) · -13 V5 real refs (Ph3, needs H1) · -14 Sandbox IG link (verify Ph4, likely stale) · -15 Creatives.tsx hashtags:[] intent (Ph6).
**Register only:** C3 Promote-this-post (R-B scope) · Gate P infra items.

## Decisions
D1a key panel on submissionId + clear result · D2a formatHashtag/normalize single owner; D2b DB trigger backstop in Ph2 migration · D3a mirror PROD cron on TEST · D4a fixed 6-chip intent taxonomy + Haiku-classified comment · D5a thresholds as R4 above · D6a rated/regenerated creatives exempt from 20-cap, ceiling 100/project, prune oldest unrated · D7a in-repo ports/adapters, extraction on second consumer · D8a threaded into phases.
**Storage-cost FYI to Rahul:** D6a raises worst-case per-project storage 5×.

## Standing rules added this phase
PROD reads via read-only role + psql, never `supabase link` · park by branch-carry, never stash · SQL in prompts must cite `\d` output or say "adapt to actual columns" · every user-visible-surface prompt carries [R-A IMPACT] until D9 logged.

## Skills to author (Phase 2 open, Sonnet) → .claude/skills/<name>/SKILL.md
- probe-prompt: template — read-only, freeze list, file:line + `\d` citations, hypothesis table SUPPORTED/REFUTED/UNTESTED, contradictions flagged not reconciled, ≤150-word summary.
- deploy-verify: push authorization → CI run ID → `vercel promote` → stamp match on alias → SQL/row evidence → mark CLOSED; refuse to mark done without stamp.
- test-triage: tester report → T-nnn; require env + build stamp; map to inventory ID or open new; assign class P0–P3 + phase; bounce reports lacking stamp.

## Phase 2 plan (next session — one chat)
Order: commit inventory + plan file → author 3 skills → PROD dump → T5-M alone (+A3, A5 probe, D2b trigger) → constraint-rejection probes → NEW-2 ALTER → NEW-3 + R1 schema → Opus schema gate → T5-1 build consuming retrieveMemory → cross-surface leak probe + bundle grep. All TEST-only; nothing deploys. Entry gate: D3a first tick evidence + branch-protection readout on screen.

## Phase 7 — Convergence
Praveshika convergence: M1 ports/adapters land, M2 meta-connect adapter is unfrozen, M3 token-broker contract replaces the stored system-user token (T5-8), and R6 surfaces what Aanya learned. Nothing in Phase 7 starts before R-A clears.

## Session state 2026-09-11

S1 shipped and pushed: `b92781a` (image generates with the result, failures
visible), `398cdf0` (IG-first publish targets), `bf3a208` (CI Vitest env),
`ab96cd1` (docs). CI run **34488963957** — all four required checks green.
**Promote pending**: `cc.awaas.world` still serves `8a1d42c` ·
2026-09-02T14:26:47.916Z; Saswat promotes by hand, CLI stays unlinked.

- **P1-CM-07 CLOSED.** 4 required checks, `enforce_admins: true`,
  `strict: false`; playwright-e2e and ws1-6-isolation advisory by design.
- **P1-CM-12 measured.** Three real SMM 1:1 generations on TEST: 143s, 138s,
  150s. All over the 135s sync cap — the async path is load-bearing.
- **P1-CM-16 OPEN — canonical ID; `S1-E2E` is an alias for it.** CLAUDE.md's
  state table still lists the alias; both name one item and P1-CM-16 wins: `history-journey.spec.ts:64` red since this branch's
  first-ever CI run, untouched by that push. Is the Playwright job's env
  pointed at PROD, and is `tool_outputs.platform` (`20260814120000`) missing
  there? Unconfirmed — needs the PROD read-only role.
- **A2 first evidenced today.** `agent_interactions` had zero
  `feature='smm-creative-gen'` rows before 2026-09-10; three now, `gpt-image-2`,
  $0.165 each.
- **S1-E2E → NEW-6** (extend Playwright).
- **`META_PUBLISH_MODE` on TEST is `live`**, set deliberately inside the review
  track's window. **Never flip it from closeout.** Draft-publish evidence was
  stopped for exactly this reason.

**Next:** Phase 2 continue — drafts → gate revisions → TEST apply → smoke.

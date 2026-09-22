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

## Security and schema follow-ups (recorded 2026-09-17)

**T-008 (P0) CLOSED on TEST** — `74ab075`: `creative_assets` DELETE scoped to
the caller's org. PROD exposure not yet probed.

**T-009 (Phase 3, before R2/R3):** move `src/lib/review-service.ts:59` and
`supabase/functions/ingest-review/index.ts:~140` off `subject_type` /
`subject_id` / `ratings` onto `entity_type` / `entity_id` / `rating`, then drop
the three legacy columns in a forward migration. The drop must not ship before
the writers: `submitReview` swallows insert errors, so review capture would
fail silently.

**T-010 (P0) CLOSED on TEST 2026-09-17** — `41e9c37`, `78cb813`, `f891965`;
PROD in `docs/decisions/phase7-prod-batch.md`. The rest of `20260604120000`'s permissive
policies. After the fix, 0 policies on TEST are `true` or open to anon. Audit on TEST, 2026-09-16 — every policy with `true` or role `anon`:

| Table | Policy | Cmd | Roles | USING | WITH CHECK | State |
|---|---|---|---|---|---|---|
| awaas_data_pool | Allow anon insert awaas_data_pool | INSERT | anon, authenticated | | true | open |
| awaas_data_pool | Allow anon select awaas_data_pool | SELECT | anon, authenticated | true | | open |
| awaas_data_pool | Allow anon update awaas_data_pool | UPDATE | anon, authenticated | true | true | open |
| awaas_data_pool | Authenticated users can read awaas pool | SELECT | authenticated | true | | open (cross-org read) |
| chatbot_log | Allow anon insert for chatbot logs | INSERT | anon | | true | open |
| chatbot_log | Allow anon select for chatbot logs | SELECT | anon | true | | open — **anyone can read all chat text** |
| chatbot_log | Allow anon update chatbot_log | UPDATE | anon, authenticated | true | true | open |
| creative_assets | Allow anon delete creative_assets | DELETE | anon, authenticated | true | | fixed, T-008 |
| org_user_integrations | Allow anon delete org_user_integrations | DELETE | anon, authenticated | true | | open |

**9a CLOSED on TEST (2026-09-17):** `saswat-review-admin@awaas.internal`
(`941f3596`) is the internal test user by decision. Its profile moved from
Demo Builder (`1a0f7ac3-8053-4aee-824c-75f27681ce64`) to ZZ-INTERNAL-TEST
(`0a86b9b5-49b9-4590-9805-0ad427d451e9`), role `admin`; it no longer sees
Demo Builder data. Rollback: set `profiles.org_id` back to `1a0f7ac3…`.
`E2E_ORG_ID` is set on the `review-build` environment. Its `module_access`
has no SMM module keys; check before using it for the SMM smoke.

**T-011 (P1, Phase 3):** `chatbot_log.org_id` / `user_id` are `text`, filled
client-side from `localStorage` (`src/lib/constants.ts:17-23`; insert at
`src/lib/chatbot-service.ts:167`) with a `'dev-user-001'` default. RLS scopes by
org only, so a signed-in user can write rows under any `user_id` in their org.
On TEST, all 8 rows carry org A's id under `ca8a01ed`, a user now in org B.
Fix: `uuid` columns, identity derived server-side (column defaults from
`auth.uid()` / `get_current_user_org_id()` or an Edge write), and a
backfill-or-quarantine decision for the existing rows. It is the same
tamperable-identity class the §5.1 Deviation Register
(`docs/decisions/architecture.md`) records as closed.

**Side effect of 9a, open:** the only TEST `org_user_integrations` row (Canva,
`b46ce58a`) belongs to `941f3596` but still carries Demo Builder's `org_id`.
Its owner is now in ZZ-INTERNAL-TEST, so RLS hides the row from them;
reconnecting Canva writes a fresh row. The architecture doc
(`docs/decisions/architecture.md:365`) names `zz-internal-test@awaas.internal`
as the `INTERNAL_TEST_USER_*` identity. Confirm the `review-build` environment
secrets hold `saswat-review-admin`'s credentials, or TEST e2e login fails.

**Merge-readiness gate (PROD migration):** the Phase 7 PROD batch
(`docs/decisions/phase7-prod-batch.md`) runs only when all four hold:
(a) Meta submission ID logged, (b) Phases 3–5 closed, (c) internal reviewer
sign-off, (d) e2e green on `review-build`. CC PROD is a frozen baseline with no
traffic; its permissive policies are fixed in that batch, not before.

**T-007 — brand kit not reaching image generation** (probe 2026-09-17), split:
- **T-007a (P0, now):** SMM Creatives uses the org's brand kit. It was
  hard-coded `#1B4332 #2DD4A8` at `src/lib/smm-prompts.ts:129`. Colours, fonts,
  motifs and `design_aesthetic` go in as text; `''` counts as absent; no logo.
- **T-007b (P0, now):** remove every prompt claim about an asset that is not
  attached: single-call `BRAND_LOGO` manifest entries, the replicate line
  "via the strings above", and SMM's "logo placement". Replace them with "leave
  clean space in a stated corner for a logo placed later".
- **T-007c (P1, Phase 3):** composite the logo after generation. Fix the `??`
  fallback that lets `''` through at `StrategyResult.tsx:1543` and
  `overlay-recompose.ts:72`; place the logo automatically instead of leaving it
  unplaced; extend to SMM and Quick Generate.
- **T-007d (P1, Phase 3, inside T5-1):** the `brand_kit`/`brandKit` field
  mismatch at `senior-designer-prompts.ts:1116`; fonts dropped at `:1086-1093`;
  Aarav→Aanya gets no brand context (`aarav-orchestrate/index.ts:413,924`).

**T-006 evidence (2026-09-17):** `generate-image/index.ts:177` cuts prompts
to 4,000 characters without saying so. Instrumented in `cdc20e5` (not
deployed). Measured without deploying: three real assembled prompts, plus the
other two layouts of each Lead Gen run.
- **Lead Gen (Quick Generate, two-stage, ZZ e2e project, two briefs):**
  main 6,304 / 6,635 chars; portrait 5,263 / 5,759; story 5,868 / 5,958. The
  hero wrapper adds 460. **All six are truncated.** SECTION 7 (brand & project
  elements) starts at 3,993–5,147 and SECTION 8/9 (negatives, technical specs)
  at 4,399–6,385, so the image model never sees the brand section, the
  negative prompts or the aspect/quality specs.
- **SMM:** nanoPrompt 1,955 chars. Not truncated.

**T-012 (P0, candidate cause of demo instability):** every Lead Gen image
prompt loses Sections 7–9 to the silent 4,000-char cut. Stage 2 asks for
500–800 words (`senior-designer-prompts.ts:1339`), and 800 words ≈ 5,000+
chars. Fix options: a character budget in Stage 2, moving brand/negatives
ahead of the narrative, or raising the cut to the provider's real limit.
**CLOSED by T-012 (`2c5faf1`)**, measurements in that commit message.
Also: in hero mode, `buildHeroEditPrompt` appends its "no on-image text or
logos" override at the end (`senior-designer-prompts.ts`, `return
${preamble}…${override}`), so with every prompt over 4,000 chars that override
is always cut.

**T-007a DONE (`3ba1a17`)** — live on TEST: the ZZ-INTERNAL-TEST kit
(`#6A1B9A`/`#F9A825`, seeded as a test fixture) reached the nanoPrompt;
`image_jobs` done in 145s; `smm-creative-gen` ledger row $0.165. The client is
not deployed until the push.
**T-007b DONE (`3939677`)** — split by path: BRAND_LOGO roles are kept for
the export pack; image prompts reserve empty top-left space. The required
`scripts/prompt-eval.ts` run is **pending**: its golden refs
(`scripts/eval-refs/`) are not in the repo.

**Accounts on TEST (2026-09-18).** `saswat-review-admin@awaas.internal` is
back in Demo Builder (`1a0f7ac3-8053-4aee-824c-75f27681ce64`), which stays
pristine for the human Meta reviewer and is never a CI or harness target.
CI and harnesses use `e2e@awaas.internal` (auth id `d8981615`), admin in
ZZ-INTERNAL-TEST (`0a86b9b5-49b9-4590-9805-0ad427d451e9`) with the full
22-key `module_access` including the four SMM modules. Its password is in
gitignored `.env.e2e.local` (`E2E_EMAIL` / `E2E_PASSWORD`); the
`review-build` GitHub environment's `INTERNAL_TEST_USER_*` secrets must hold
the same pair. `scripts/smm-brand-live-check.ts` reads that file — never the
reviewer credentials. No sample images were seeded: every e2e spec is
state-tolerant and image bytes come from `VITE_MOCK_AI` fixtures.

**Demo Builder was written to once, by me, not by CI:** the 2026-09-18 T-012
measurement ran under the reviewer account minutes after it was moved back,
leaving 7 `agent_interactions` cost rows (~$0.22, `senior-designer-stage1`
and `-stage2-*`, 06:49–06:51Z). No `tool_outputs`, `agent_turns`, creatives or
images. Left in place — deleting spend history would corrupt the T5-4
reconciliation — flagged here instead.

**T-007b eval SKIPPED by decision (2026-09-18).** The invariant requires one
`scripts/prompt-eval.ts` run per `senior-designer-prompts.ts` prompt edit.
Waived here because T-007b only removes claims about attachments that were
never attached and adds a reserve-space directive; it changes no creative
direction. The H1 golden references (`scripts/eval-refs/`) are still absent
and remain **blocking for T-007c and T5-6**.

**T-013 CLOSED 2026-09-18** — Saswat promoted the build in the Vercel
dashboard (domain was pinned to `ab96cd1` from the pre-demo promote).
`cc.awaas.world` now serves `c568261` (`Age: 2`, fresh `Last-Modified`).

**T-013 RECURRED 2026-09-22, reclassified as a standing requirement, not a
one-off.** Push `4309a6b` (T-016): CI green, Vercel's own records showed a
completed deploy within ~20s, but `cc.awaas.world` kept serving the prior
commit (`639ee1f`) until Saswat promoted by hand again. Two independent
occurrences (2026-09-18, 2026-09-22) against one clean auto-deploy
(2026-09-12) — the review-build → `cc.awaas.world` Vercel promote is not
reliably automatic. CLAUDE.md's Deploy rule and the `deploy-verify` skill
now say so; every push needs a stamp check and a live human on standby to
promote, not an assumption either way.

**T-014 triaged, not fixed.** `e2e/strategy-regenerate.spec.ts` runs against a
CI-built preview (`playwright.config.ts`'s `webServer`: `npm run build &&
npm run preview`), never the deployed client — so it is unrelated to T-013.
Root cause: `06f2391` (T-005, 2026-09-13) renamed the button's text from
"Generating… usually under a minute" to "…this takes 2-3 minutes"; the spec
at `:51` still searches for the old string. Not fixed here, per instruction.

**Step 5 CLOSED 2026-09-18.** `generate-image` deployed to TEST alone
(`--use-api`), version 26 → 27; rollback baseline recorded as `1e5eec1` (last
commit before this session's changes to it) but not needed. One live Lead Gen
Quick Generate, e2e account, ZZ org, through the deployed function:
- Prompt: 6,443 chars; Sections 7/8/9 all present.
- `image_jobs`: `done`, `started_at` now stamped (T-006a live-verified —
  duration 2m02s, derivable for the first time), `error` empty.
- Generated PNG (1024×1024, verified by download + visual read): on-brand
  purple/gold (the seeded ZZ kit), correct project data (Patia, Bhubaneswar,
  ZZ-E2E Test Project), **and an empty reserved box in the logo corner — no
  drawn logo** (T-007b live-verified). Nothing visibly wrong; no rollback.

**T-013 (P0) — cc.awaas.world not picking up new deploys.** Two pushes today
(`039d942`, `4285f63`) each show a genuine Vercel `Production` deployment
success within ~15s (GitHub commit status "Vercel": success; Deployments API
`environment: Production`), yet `cc.awaas.world` still serves the Sept 10
bundle (`__COMMIT_SHA__ = ab96cd18ba97…`) 2+ hours later — same JS filename
(`index-BN0fio2P.js`), `X-Vercel-Cache: HIT`, `Age` climbing 1:1 with the
clock, `Last-Modified` frozen at 2026-09-15. Not a propagation-delay fluke:
confirmed stale after both deploys, ~15 min apart. The per-deployment preview
URL (`cc-review-n37jvwrs3-…vercel.app`) is behind Vercel SSO, so it could not
be checked directly from here. Contradicts the 2026-09-15 CLAUDE.md note that
push auto-deploys with no manual promote — needs a human on the Vercel
dashboard (Awaas-Suite's-projects → cc-review) to check the domain alias.

**T-014 (P2) — new e2e failure, not triaged.**
`e2e/strategy-regenerate.spec.ts` (2026-09-18, run 35335329352): the
"Generating… usually under a minute" button was never found within 5s, so
`toBeDisabled()` failed on a missing element. `history-journey.spec.ts`
stayed red on the same known issue as P1-CM-16/S1-E2E (a modal intercepts the
"Exit Wizard" click). Both advisory; CI's 4 required checks passed both runs.

**T-016 (R-A blocker) CLOSED on TEST/live 2026-09-22.** SMM Creatives now
persists a `tool_outputs` row (status `in_progress`) the moment the image
finishes generating — `generate()`, not `saveToLibrary()`. Post to
Instagram/Meta is gated on that id and now appears immediately, with no Save
click. `saveToLibrary()` reuses the same id (`UPDATE ... status='saved'`),
never a second `INSERT`; the `smm_calendar` insert (the actual scheduling
decision) still fires only on that explicit click. No migration; no frozen
surface touched.

Live evidence, ZZ-INTERNAL-TEST (e2e account): `tool_outputs` row
`7b247855…` created 4s after the image, `in_progress`; Save to Library
promoted the *same* id to `saved` (`created_at` unchanged, no duplicate row);
its own `smm_calendar` row landed only on that click.

Live evidence, Demo Builder (Saswat, one narrow authorised exception — see
below): "Post to Instagram" rendered immediately after generation, no Save
click; dialog opened with Instagram preselected, Dry run checked by default;
ran it → "Validated — nothing posted"; `published_assets` row `5eee453d…`
carries `tool_output_id` = the auto-saved row, `platform: instagram`,
`dry_run: true`, `published: false`, no `meta_post_id`.

**Demo Builder touched once, narrowly, with Saswat's explicit sign-off** —
step 12 needs a Meta-connected org and ZZ has none. Residue: one
`image_jobs` row (done), one `tool_outputs` row (`in_progress`, never
saved), one `agent_interactions` cost row, one `published_assets` dry-run
row (`published: false`). No `smm_calendar` row — Save to Library was never
clicked there. Left in place per the standing T5-4 rule (don't delete spend
history); flagged here rather than reversed.

**T-016a (deferred, unassigned phase):** SMM "Edit in Canva" — dropped from
T-016 by decision. The only existing Canva integration
(`canva-open-editor`, called from `CreativeViewer.tsx`) is hard-bound to
`creative_assets`, which SMM images deliberately don't have a row in. Needs
either a frozen-surface exception or a second provenance table for SMM
images; neither is authorized here.

**T-016b (deferred, Phase 3):** `tool_outputs.status` has no `'draft'` value
(`CHECK IN ('saved','in_progress','completed')`); adding one needs a
migration, out of scope for T-016. Auto-save uses `'in_progress'` as the
closest existing value. Phase 3: a real draft status plus Content Library
filtering by it.

**T-016 risk flagged, not fixed:** `enforceRetentionCap` (30 rows per
`(org, tool)`, evicts oldest regardless of status) now also counts every
abandoned/unsaved SMM generation, not just explicit saves — a busy org could
push a genuinely `saved` post out of the cap sooner than before. Shared
across every tool; not touched here.

**T-023 (P1, diagnosed 2026-09-22) CLOSED by D17.** [Renamed from an
earlier draft "T-017" — that ID is already Meta Ads.] Saswat, signed in as
the Meta reviewer on Demo Builder, hit "Generation failed: the image could
not be created" then got signed out, ~07:27Z. Root cause: `useAuth.ts:139`'s
`signOut` called bare `supabase.auth.signOut()` — no `scope`, so it defaulted
to `'global'` and revoked every refresh token for `saswat-review-admin`. My
T-016 evidence run (~07:15Z, same reviewer account, explicitly authorized)
signed out via the app's real Sign Out button ~11-12 minutes before his
generation. The error text is `SMMCreatives.tsx:198`'s generic catch
(pre-existing, not part of T-016), which overwrites any real thrown error —
uniquely reachable only from inside `runImageStep`, so his copy/caption step
(`aiCall`) must have succeeded first.

**H1 (global sign-out) vs H4 (project pause) — evidence favours H1, does not
support H4.** `image_jobs` since 07:00Z: exactly one row, mine
(07:12:41-07:14:53, done, no error); his ~07:27Z attempt created **no** row.
`agent_interactions` for Demo Builder in the same window: only my two rows
(07:12:40 text, 07:14:53 image) — none for his attempt, including no row for
a successful text call, even though the error text requires one to have
happened. Reconciled: `recordApiCost` (`src/lib/api-cost.ts`) writes that
ledger row client-side, fire-and-forget, unawaited — a failure there is
silent and wouldn't block `aiCall`'s return, so its absence doesn't refute a
successful text step; it just went unlogged. The image step's own first
authenticated call (`generate-image` invoke / its `image_jobs` insert) is
what actually failed, placing the token failure in the narrow window between
the text call succeeding and the image call starting — consistent with
Supabase's client-side proactive refresh timer firing mid-flow and hitting
the already-revoked refresh token.

Against H4: a paused project (confirmed directly — see the "unpaused"
exchange this session) fails uniformly at the gateway with a distinct
"Project paused" error on every request type, not a clean `SIGNED_OUT`
transition to the login screen, and not selectively (text call ostensibly
through, image call blocked). My own writes in this same project succeeded
cleanly up to ~07:15-07:16Z, ~11 minutes before his attempt — no gap in the
evidence trail suggests a pause bracketing 07:27Z specifically. `auth.sessions`
and `auth.refresh_tokens` hold **zero rows for this user** (`941f3596…`)
across their entire history, while both tables are well-populated for other
users — exactly what a `scope: 'global'` sign-out produces, and not
something a project pause would cause. `auth.audit_log_entries` has 0 rows
total on this project (audit logging not populated here) — unreachable as a
log source, not a data point either way.

**Fixed by D17** (`useAuth.ts:139` → `signOut({ scope: 'local' })`, this
commit).

## Decisions
D1a key panel on submissionId + clear result · D2a formatHashtag/normalize single owner; D2b DB trigger backstop in Ph2 migration · D3a mirror PROD cron on TEST · D4a fixed 6-chip intent taxonomy + Haiku-classified comment · D5a thresholds as R4 above · D6a rated/regenerated creatives exempt from 20-cap, ceiling 100/project, prune oldest unrated · D7a in-repo ports/adapters, extraction on second consumer · D8a threaded into phases · D15a **P1-CM-16**: the Playwright job targets the branch's GitHub Environment — `review-build`=TEST, `main`=PROD; `ws1-6-isolation` stays PROD.
**Storage-cost FYI to Rahul:** D6a raises worst-case per-project storage 5×.

## Standing rules added this phase
PROD reads via read-only role + psql, never `supabase link` · park by branch-carry, never stash · SQL in prompts must cite `\d` output or say "adapt to actual columns" · every user-visible-surface prompt carries [R-A IMPACT] until D9 logged. · any harness, script, or browser session that signs into a shared/reviewer account MUST call `signOut({ scope: 'local' })`, never the bare `signOut()` (SDK default is `scope: 'global'` — revokes every refresh token for that user, including sessions someone else is actively using).

## Skills to author (Phase 2 open, Sonnet) → .claude/skills/<name>/SKILL.md
- probe-prompt: template — read-only, freeze list, file:line + `\d` citations, hypothesis table SUPPORTED/REFUTED/UNTESTED, contradictions flagged not reconciled, ≤150-word summary.
- deploy-verify: push authorization → CI run ID → auto-deploy to `cc-review` → stamp match on alias → SQL/row evidence → mark CLOSED; refuse to mark done without stamp.
- test-triage: tester report → T-nnn; require env + build stamp; map to inventory ID or open new; assign class P0–P3 + phase; bounce reports lacking stamp.

## Phase 2 plan (next session — one chat)
Order: commit inventory + plan file → author 3 skills → PROD dump → T5-M alone (+A3, A5 probe, D2b trigger) → constraint-rejection probes → NEW-2 ALTER → NEW-3 + R1 schema → Opus schema gate → T5-1 build consuming retrieveMemory → cross-surface leak probe + bundle grep. All TEST-only; nothing deploys. Entry gate: D3a first tick evidence + branch-protection readout on screen.

## Phase 7 — Convergence
Praveshika convergence: M1 ports/adapters land, M2 meta-connect adapter is unfrozen, M3 token-broker contract replaces the stored system-user token (T5-8), and R6 surfaces what Aanya learned. Nothing in Phase 7 starts before R-A clears.
**R-01 (Phase 7):** `scripts/seed-internal-test-org.ts` hard-refuses any URL
without the PROD ref, so it cannot seed TEST's ZZ-INTERNAL-TEST org — on
2026-09-16 that org was created on TEST by hand-written SQL. Make the target
an explicit, per-environment input instead of a baked-in PROD guard.

## Session state 2026-09-11

S1 shipped and pushed: `b92781a` (image generates with the result, failures
visible), `398cdf0` (IG-first publish targets), `bf3a208` (CI Vitest env),
`ab96cd1` (docs). CI run **34488963957** — all four required checks green.
**Deploy is automatic**: a push to `review-build` auto-deploys to
`cc.awaas.world` (Vercel project `cc-review`). There is no manual promote step.
Stamp verification stays mandatory. Verified 2026-09-12: the alias serves
`ab96cd1` · 2026-09-10T14:25:38.204Z — the S1 docs commit, live with no
promote performed.

**CORRECTED 2026-09-22 (see T-013 below) — the "no manual promote step" claim
above is wrong as a standing fact.** It held once, on 2026-09-12. It failed
twice more in this repo's life, on 2026-09-18 and again on 2026-09-22 —
both times CI was green and Vercel's own records showed a successful deploy,
but `cc.awaas.world` kept serving the previous commit until Saswat promoted
by hand in the Vercel dashboard. Treat every deploy as needing a stamp check
and be ready to ask for a manual promote — see CLAUDE.md's Deploy rule.

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

## Session state 2026-09-15

Local head `06f2391`, branch `review-build`, tree clean, **8 commits unpushed**
(`d85daf2 567a3eb cecaeb7 c597cd3 23179ff 384d253 06f2391` + this one). Link is
TEST `yelmuykbqdyeikgbmkoq`.

Landed: `.temp/cli-latest` untracked; P1-CM-16 made canonical (`S1-E2E` its
alias); NEW-2 pinned to `queued|running|done|failed|timed_out` — `'done'` kept,
which removes the deploy-order hazard the gate flagged; NEW-3 pinned to
`token_expires_at timestamptz`; M3 + Phase 7 defined; plan file declared LOST
and this section authoritative. Three skills authored
(`probe-prompt`, `deploy-verify`, `test-triage`). P1-CM-16 probed, then fixed by
D15a (`384d253`) — **FIXED-UNVERIFIED, no CI run yet**. T-005 copy fix
`06f2391`.

**Stale above:** the 2026-09-11 P1-CM-16 bullet still reads OPEN; `384d253`
supersedes it. Left as written rather than reconciled.

**Not started:** gate steps 3–8 — PROD/TEST discovery `\d`, draft revisions,
`new4` publish-idempotency migration, TEST apply, cross-tenant probe, smoke.

**ACTION — credential exposure.** A PROD `service_role` JWT
(`ref mpvdpdxzqnidwyihyhbn`, exp 2036) and the DB password were pasted into the
2026-09-14 session transcript. **Rotate both.** They never reached a tool shell
and were not used. PROD reads still require the read-only role per
`docs/runbooks/db-access.md` — `service_role` is not that credential.

**Next:** step 3 discovery, then gate revisions → TEST apply → smoke.

## Session state 2026-09-16

TEST-only. Local, **unpushed**. Revised drafts in `619e88e`; five migrations
applied to TEST by psql, recorded in `schema_migrations`: `20260909120000` t5m,
`120500` a3_validate, `121000` new2 (+T-006a trigger), `122000` r1, `123000`
new4. 27 probes pass. Cross-tenant check passes: org A sees 0 org-B guideline
rows, UPDATE/DELETE on them hit 0 rows, a forged INSERT is rejected. A5 probe
row `4a23d769` deleted; provenance CHECK now VALID. TEST ZZ-INTERNAL-TEST org
created: `0a86b9b5-49b9-4590-9805-0ad427d451e9`; e2e project `b4a54bb5`.

**Blocked:** step 8 smoke — needs a signed-in TEST user. 9a profile link — no
internal-test auth user exists on TEST.

**Flagged, not reconciled:** `creative_assets` has an anon DELETE policy with
`USING (true)`. `review_events` now carries two identical INSERT policies and
parallel columns: subject_type/subject_id/ratings alongside
entity_type/entity_id/rating. Gate probe 6 is inverted by the `'done'` ruling.
`seed-internal-test-org.ts` refuses non-PROD, so the org was created with SQL.
The A5 VALIDATE is not a migration, so PROD needs it by hand.

## Phase 2 digest — CLOSED 2026-09-17

**Applied on TEST** (psql, recorded in `schema_migrations`, probes pass):
Phase 2 `20260909120000` t5m, `120500` a3_validate, `121000` new2 (+T-006a
`started_at` trigger), `122000` r1, `123000` new4. The A5 orphan was deleted and
the provenance CHECK is VALID. Also applied: `20260916121000` r1_cleanup (the
duplicate policy, plus R-02 as SQL). DOWN files exist for every migration.

**Security:** T-008 (`creative_assets` anon DELETE) and T-010
(`org_user_integrations`, `awaas_data_pool`, `chatbot_log`) are closed on
TEST. 0 policies on TEST are `true` or open to anon.

**Opened:** T-009 (retire the legacy `review_events` columns — writers first,
Phase 3, before R2/R3). T-011 (`chatbot_log` client-supplied text identity,
P1, Phase 3). The 9a side effect (orphaned Canva row) and the e2e
secret-identity check are recorded above.

**9a:** ZZ-INTERNAL-TEST org on TEST is `0a86b9b5-49b9-4590-9805-0ad427d451e9`;
the test user is `saswat-review-admin`. Step 8 smoke: not yet run.

**PROD:** nothing applied. `docs/decisions/phase7-prod-batch.md` is the only
ordered list. It is gated on the merge-readiness gate: Meta submission ID,
Phases 3–5 closed, reviewer sign-off, e2e green on `review-build`. CC PROD is
not hosted; PROD probes are cancelled permanently.

**Push manifest (held until the e2e secrets are confirmed):** 22 commits,
`d7cac49`…`190a0ae`, plus this digest.
## Phase 2 closing digest — 2026-09-18

**Applied to TEST**: 10 migrations (t5m, a3_validate, new2, r1, new4, T-008
`creative_assets` RLS fix, r1_cleanup, three T-010 RLS fixes). All probes
pass; PROD untouched, gated on `docs/decisions/phase7-prod-batch.md`.

**Security closed**: T-008 and T-010 removed every anon/`true` RLS policy on
TEST — verified with anon read/write/delete probes, then live in the browser
under the e2e account.

**T-012 (prompt truncation)**: the silent 4,000-char cut is now
`MAX_PROMPT_CHARS` (32,000, OpenAI's documented ceiling) plus
`prioritizeConstraints()`, which puts brand/negative/technical sections
ahead of prose. Before: all 6 measured Lead Gen prompts (5.4k–8.0k chars)
lost Sections 7–9. After: all present, even under a hypothetical 4k cut.
Verified live through the deployed `generate-image` (v27).

**T-007a/b**: SMM Creatives reads the org's brand kit instead of a
hard-coded palette (a); no prompt claims an unattached logo, reserving space
instead (b). Both verified live — correct brand colours, empty logo corner,
across two separate browser generations.

**T-006a**: `image_jobs` transitions to `running` before the provider call,
stamping `started_at` — duration now derivable, verified live on 2 real
jobs. Failures classify into `provider_5xx`/`provider_timeout`/`unknown`.
**T-006b (new, open)**: the reaper's wider running-catching migration
(`20260918120000`) is committed but not yet applied to TEST.

**T-013**: `cc.awaas.world` was pinned to a pre-demo promote (`ab96cd1`),
not a broken pipeline — Saswat re-promoted in the Vercel dashboard.
**T-014**: fixed — a stale copy-matched selector, not a regression.

**Still open**: T-006b, T-007c/d, T-009, T-011. H1 golden reference images
(`scripts/eval-refs/`) remain absent — blocks T-007c and T5-6.


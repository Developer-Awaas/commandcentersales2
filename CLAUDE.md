# CLAUDE.md — Command Center V2 Integration Context

> Place this file in the repo root. Claude Code reads it automatically for project context.

## IMPORTANT — Keep this file current
**Every time you modify the codebase** (new component, changed flow, new edge function, schema change, new rule discovered) **update the relevant section of this file before finishing the task.** This is the single source of truth for future Claude sessions. Stale context causes wrong assumptions and rework. **A merged commit is not a deployed fact** — "complete" claims about server-side behavior must be verified against what's actually live (`gh run list --workflow=deploy-functions.yml`, or the live behavior itself), not just against source. See "Phase 5" below for the incident that motivated this rule.

---

## Project

Command Center V2 — AWAAS Services Pvt Ltd. Real-estate marketing SaaS.
Stack: React + TypeScript, Supabase (Postgres + Edge Functions + Auth + Storage + Realtime).

---

## Active Integrations

### 1. Meta Marketing API (auto-fetch campaign stats)
- Edge Function: `supabase/functions/meta-insights-sync/`, runs on pg_cron every 15 min.
- Writes to `campaign_metrics` (tagged with `project_id` when per-project accounts are configured).
- API: `https://graph.facebook.com/v21.0` — always async POST jobs, never sync GET.
- Rate limit header `X-FB-Ads-Insights-Throttle` — back off if `acc_id_util_pct > 75`.
- Token stored org-level in `org_integrations.meta_access_token` (one System User token covers all accounts under the Business Manager — never per-project).
- **Ad account ID (per-project)**: `projects.meta_ad_account_id` (nullable text, migration `20260622030000`). Sync checks projects with this set and syncs each separately, tagging rows with `project_id`. Falls back to `org_integrations.meta_ad_account_id` (org-level, no project tag) when unset.
- **`act_` prefix**: `meta_ad_account_id` must always be `act_<numeric_id>`. `SettingsPage.tsx`/`ProjectForm.tsx` normalize on save — do NOT strip this in the sync function.
- **Error surfacing**: `syncAccount` throws on Meta API errors (after logging to `integration_sync_log`); the outer loop returns them in the JSON body as `{ status: 'error', error: '...' }`. `SettingsPage.triggerMetaSync` shows real errors, not just Supabase-level ones.
- **Sync levels**: `level: 'campaign'` (main) + `level: 'ad'` (fire-and-forget via `syncAdMetrics`). Ad-level still uses the org-level `meta_ad_account_id`, not yet per-project.
- **Required Meta permissions**: `ads_read`, `ads_management`, `business_management`, `pages_read_engagement`. System User tokens recommended. Setup guide is a collapsible panel in `SettingsPage.tsx`.
- **Future — multi-account manager**: when an org runs 10+ projects across separate ad accounts, replace `projects.meta_ad_account_id` with an `org_ad_accounts` table + junction table (backfill steps documented in migration `20260622030000`'s comment). Do not implement until volume justifies it.

### 2. Image Generation (creative variants)
- Client-side: `src/lib/gemini-service.ts` (`generateImageWithGemini`/`uploadGeminiImageToSupabase`) is now the **only** image-generation path for both `Creatives.tsx` (Nanobanana 3-variant flow) and `CreativeViewer.tsx` (own simpler template-based prompt, `buildCreativeImagePrompt` local to the component — brandKit/projectContext there carry far less detail than the senior-designer system). The old `generate-creatives` Edge Function (legacy Imagen 3 model, server-side, used only by `CreativeViewer`, wasted 2/3 of its output on every single-angle regenerate) was deleted — deprecated in favor of routing `CreativeViewer` through the same client-side service Creatives.tsx uses, so it inherits `MOCK_AI_ENABLED` and `SINGLE_IMAGE_TESTING_MODE` for free. **Note**: `uploadGeminiImageToSupabase`'s built-in funnel-stage mapping only understands Creatives.tsx's TOFU/MOFU/BOFU vocabulary (its lowercase awareness/consideration/conversion map keys are dead code, unreachable due to a `.toUpperCase()` call before the lookup) — `CreativeViewer.tsx` works around this by not passing `funnelStage` into that helper at all, instead setting `creative_assets.funnel_stage` directly via a follow-up `.update()` since its own `funnelStage` prop is already correct DB vocabulary. Fix the mapping itself if a third caller ever needs it.
- Model: **OpenAI GPT-Image-1** via `generate-image` Edge Function (avoids browser CORS, keeps `OPENAI_API_KEY` server-side). Returns `data[0].b64_json` directly. Sizes: square→`1024x1024`, portrait→`1024x1536`, landscape→`1536x1024`. Quality: `low|medium|high`.
- **Prompt format — Aanya's 9-section structure**: flowing prose (500–800 words) — scene narrative → composition % → camera/lens → lighting/Kelvin → color palette (hex) → typography layer (text rendered directly into the image, no CSS overlay) → brand elements → negative prompts → technical specs. Reference example (Neelachala Homes style) lives in `senior-designer-prompts.ts`.
- `generateImageWithGemini()` → `supabase.functions.invoke('generate-image', {...})` → `{ base64, mimeType }`. `creative_assets.model_used = 'gpt-image-1'`.
- **Reference images (QuickReferenceUploader)**: uploaded to `quick-references` bucket; `Strategy.tsx` runs `describeImageForFlux()` (Claude Haiku vision) on each before `buildQuickGenerateBrief`, storing the description in `QuickReference.visual_description` for `buildReferenceManifest()` to inject.
- **Project media (`project_assets`) vision enrichment**: a bare `asset_url` in a text prompt is invisible to a text-to-image model — `ProjectAsset.visual_description` must be populated (client-side only, the DB has no such column) for a reference photo to have any effect. `Creatives.tsx`, `Strategy.tsx` Quick Generate, and Strategy's Full Strategy path all run the same fetch-project_assets → `describeImageForFlux()` on `hero_exterior`/`interior_*`/`amenity_*` → enrich block inline. **No shared helper exists yet** — three near-identical copies; extract one if a fourth entry point appears.
- `generateImageWithGemini` accepts `aspectRatio: '1:1'|'9:16'|'4:5'` and `quality` (default always `'high'`). `1:1`→1080×1080, `4:5`→1080×1350, `9:16`→1080×1920.
- **Strategy page (SeniorDesignerResultPanel)**: 3 images from 3 distinct layout-paradigm prompts — Feed (1:1, `nanobanana_prompt_main`, graphic-design frame), Portrait (4:5, `nanobanana_prompt_portrait`, photorealistic scene), Story (9:16, `nanobanana_prompt_story`, typography-forward). Falls back to `nanobanana_prompt_main` if portrait/story absent.
- **Creatives page**: 3 images from 3 variant prompts, each 1:1 (value/lifestyle/amenity angles).
- Deterministic storage path so edits overwrite the same file: `generated-creatives/{orgId}/{sessionId}/{angle-slug}.{ext}` in bucket `brand-assets`. `uploadGeminiImageToSupabase` returns `{ url, id, storagePath }` and inserts a `creative_assets` row (`creative_id` FK links to parent `creatives` row). Angle map: 'Price-led with Urgency'→`value`, 'Lifestyle / Aspirational'→`lifestyle`, 'Trust & Legacy / Amenities'→`amenity`. Funnel map: TOFU→`awareness`, MOFU→`consideration`, BOFU→`conversion`. All 3 images from one click share one `session_id`.
- Prompt templates: `src/lib/senior-designer-prompts.ts`.
- **Text-overlay layer system**: ad copy (headline/price/CTA) is ALSO rendered as an app-controlled, editable overlay stored in `creative_assets.text_layers` (jsonb) — independent of whatever Section 6 bakes into the image. See "Text-Overlay Layer System" below. `ad-compositor.ts` was removed (superseded, zero prior callers).

### 3. Claude API Proxy (`claude-proxy` Edge Function)
All client-side Claude/Anthropic calls route through `supabase/functions/claude-proxy/index.ts`. `ANTHROPIC_API_KEY` is a Supabase Edge Function secret — never a `VITE_` var, never in the client bundle.
- **Client callers**: `aiCall()`, `aiVision()`, `describeImageForFlux()` in `src/lib/ai-service.ts`. `isAiEnabled()` returns `true` unconditionally.
- **Direct-invoke callers** (bypass `ai-service.ts` helpers): `Analyzer.tsx` (`_beta: 'web-search-2025-03-05'`) and `AanyaMemory.tsx` (`analyzeCreativeWithVision`).
- **`_beta` field**: forwarded as the `anthropic-beta` header; stripped before forwarding to Anthropic.
- **Deploy**: `supabase functions deploy claude-proxy` + `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`.

### 4. External Editors — Edit-in-Place Flow
**Adobe Express** — `src/components/AdobeExpressModal.tsx`, Embed SDK v4, `onPublish` returns edited base64. With `storagePath`: overwrites the original file (`upsert: true`), updates `creative_assets.image_url`. Without (legacy `CreativeViewer` path): creates a new `/edited/` file, updates `edited_image_url`. `ImageGalleryViewer` updates local state after save — no download needed.

**Canva** — per-user OAuth (`org_user_integrations`). `canva-open-editor` uploads asset, creates design, returns `{ editUrl, designId }`. `canva-sync-design` exports via `POST /v1/exports`, downloads PNG, overwrites the original storage path. `canva-oauth-callback` handles the OAuth redirect. Sync from Canva is fully automatic — no manual "Sync" button; `ImageGalleryViewer` shows a non-interactive "Syncing from Canva…" status while it's in flight.

> **How the Canva edit flow works end-to-end (see bug #45 below for the full incident writeup)**
>
> 1. **Cold start (Canva not yet connected)**: "Edit in Canva" opens a blank tab *synchronously* (before any `await`, so the browser can't strip "user activation"), then navigates it to Canva's OAuth screen in a **popup** — an iframe is impossible (Canva sends `X-Frame-Options: SAMEORIGIN`), and the popup's completion signal goes through `localStorage`'s `storage` event, never `window.opener` (Canva's `Cross-Origin-Opener-Policy: same-origin` severs that reference the instant the popup navigates to Canva's domain). The popup identifies itself with certainty via an `&via=popup` marker baked into `returnUrl` — never inferred from `window.opener`/`window.close()`, both unreliable — and never renders the real app, regardless of whether it manages to close itself (a known, likely-permanent browser limitation once a popup's history spans multiple pages). Falls back to a real same-window redirect if the popup can't even open, made safe by the DB-backed resume in step 4.
> 2. **Already connected**: same synchronous-tab trick, but navigates straight to the real Canva editor (`editUrl`) — no popup dance, just a plain new tab.
> 3. **Editing finishes — Canva's "Return Navigation" feature** (a *completely separate* mechanism from OAuth — a single fixed return URL configured once in the Canva Developer Portal, already enabled for this integration). `edit_url` carries a `?correlation_state=${page}:${creativeAssetId}` marker this app sets (50-char cap). Clicking "Return" inside Canva's editor sends that same tab to `{returnUrl}?correlation_jwt=...` — a signed JWT that `canva-verify-return-nav` verifies against Canva's JWKS before trusting anything in it. On success, the tab signals the opener via `localStorage` and the **opener auto-runs the sync for that specific image** — no manual click, which is why no manual Sync button exists.
> 4. **DB-backed resume**: if the cold-start path falls back to a same-window redirect, `Strategy.tsx`'s landing effect reconstructs the entire Strategy result (text + images) from `creatives.senior_designer_brief` + `creative_assets`, keyed by the resumed creative's id — nothing is actually lost even on a full page reload, because it was persisted to the DB before the user ever reached the edit step in the first place.

**Download**: always available as fallback.

---

### 5. LeadGen V2 ("Aarav Agent") — feature-flagged multi-agent workspace

Split-pane agent workspace. Gated behind `LEADGEN_V2_ENABLED` (`src/lib/feature-flags.ts`, reads `VITE_LEADGEN_V2_ENABLED`, default `false`). Gated at `src/App.tsx` (route fallback) and `Sidebar.tsx` (nav item). Old pages (Strategy, CampaignWizard, etc.) remain accessible when the flag is on — not deleted.

- Page: `src/pages/leadgen-v2/index.tsx` — left 360px conversation thread (`AaravThread`), right canvas (`BrandCheckCard` → `StrategyCard` → `CreativeGrid`), footer `ApprovalBar`. Full contract, invariants, and file map: `src/pages/leadgen-v2/README.md`.
- `useAgentSession.ts` calls the real `aarav-orchestrate` Edge Function (no mock). `sendMessage`/`regenerateCreatives`/`requestChange` share one `inFlightRef` guard; `approveTurn` uses a separate `approveRef` — a double-click can never double-write the cost ledger or memory tables.
- `useProfileMode.ts` reads `profile_tier` from `localStorage` (client display), also stored server-side in `profiles.tier` (cost-ceiling source of truth, migration `20260620000000`). Tiers: `profile_1`/`profile_2`/`profile_3`. `profile_1` collapses to a single neutral "Working on it…" spinner and unattributed canvas cards; `profile_2` shows named-agent delegation chips.
- **Per-interaction budget cap**: `_shared/tier-config.ts` holds cost ceilings per tier (`$0.85`/`$3.00`/`$10.00`). Enforced in `aanya.ts` via `BudgetTracker` — reserve happens synchronously before each `await generateImage` (race-free in single-threaded Deno). On exhaustion: best-of-current returned, `agent_turns.cap_hit = true`, Langfuse `budget-cap-hit` span logged. Monthly volume quota is not implemented — this is anti-runaway only.
- `src/lib/access.ts` maps `'leadgen-v2': 'strategy_quick'` for per-profile module visibility — unrelated to the feature flag itself.

#### Phase 5 — Realtime turn tracking, approval gate, memory write

Complete in source and **confirmed deployed** (2026-07-21, after a real incident — see below). New tables (migration `20260617120000`): `agent_turns` (one row per invocation, Realtime target, `delegations jsonb`), `agent_messages` (conversation log), `agent_memory` (approved decisions, written on `action='approve'` only). `agent_turns.cap_hit` (migration `20260620010000`).

**Approve invariants — all three required**: (1) UI guard, Approve button disables the instant `approveLoading` goes true; (2) hook guard, `approveRef` blocks a second request even on delayed state update; (3) server guard, `handleApprove()` returns early with no DB write when `approved_at IS NOT NULL`.

**No Meta launch**: `action='approve'` sets `status='ready_to_launch'` only — do NOT change to `'approved'` without a real Meta campaign-create call first.

**Wall-clock**: Supabase caps at 150s (platform default); Aanya's loop is parallelised (`Promise.allSettled`), worst case ≈100–130s. Migration `20260617130000` pg_cron marks turns stuck >10min as `'failed'`.

**Deployment incident (2026-07-21)**: `deploy-functions.yml` had exactly one run in its history and it failed (`401` from the Supabase Management API — expired `SUPABASE_ACCESS_TOKEN`, rotated 18 min after the failure but never re-verified). Result: `aarav-orchestrate` silently ran pre-Phase-5 code in production for ~a month — `action:'approve'` fell through to a normal `send_message` turn instead of hitting the approve dispatch. Found while building WS1.6 isolation-harness probe 7. **Fixed**: rotated token confirmed via `workflow_dispatch` manual redeploy (green in 35s); re-ran the isolation suite, 9/9 passed including probe 7 (`handleApprove`'s org-scoped `agent_turns` filter, index.ts ~line 758) both locally and in CI (run `29828405683`). This is why the "keep this file current" note above now says a merge isn't a deploy — check this before trusting any future "Phase N complete" claim for anything security- or correctness-sensitive.

#### Aarav's specialists — server-side only, never reachable from `src/`

`aarav-orchestrate` (`supabase/functions/aarav-orchestrate/index.ts`) is the **only** Edge Function the client calls. It fans out server-side to `supabase/functions/_shared/agents/` — none of those are routable Edge Functions and none may ever be imported under `src/`. **`org_id` is never trusted from the request body** — derived from `auth.getUser()` + a `profiles` lookup, then threaded through as the server-resolved value everywhere, including a manual re-filter on the service-role client for the approve path (see Phase 5 above).

- **Arjun** (`arjun.ts`) — strategist. One Sonnet 4.6 call → `StrategyConfig`. Runs first on every normal turn.
- **Aanya** (`aanya.ts`) — creative director. Runs after Arjun, produces 3 `CreativeVariant`s (value/lifestyle/amenity), each with a placeholder `brand_check` that **`aarav-orchestrate` always overwrites** with Diya's real verdict before reaching the user.
  - **Self-critique loop**: one ideation call → per angle: generate image → cheap critique call (scores the *prompt + copy*, not pixels) → regenerate on reject. **Hard-capped at 3 iterations/angle** — non-convergence uses best-of-N, never an error.
  - Image generation always goes through `_shared/image-provider.ts` — never constructs a provider request directly.
  - **Cost tracking**: `RunAanyaResult.totalCostUsd` sums the entire loop (ideation + every critique + every image gen), not just the accepted pass.
  - Images upload to `generated-creatives/{orgId}/{runId}/{angle}.{ext}` in `brand-assets`.
  - **Regenerate flow**: `AgentRequest.regenerate_creatives` re-runs just Aanya (`handleRegenerateCreatives()`), a separate path from the normal turn. Omit `angle` to regenerate all 3; the other 2 (`keep`) are echoed back with their already-real `brand_check`, never re-sent to Aanya.
- **Diya** (`diya.ts`) — brand manager, two functions:
  - `runBrandConfirm({ orgId, projectId })` — deterministic `brand_kits` lookup (org-scoped, no LLM). `brand_kits` is one row per org (`UNIQUE org_id`, no `project_id` column) — `projectId` is threaded through for a future per-project override, unused today. No kit → `{ status: 'flag', ... }`, never a crash. Runs before Arjun on every turn (including regenerate) so `canvas.brand` is always populated.
  - `runBrandCheck({ orgId, projectId, variants, traceId, kit? })` — Sonnet 4.6 **with vision**, one call per variant (image passed by URL, never re-uploaded). No kit → flags every variant, zero LLM spend. A single variant's vision call failing flags only that variant, never silently passes.
  - **Orchestrator wiring** (`applyBrandCheck()`): called unconditionally on every batch of new variants — **invariant: no Aanya creative reaches the user without passing through this.** If `runBrandCheck` itself throws, every variant in that batch is fail-safe flagged rather than left at Aanya's placeholder `'pass'`.
  - `status: 'pass' | 'flag'` — `flag` is advisory only; `CreativeGrid` keeps flagged tiles selectable. Hard governance blocks are a future phase.
- **Kavya** (`kavya.ts`) — content strategist. `detectKavyaIntent()` in the orchestrator runs before the Arjun→Aanya chain; SMM/content messages route here, campaign messages don't.
  - `'plan'` (Sonnet, 4096 tok) — 30-day SMM calendar, bulk-inserted into `smm_calendar` on success (insert errors logged, non-fatal).
  - `'caption'` (Haiku, 1024 tok) — single platform-optimised caption + hashtags.
  - `'reel'` (Haiku, 1024 tok) — 3-section reel script, no DB write.
  - Cost logged to `agent_interactions` as `agent: 'kavya'`. Client canvas rendering for Kavya turns is not yet implemented — turns show Aarav's text message only, canvas JSON sits in `agent_turns.canvas` for future UI.
- **Dhruv** (`dhruv.ts`) — analyst, read-only (never changes campaign settings). `detectDhruvIntent()` checked before Kavya and Arjun→Aanya.
  - `'reactive'` (Sonnet, 2048 tok) — conversational insight + optional `delegate_suggestion` (`'arjun'|'aanya'|null`).
  - `'report'` (Sonnet, 4096 tok) — full monthly narrative report.
  - `'dashboard'` (Haiku, 512 tok) — 3-5 severity-coloured cards.
  - **Pre-computation invariant**: `buildMetricsContext()` (`_shared/metrics-query.ts`, pure SQL, no LLM cost) runs BEFORE the LLM call and before the Arjun→Aanya chain (cross-agent enrichment). Dhruv narrates a `MetricsContext` JSON, never sees raw rows — every number he cites is verifiable.
  - **Alert checks** (threshold, no LLM): CPL spike (7d avg > 1.5× 30d avg, high), ad fatigue (frequency > 2.5, medium), CTR drop (7d avg < 70% of 30d avg, medium). No overspend alert — `campaign_metrics` has no budget column.
  - **Background job**: `dhruv-anomaly-check/index.ts`, pg_cron hourly, `--no-verify-jwt`, zero LLM cost — high-severity alerts insert one deduplicated `notifications` row per org per day.
  - **Dashboard cards** (`DhruvInsightCards.tsx`) call `buildMetricsContext()` client-side directly (zero LLM on load); Dhruv's LLM fires only on a conversational question.
  - Cost logged to `agent_interactions` as `agent: 'dhruv'`.
  - Seed script: `scripts/seed-dhruv-test-data.ts` — 31 days synthetic data, 3 campaigns, intentionally triggers CPL spike + ad fatigue. Cleanup: `DELETE FROM campaign_metrics WHERE campaign_id LIKE 'seed-%'`.
- **Prompt versioning**: `_shared/agents/prompts.ts`, `loadAgentPrompt('arjun'|'aanya'|'diya'|'kavya'|'dhruv')`. All bodies are **PLACEHOLDER v1.0** — establish the JSON contract; real prompt engineering is a separate pass. Aanya's critique sub-prompt loads via `loadAanyaCritiquePrompt()`.
- **JSON parsing**: every specialist uses `parseJsonObject()` (`_shared/agents/json-extract.ts`, brace-depth scanner + fence stripping) — never raw `JSON.parse` on LLM output.
- **Langfuse**: every specialist LLM/image/vision call logs as a `GENERATION` (never a bare `langfuseSpan`) nested under the parent trace via `traceId`. Diya's confirm step (a DB lookup, not a model call) is the one exception — logged as a `langfuseSpan`. Image bytes never sent to Langfuse.
- **Failure handling**: a failed specialist sets `DelegationStatus: 'failed'`, logs an `ERROR` generation, still writes `agent_interactions` if tokens were spent, and the client gets an Aarav-voiced fallback — raw errors never reach the response. Arjun failing aborts the turn; Aanya failing after Arjun still returns his strategy (creatives retriable via Regenerate); Diya failing returns Aanya's creatives, all fail-safe flagged.

#### Image generation provider abstraction (`_shared/image-provider.ts`)
`generateImage({ prompt, size?, quality?, providerHint?, traceId?, observationName? })` is the **only** place that constructs an image-generation API request — both `generate-image/index.ts` and `aanya.ts` call this, never OpenAI/Gemini directly. Two providers wired: **OpenAI GPT-Image-1** (default) and **Gemini 2.5 Flash Image** (`providerHint: 'gemini'`, server-side `GEMINI_API_KEY` — distinct trust boundary from the client-side `VITE_GEMINI_API_KEY` used by the deprecated Imagen 3 path). Provider selection: env var `IMAGE_PROVIDER`, default `'openai'`. A third provider means a new switch case + `ImageProvider` union member, no caller changes.
- `describeImageForFlux` (`ai-service.ts`) is **not** an image generator — a Claude-vision helper describing an existing uploaded image for prompt enrichment. Flux is never called as a generator in this repo.
- Returns `{ imageBase64, mimeType, providerUsed, costMeta }` — `unitCost` is approximate, good for cost-tracking, not invoicing-grade.
- API keys read from `Deno.env` inside this module only.
- One-off benchmark: `benchmark/image-providers.ts` (not deployed) — see file header for usage.

#### `agent_interactions` table (cost ledger)
Migration `20260616080000`. One row per specialist run per orchestrator invocation: `org_id, user_id, agent, trace_id, model, input_tokens, output_tokens, cost_usd, created_at`. Aarav writes a zero-cost stub row per turn. Diya's `runBrandConfirm` (no model call) writes no row; `runBrandCheck` writes one row aggregating the batch. RLS: org-scoped SELECT only; writes always via the service-role client in `aarav-orchestrate`.

---

### 6. Langfuse — LLM observability
All LLM calls trace to Langfuse (project AWAAS, `https://us.cloud.langfuse.com`). No-ops cleanly if `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` aren't set. `LANGFUSE_SECRET_KEY` is a Supabase Edge Function secret, never a `VITE_` var (same rule as the other API keys in this doc).

**Shared client**: `supabase/functions/_shared/langfuse.ts` — hand-rolled against `POST /api/public/ingestion` (lighter than the OTel SDK for a short-lived Deno isolate). Exports `langfuseTrace` (one per request/flow), `langfuseGeneration` (actual LLM calls — always this, not `langfuseSpan`, for cost/token analytics), `langfuseSpan` (non-LLM orchestration steps only).

**Server-side**: `aarav-orchestrate` traces per orchestration call (tagged `['leadgen-v2', 'aarav']`); `generate-image/index.ts` traces per image.

**Client-side** (`src/lib/ai-service.ts`): anything through `aiCall`/`aiVision`/`describeImageForFlux` traces automatically. Since the Langfuse secret can't ship to the browser, these route through `langfuse-ingest` (requires a valid Supabase Authorization header, forwards using its own server-side secret, scrubs `sk-ant-...`/`sk-lf-...`/`Bearer ...` substrings defensively). `logToLangfuse()` is fire-and-forget (`.catch()`-swallowed — a tracing failure must never surface to the user). `getBrowserSessionId()` (one UUID per tab) groups multi-step flows into one Session. Vision messages are redacted to `[redacted image data]` before sending.
- `AanyaMemory.tsx`'s `analyzeCreativeWithVision()` calls `claude-proxy` directly (not via `aiVision`) and traces as `aanya-memory-vision-analysis` via an inline `logToLangfuse` call.
- High-value call sites pass an explicit `traceName` (`strategy-quick-generate`, `creatives-variant-generate`, etc.). Other call sites still get traced automatically under the default `claude-call`/`claude-vision` name — add an explicit `traceName` next time you touch one of those files.

**Adding tracing to a new LLM call site**: client call through `aiCall`/`aiVision` → nothing to do, optionally pass `traceName`. Client call bypassing `ai-service.ts` → import `logToLangfuse`, call after the response, redact images first. New server-side Edge Function → import `langfuseTrace`/`langfuseGeneration` from `_shared/langfuse.ts`.

---

## Image Generation Provider — Switching Guide

> Current: **OpenAI GPT-Image-1**. History: DALL-E 3 → NVIDIA NIM FLUX.1-schnell (unreliable, commit `dbab464`) → Google Gemini Imagen 3 (commit `01090f9`) → GPT-Image-1.

**Current approach**: text (headlines, pricing, CTAs, feature boxes) is rendered directly into the image via Section 6 of the 9-section prompt, matching professional real-estate ad standards.

**Known unreliability**: a controlled A/B test (same brief, "₹ only, never $" repeated in system prompt + both stages) still produced a `$` price instead of `₹`, for both Sonnet- and Haiku-authored prompts. This is a GPT-Image-1 rendering-level failure, not a prompt-writing one — Claude never touches pixels, so no amount of prompt engineering guarantees compliance. This is why the text-overlay layer system exists as a reliable parallel path (below); Section 6 itself is intentionally unchanged.

**Two-stage generation** (`buildTwoStageQuickGenerateBrief`/`buildTwoStageVariantBriefs` in `senior-designer-prompts.ts`): splits what was one ~16000-token call into Stage 1 (concept + ad copy + `visual_anchor`, 1500 tok) → Stage 2 (3 parallel per-layout calls, 700-800 tok each). ≈35-40s total vs. the old single call's ~65s — dodges the `claude-proxy` 120s timeout. `visual_anchor` is a literal 60-100 word building description from Stage 1 that every Stage 2 call must reproduce verbatim — fixed cross-image architectural inconsistency (each of the 3 independent Stage 2 calls was previously free to invent its own building).

**Why 9 sections**: GPT-Image-1 responds well to prose divided into clear functional sections (scene → composition → camera → lighting → color → text-render → brand → negatives → tech specs) — architectural clarity for both visual intent and typographic requirements. Same format as the original Imagen 3 prompts (`git show 24347b2:src/lib/senior-designer-prompts.ts`).

**To revert to a previous provider**:
- **Imagen 3**: `git show 01090f9` for `gemini-service.ts`; prompts at `git show 24347b2:src/lib/senior-designer-prompts.ts`. Requires `VITE_GEMINI_API_KEY`; drop the `generate-image` Edge Function call.
- **DALL-E 3**: `model: 'gpt-image-1'` → `'dall-e-3'`, portrait size `1024x1536` → `1024x1792`, quality `'low'|'medium'|'high'` → `'standard'|'hd'` in `generate-image/index.ts`.

**Provider-agnostic, keep regardless of active model**: the storage path + deterministic upsert pattern; `creative_assets.model_used` (update to match); the text-overlay layer system (layers on top of any background image).

---

## Text-Overlay Layer System

**Why**: Section 6 baking text into the image is unreliable at the pixel-rendering level (see above) — no prompt engineering fixes it since Claude never touches pixels. This gives the app a reliable, editable, app-controlled alternative for the same text.

**Scope (Phase 1 of 2)**: additive only — the AI image still renders baked text as before; the overlay is a second, independent layer. A future pass may simplify Section 6 to "reserve negative space" and stop baking text at all — real image-style risk (the Neelachala-style frame layout is partly built around baked typography), needs its own A/B validation first.

**Why not Canva's text elements**: investigated and ruled out. Canva's Connect API `POST /v1/designs` only accepts `asset_id` — the image becomes an opaque background with no way to seed separate text elements without a pre-built Brand Template + Autofill API (not implemented). `canva-sync-design`'s export is always a flattened raster PNG too.

**Data model**: `creative_assets.text_layers jsonb` — array of `TextLayer` (`src/lib/text-layers.ts`): `{ id, text, xPct, yPct, widthPct?, fontSizePx, fontWeight, color, align, backgroundColor?, paddingPx?, borderRadiusPx? }`. Authored against `TEXT_LAYER_REFERENCE_WIDTH` (1080px), scaled to actual display/export width at render time.

**Files**: `src/lib/text-layers.ts` (`TextLayer` type, `buildDefaultLayers()`, `renderTextLayers()` → canvas compositor, flat JPEG for Download). `src/hooks/useMeasuredWidth.ts` (shared `ResizeObserver` hook so preview and editor scale identically). `src/components/TextLayerOverlay.tsx` (read-only preview, used by `ImageGalleryViewer` + `CreativeViewer`). `src/components/TextLayerEditor.tsx` (drag-to-reposition modal, toolbar, Save persists `text_layers`).

**Seeding**: `StrategyResult.tsx` and `Creatives.tsx`'s upload loop both call `buildDefaultLayers` right after upload, fire-and-forget `.update({ text_layers })`. Every newly generated creative starts pre-populated and editable.

**Download**: both viewers check `textLayers?.length` — bake via `renderTextLayers` if present (dimensions parsed from the layout label / hardcoded 1080×1080 for `CreativeViewer`), else raw download.

---

## Key Tables

RLS org-scoped on every table (`org_id = get_current_user_org_id()`, `TO authenticated` only, anon access removed — migration `20260610150000`). `profiles` has a BEFORE UPDATE trigger blocking self-privilege escalation on `role`, `module_access`, `daily_ai_limit`, `org_id`. **36 tables have RLS enabled** (verified directly via `grep 'ENABLE ROW LEVEL SECURITY' supabase/migrations/*.sql`, not just asserted).

| Table | Migration | Purpose |
|---|---|---|
| `organizations` | `20260609120000` | Org identity + brand settings |
| `profiles` | `20260409085002` | Auth user profiles — org_id, role, module_access, `tier` (default `'profile_2'`). Trigger auto-creates on signup |
| `projects` | `20260409123924` | Real-estate projects per org |
| `campaigns` | `20260409123924` | Ad campaigns per project |
| `daily_metrics` | `20260409123924` | Daily ad spend/leads/clicks/impressions |
| `notifications` | `20260409123924` | Per-user in-app notifications |
| `ai_sessions` | `20260409123924` | AI interaction log. `project_ids uuid[]`. Token columns: `claude_input_tokens`, `claude_output_tokens`, `gemini_images_generated` |
| `activity_log` | `20260411063514` | Audit trail of user actions |
| `awaas_data_pool` | `20260411084151` | AWAAS market data reference pool |
| `targeting_keywords` | `20260415072948` | Ad targeting keywords per project |
| `chatbot_log` | `20260429081859` | AIChatbot conversation history |
| `campaign_metrics` | `20260604120000` | Auto-fetched Meta Ads stats (pg_cron every 15 min) |
| `creative_assets` | `20260604120000` | Generated images + editing lifecycle. `session_id uuid` groups 3-image sets. `text_layers jsonb` — see Text-Overlay Layer System |
| `org_integrations` | `20260604120000`, admin-gated RLS `20260722100000` | Org-level API tokens (Meta, Google). SELECT/INSERT/UPDATE require `profiles.role='admin'` for the acting user — not just org membership (bug #42) |
| `org_user_integrations` | `20260604120000` | Per-user OAuth tokens (Canva) |
| `integration_sync_log` | `20260604120000` | Audit trail for sync attempts |
| `competitors` | `20260609130000` | Competitor names per org. UNIQUE (org_id, name) |
| `brand_kits` | `20260609130000` | Design system per org. **One row per org, no `project_id` column** |
| `lead_funnel` | `20260609130000` | Weekly lead funnel metrics. `project_id uuid` enables join with `ai_sessions` on org_id + project_id + ISO week |
| `organic_plans` | `20260609130000` | AI-generated weekly organic social plans |
| `events_calendar` | `20260609130000` | Holidays/festivals/custom events for SMM planning |
| `smm_calendar` | `20260609130000` | Scheduled social media posts |
| `smm_metrics` | `20260609130000` | Daily Instagram/Facebook snapshots. UNIQUE on (org_id, platform, date) |
| `wizard_sessions` | `20260609130000` | Campaign Wizard multi-step session state |
| `project_assets` | `20260609130000` | Reference images per project |
| `project_design_systems` | `20260609130000` | Learned creative DNA per project. UNIQUE on project_id. `prompt_fragments jsonb` |
| `benchmarks` | `20260609130000` | KPI benchmarks per org/project (7d/14d rolling) |
| `creatives` | `20260609130000` | AI-generated ad creative records |
| `creative_performance` | `20260609130000` | Metrics linked to individual creatives |
| `agent_turns` | `20260617120000` | One row per orchestrator invocation. Realtime target. `delegations jsonb`. `approved_at IS NOT NULL` = idempotency sentinel. `cap_hit boolean` |
| `agent_messages` | `20260617120000` | Per-turn conversation record, written on every turn completion |
| `agent_memory` | `20260617120000` | Approved campaign decisions, written on `action='approve'` only. **DO NOT add columns here** — semantic search is `agent_memory_chunks` |
| `agent_memory_chunks` | `20260625120000` | pgvector memory layer. `embedding vector(1024)` nullable (fail-soft). `scope memory_scope` enum: decision/project/builder/domain/shared/agent. RPCs `match_memory_chunks` (hybrid scorer, SECURITY INVOKER) + `touch_memory_chunks`. Write path (`projectApprovedCampaign`) wired into approve; read path (`retrieveMemory`) built but not yet consumed by Arjun. |
| `aanya_training_creatives` | `20260612235959` (table), `20260613000000` (RLS) | Real-world creatives Aanya trains on. `source`/`performance_tier` CHECKs. `vision_analysis jsonb`. Images in `brand-assets/aanya-training/{orgId}/` |

### `creative_assets` column constraints (CHECK)
- `funnel_stage`: `'awareness' | 'consideration' | 'conversion'`
- `angle`: `'lifestyle' | 'architecture' | 'amenity' | 'community' | 'value'`
- `status`: `'generating' | 'generated' | 'editing' | 'edited' | 'approved' | 'rejected'`
- `editor_used`: `'canva' | 'adobe_express'`

---

## UI Components (custom, no external chart lib)

| Component | Description |
|---|---|
| `MetricsFreshnessBadge` | Inline live/stale/offline badge, Realtime-driven |
| `CampaignMetricsChart` | Stat cards + CSS bar chart + table. "Sync Now" calls `meta-insights-sync` directly |
| `CreativeViewer` | 3-col grid, Realtime, full action set (approve/reject/regen/canva/adobe/edit-text/download), lightbox. Renders `TextLayerOverlay`; download bakes `text_layers` when present |
| `ImageGalleryViewer` | Post-generation gallery, `localImages` state so edits update in place. "Sync from Canva" button. "Edit Text" opens `TextLayerEditor`. Same download-bake behavior |
| `TextLayerOverlay` / `TextLayerEditor` | Read-only preview / drag-to-reposition editor — see Text-Overlay Layer System |
| `AdobeExpressModal` | Embed SDK v4. Overwrite-in-place (`storagePath`) or legacy new-file mode |
| `CanvaConnectButton` | Canva OAuth connect/disconnect |
| `Sidebar` | Reads `generatingPage` from `NavigationContext` — amber spinner on the active nav item; all navigation stays clickable |
| `AanyaMemory` | `src/pages/AanyaMemory.tsx`. Upload + tag (source/platform/tier/CPL/CTR). `analyzeCreativeWithVision` (Haiku) returns 9-section-aligned `VisionAnalysis` (hex colors, lens, typography element types) → maps directly into GPT-Image-1 prompt sections. "Synthesize DNA" (Sonnet) produces richer `best_performing_*` arrays. Crawl Parameters panel aggregates patterns, exports a crawl brief JSON — full operational guide for a crawling agent in `docs/aanya-memory-schema.md` |

---

## Aanya Trainer → Strategy Feedback Loop

Closes the loop between real-world ad performance and Aanya's generation. Fully backend, no rating UI. All 7 phases shipped:

1. **9-section Haiku analysis** — `analyzeCreativeWithVision` extracts section-aligned `VisionAnalysis`. `analyzeCompetitorWithDiya` (same model, competition-focused) for competitor/industry_reference uploads.
2. **Richer DNA synthesis** — `synthesizeDNA` consumes structured fields, outputs concrete hex/lens/typography names.
3. **Data retention** — `is_live boolean` on `aanya_training_creatives`; synthesis only deletes `is_live=false` rows. Arjun-promoted rows set `is_live=true`, capped at 10/org (oldest demoted).
4. **Arjun performance promotion** — `arjunPromoteCreatives()` in `meta-insights-sync`, fire-and-forget after each org sync. Compares 14d CPL to `benchmarks.avg_14d`; promotes if ratio ≤ 0.95. Runs `runHaikuVision` (direct Anthropic API call).
5. **Diya competitor analysis** — replaces Haiku analysis for competitor/industry_reference uploads; competitive intelligence folded into the synthesis prompt.
6. **Section-level DNA injection** — `synthesizeDNA` outputs `prompt_fragments jsonb` → `project_design_systems.prompt_fragments`. `formatDesignDNA()` uses fragments when present, falls back to a soft-guidance block otherwise.
7. **Ad-level Meta sync** — `syncAdMetrics()` upserts `ad_metrics`, fire-and-forget, enables future creative-level attribution.

**Key rules**: DNA re-synthesis is manual (user clicks Synthesize) — no auto-trigger. `arjunPromoteCreatives`/`syncAdMetrics` errors are console-logged only, never surfaced. `analyzeCompetitorWithDiya` is client-side via `claude-proxy` + Haiku — NOT routed through the server-only `_shared/agents/diya.ts` (a prompt variant, not a separate function). `is_live=true` rows are never deleted by synthesis. Cap enforcement is per-org, not per-project (future: per-project when volume justifies it).

---

## Generation State (cross-component)

`NavigationContext` carries `generatingPage`/`setGeneratingPage`. `Strategy.tsx` sets `'strategy'` while `submitting || geminiActive`, clears on unmount. Sidebar shows a spinner badge on the affected nav item; navigation stays freely clickable (in-progress state is lost on unmount if the user navigates away).

## Quick Generate Ad flow (Strategy page)

`handleQuickSubmit` **always** runs the Aanya senior-designer path — no `isNanobanana` gate or legacy branch.

1. `QuickGenerateForm`: project, goal, brief, ad platform (AiSensy or Meta Ads Manager). Language selector + Quick Reference uploader always visible.
2. `buildQuickGenerateBrief` builds senior-designer prompts with `ad_platform`. **Meta**: headline ≤40 chars, first 125 chars of primary_text a standalone hook, description ≤30 chars. **AiSensy**: headline = WhatsApp template header ≤60 chars, primary_text = conversational body 300-500 chars, description = quick-reply label ≤20 chars.
3. Claude returns `SeniorDesignerResult` → `type: 'quick_senior'`.
4. `SeniorDesignerResultPanel` auto-triggers Gemini/GPT-Image-1 generation on mount.
5. 3 images → `brand-assets`, `creative_assets` rows inserted.
6. `ImageGalleryViewer` renders with Canva + Adobe Express CTAs.

## AI Token & Image Count Tracking

`ai_sessions` stores per-session usage: `claude_input_tokens`, `claude_output_tokens`, `gemini_images_generated` (Imagen 3 legacy, no token API — per-image billing), `tokens_used` (legacy total). Populated by `ai-service.ts` (`aiCall`/`aiVision` return `_inputTokens`/`_outputTokens`) → `session-logger.ts`'s `logAiSession` → `Strategy.tsx`/`Creatives.tsx` accumulate and pass through. **Reports.tsx AI Activity table**: cost per session = `(in*3 + out*15)/1_000_000 + images*0.10`, cumulative banner for last 20 sessions.

## AI Sessions ↔ Lead Funnel link

`AiSessions.tsx` bulk-fetches `lead_funnel` rows for the unique `project_ids[0]` across strategy sessions, matches by `project_id|ISO-week-start(created_at)`, shows a green "N leads · N SV · N booked" pill when matched. **No write path exists yet** — `lead_funnel` rows must be populated externally for this to surface anything.

---

## Creatives page image flow (Nanobanana path)

1. Select project + funnel stage + output platform → "Generate 3 Variants".
2. `buildVariantBriefs` (with `ad_platform`) → 3 platform-specific text variants.
3. One `sessionId` UUID for the batch.
4. `generateImageWithGemini` per prompt → `uploadGeminiImageToSupabase({ sessionId, angleLabel, funnelStage, projectId })` → deterministic path, `creative_assets` row, `{ url, id, storagePath }`.
5. `GalleryImage` objects always carry `id`.
6. `ImageGalleryViewer` renders with Canva + Adobe Express CTAs. Adobe Express edit overwrites `storagePath` in place; Canva edit opens externally, "Sync from Canva" exports and overwrites.

---

## Known-Fixed Bugs (do not re-introduce)

Only non-obvious bugs where the root cause isn't visible in the code at a glance.

| # | File | Bug → Fix |
|---|---|---|
| 1 | `canva-oauth-callback` | Browser redirects carry no auth header → `getUser('')` always null. **Fix**: `CanvaConnectButton` encodes `{returnUrl, userId, orgId}` as JSON in `state`; callback parses that instead. |
| 2 | `canva-sync-design` | Poll loop 20×1500ms = 30s exceeded the Edge Function wall-clock limit. **Fix**: capped at 10 iterations (15s max). |
| 5 | `ImageGalleryViewer` | Canva sync matched on stale `img.url` (changed after a prior Adobe Express edit) → silent discard. **Fix**: `id`-based match with url fallback. |
| 8 | `ImageGalleryViewer` | `canvaDesignIds` reset on every parent re-render → Sync button vanished mid-session. **Fix**: `sessionKeyRef`, only resets on an actual id/url change. |
| 11 | `Strategy.tsx` | `isNanobanana` gate produced text-only output for non-Nanobanana platforms. **Fix**: gate removed; always runs the senior-designer path. |
| 16 | `profiles` RLS | `SELECT USING (auth.uid() = id)` → org user list only returned the logged-in user. **Fix**: migration `20260610150000`, org-scoped SELECT. |
| 17 | `gemini-service.ts` | `(asset as {id}).id` threw when RLS silently blocked an INSERT (asset and error both null). **Fix**: explicit null guard before cast. |
| 23 | `senior-designer-prompts.ts` | Prices rendered as `$` USD. **Fix**: RULE 8, always `₹`/`Rs`, never `$`/USD. |
| 29 | `aanya_training_creatives` | Table created via API with wrong RLS → INSERT always blocked. **Fix**: migration `20260613000000` recreates org-scoped policies. **Follow-up (found while provisioning CC-TEST)**: the table itself was never captured in migration history either — only the RLS fix was — so replaying the full migration history against any fresh project failed at `20260613000000` (`ALTER`-ing a table that was never `CREATE`d). Migration `20260612235959` bootstraps it via `CREATE TABLE IF NOT EXISTS` (no-op on prod, where the table already exists; creates it for real on a fresh project), timestamped to run immediately before `20260613000000`. |
| 31 | `ai-service.ts` etc. | App prompted for a Claude API key in-browser. **Fix**: all calls route through `claude-proxy`; `getApiKey()`/`VITE_ANTHROPIC_API_KEY` removed. |
| 32 | `useAuth.ts` | Recurring "Session expired" every ~50-60 min. Root cause: `fetchOrCreateProfile()`'s outer `catch` called `signOut()` on ANY error, including transient failures during Supabase's silent `TOKEN_REFRESHED` event. **Fix**: the SELECT is isolated in its own try/catch that returns early (no sign-out) on transient failure; `signOut()` fires only for the two confirmed "no org_id" branches. |
| 33 | `supabase.ts` `invokeEdgeFn` | "Session expired" on generation even with a valid session. Root cause: `getSession()` returns the cached session even when its `exp` claim is past; refresh only fired when `session` was null. Sub-bug: `jwtExpiredOrExpiringSoon` used raw `atob()` on the JWT, which always threw (JWTs are base64URL, not standard base64) so the function silently always returned `false`. **Fix**: convert base64URL→base64 before `atob()`; proactively refresh when expired/expiring within 30s; one forced-refresh retry on any auth-class error after the call. |
| 34 | `StrategyResult.tsx` `handleGenerateWithGemini` | "Failed to send a request to the Edge Function." Root cause: React 18 StrictMode double-invokes the mount `useEffect` in dev, firing 6 concurrent calls; `FunctionsFetchError` (network-level) wasn't retried, only auth-class HTTP errors were. **Fix**: `generatingRef` guard (reset in `finally`); one retry on `FunctionsFetchError`. Tests in `supabase.test.ts`. |
| 35 | `claude-proxy/index.ts` | HTTP 546 "not enough compute resources." Root cause: no timeout on the Anthropic fetch — a slow response hung the isolate until Supabase's platform-level kill, which reports as a resource error rather than a timeout. **Fix**: `AbortSignal.timeout(120_000)`, returns a clear timeout message on expiry. |
| 36 | `Strategy.tsx`, `Creatives.tsx` | "Anthropic API timed out after 120s." Root cause: one ~16000-token/~3500-output-token call exceeded the timeout at low server-load throughput. (A historical Haiku-model-override fix attempt never survived into the codebase — verified absent.) **Fix that shipped**: two-stage generation split (see Provider Switching Guide above), ≈35-40s total, no model swap needed. |
| 37 | `senior-designer-prompts.ts` | 3 images in one set showed visibly different buildings. Root cause: Stage 2's 3 layout calls run independently; nothing constrained the actual building description. Not model-choice — reproduced identically on Sonnet and Haiku. **Fix**: `visual_anchor` field from Stage 1, reproduced verbatim by every Stage 2 call. |
| 38 | Section 6 / GPT-Image-1 | Price rendered `$` instead of `₹` despite three separate prompt-level reinforcements, on both Sonnet- and Haiku-authored prompts. This is a rendering-level failure, not a prompt-writing one — no prompt fix exists. **Motivated**: the text-overlay layer system as a reliable parallel path. |
| 39 | `Organic.tsx` | Every "Generate" click inserted an empty `organic_plans` stub row (`org_id`/`week_start`/`status` only) *before* the AI call, and the real output only ever lived in React state — a page refresh silently lost it, and `plan_data`/`pillars` (both present in the schema) were never populated by any code path. **Fix**: moved the insert to *after* a successful `aiCall`, populated with the real `plan_data`/`pillars` (matching the pattern already used by `SMMPlanner.tsx`), plus a load-on-mount effect that hydrates the latest saved plan so a refresh no longer loses it. |
| 40 | `kavya.ts` (Kavya `plan` intent) | Turn always failed with a JSON-parse error, zero `smm_calendar` rows written, but still billed. Root cause: `maxTokens` was hardcoded to `4096` for a 30-entry structured JSON calendar — confirmed live (`scripts/smm-kavya-live-check.ts`) that `output_tokens` hit exactly `4096` every time, truncating mid-object before `parseJsonObject` could parse it. **Fix**: raised to `16000`; added a `stop_reason === 'max_tokens'` guard that throws a specific, retriable `KavyaOutputError` *before* the parse attempt, surfaced to the user as "hit Regenerate" instead of the generic fallback. |
| 41 | `kavya.ts` (Kavya `plan` intent, follow-up to #40) | #40's fix deployed clean to prod, then turned out to trade a fast truncation-crash for a slow, silent, permanently-stuck turn: a real 30-entry plan genuinely takes ~151s to generate (confirmed live — 8705 output tokens, `stop_reason: 'end_turn'`, not truncated), long enough to hit Supabase's Edge Function platform execution ceiling. No timeout existed on the fetch, so a slow call hung until the *platform* killed the isolate — `runKavya()` never returned, `aarav-orchestrate`'s catch block never fired, turn stuck at `status:'working'` forever. **Fix**: `AbortSignal.timeout(120_000)` on the fetch, matching the identical fix already applied to `claude-proxy` for this exact failure class (bug #35). Fails clean and fast now with a specific retry message — does not make the plan intent reliably *succeed* at this throughput; that needs chunked/two-stage generation (same pattern as bug #36), tracked as a follow-up. |
| 42 | `org_integrations` RLS | Lacked role gating since inception (since `20260610150000`'s org-scoping pass — that migration added `org_id` scoping everywhere but never added a role check here, unlike `profiles`' admin-gated update policy). Any org member — not just admins — could read and overwrite the org's live Meta API access token. Found via review-build's reviewer-scoping verification (an actual member-role account, denial proven by authentication, not row inspection) on 2026-07-22. **Fix**: migration `20260722100000_org_integrations_admin_only.sql` mirrors `profiles`' existing admin-gated pattern (same `EXISTS (...profiles.role='admin')` mechanism, not a new one) on SELECT/INSERT/UPDATE. Verified: legitimate callers unaffected (`meta-insights-sync`/`dhruv-anomaly-check` use the service-role client, bypassing RLS entirely; `SettingsPage.tsx`, the only client-side caller, had no role gate either — meaning non-admin access was itself the bug, not a feature to preserve). Regression-proofed with WS1.6 isolation harness probes 9-10 (`supabase/tests/isolation/`) so this class of gap is caught by CI going forward. Grepped every RLS policy in the schema for the same shape (`org_id`-only, no role check) on any credential/token-bearing table — `org_user_integrations` (Canva per-user OAuth tokens) is NOT the same gap: its policies additionally require `user_id = auth.uid()`, scoping to the caller's own row, not any org member's. No other table stores credentials. |
| 43 | `profiles.module_access` default | Every non-admin signup (`role` defaults to `'member'`) has had Strategy/LeadGen-V2 silently hidden from nav since `src/lib/access.ts` was introduced (`48551f0`) — that commit required the key `'strategy_quick'` (mapping both the `strategy` and `leadgen-v2` pages) from its very first version, but `profiles.module_access`'s DEFAULT (set even earlier, in the original `20260409085002` migration) has always listed the old key `'strategy'` instead, which `hasModuleAccess()` never checks for. Not a later rename that broke something — the two were simply never in sync from day one. Found while investigating why a fresh review-build reviewer account (`role='member'`) couldn't see Strategy at all. **Fix**: `20260722120000_profiles_module_access_strategy_quick.sql` — purely additive, adds `'strategy_quick'` to both the column default (verified via a real fresh signup through the actual `on_auth_user_created` trigger, not a manual patch) and backfills existing rows still carrying `'strategy'` without `'strategy_quick'`. Does not remove `'strategy'` (harmless unused entry, avoids destructively rewriting a column an admin may have customized). **Separately flagged, not fixed here**: 9 other modules (`ai_sessions`/`brand_kit`/`campaign_wizard`/`campaigns`/`content_library`/`smm_analyzer`/`smm_calendar`/`smm_creatives`/`smm_planner`) that `access.ts` also gates but which have never been in this default at all, for any role — ambiguous whether that's intentional (admin grants selectively) or the same class of oversight; needs a product decision, not a code fix. Note: #42 (`org_integrations` RLS admin-gating) is on a separate not-yet-merged PR (#7) — renumber if both land out of order. |
| 44 | `20260626010000_dhruv_anomaly_check_cron.sql` | Any fresh environment built from a clean migration replay (`supabase start` locally, or a from-scratch fork) failed hard at this migration with `schema "cron" does not exist`. Root cause: the migration's own comment claimed pg_cron was "already" enabled "since meta-insights-sync uses it" — true on prod, but only because pg_cron was turned on manually via the dashboard at some point, never through a migration (same undocumented-dashboard-state class of gap as bugs around `aanya_training_creatives` and `creative_assets.creative_id`). Its sibling cron migration (`20260617130000`) already had the correct defensive guard; this one regressed it. Found while setting up a local stack for the `spike/image-reference-test` spike (`docs/spikes/2026-07-image-reference-findings.md`) — unrelated to the spike itself. **Fix**: wrapped in the same `IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN ... ELSE RAISE WARNING ... END IF;` guard as its sibling — no behavior change on prod (extension's already there), degrades to a warning instead of a hard failure anywhere it isn't. |
| 45 | Canva "Edit in Canva" flow — major overhaul (2026-07-25 through 2026-07-27) | A multi-day investigation across several distinct, stacked bugs, developed and fully live-tested on review-build before porting here. **What was actually wrong, in the order discovered**: (a) the cold-start OAuth connect did a same-window `window.location.href` redirect, wiping all in-page React state (the generated strategy + images) with no way back; (b) switching that to a popup broke because Canva sends `Cross-Origin-Opener-Policy: same-origin`, which severs `window.opener` the instant the popup navigates to Canva's domain — `window.opener`+`postMessage` and later `BroadcastChannel` both failed unpredictably for this reason; (c) even after moving the completion signal to `localStorage`'s `storage` event (no dependency on `window.opener` at all), the popup could still render a completely empty Strategy page inside itself if `window.close()` silently no-op'd — a real, separate browser restriction once a popup's navigation history spans multiple pages, confirmed to have nothing to do with COOP; (d) `window.open(editUrl, '_blank')` for the *already-connected* case could also get silently blocked because it fired *after* an `await`, stripping "user activation" in stricter browsers — fixed by opening a blank tab synchronously at the click and navigating it once the real URL is known; (e) a real UI bug where the manual "Sync from Canva" button vanished permanently after the first sync (`handleCanvaSync` was clearing its own visibility trigger); (f) an entirely separate Canva mechanism — **Return Navigation** — discovered only because the user pasted a real `?correlation_jwt=...` redirect URL: a dedicated "Return" button inside Canva's editor, config'd once in the Canva Developer Portal (already enabled, no admin changes needed), verified server-side against Canva's JWKS (new `canva-verify-return-nav` Edge Function, `jose@5`) before trusting anything in it. **End state**: cold-start uses a synchronously-opened popup signalled via `localStorage`, with a same-window-redirect fallback made safe by a DB-backed resume (`Strategy.tsx` reconstructs the full result from `creatives.senior_designer_brief` + `creative_assets`, since that data was persisted before the user ever reached the edit step); Return Navigation auto-triggers the sync with no manual button; see the flow summary above section 4 for the full picture. **What actually cracked each layer**: live evidence over reasoning from docs alone — `curl -I` against Canva's real endpoints revealed both blocking headers directly, decoding a real user-provided JWT revealed Return Navigation, and replaying the DB resume queries live (under the real user's RLS-scoped session) ruled out several suspected root causes before the real one was found. The single most valuable piece of user feedback in the whole investigation was a precise two-clause comparison — "it comes back to the same page but empty, *whereas* it's open in the window it was called from" — which is what revealed a third window was involved at all, rather than the original tab losing state. |

## Rules

- Every table has RLS with org_id scoping (`get_current_user_org_id()`, SECURITY DEFINER, migration `20260610150000`). `organizations` uses `id = get_current_user_org_id()`, `notifications`/`org_user_integrations` add `user_id = auth.uid()`.
- `profiles` has a BEFORE UPDATE trigger blocking self-privilege escalation on `role`/`module_access`/`daily_ai_limit`/`org_id`. Admins can update other users' profiles via a separate policy.
- Edge Functions use the service role key — never expose to the client. All images in Supabase Storage, never external URLs. Realtime for live UI, no polling. Never modify existing tables destructively — only ADD columns. Meta API: always async POST. Sync jobs: errors per-org, one org failing never blocks others. No charting libraries — CSS/inline-style bars. Migration timestamps `YYYYMMDDHHMMSS`, wrap ALTER in DO blocks.
- **DOWN migrations** live in `supabase/rollbacks/` (not `supabase/migrations/` — the CLI only scans the latter, so they never auto-apply). Apply manually: `supabase db query --linked -f supabase/rollbacks/<file>.sql`.
- **`match_memory_chunks` signature**: `(query_embedding vector, query_text text, filter_scope memory_scope DEFAULT NULL, filter_project uuid DEFAULT NULL, match_count int DEFAULT 10) RETURNS TABLE(id, content, scope, agent_name, salience, similarity, hybrid_score, created_at)`. SECURITY INVOKER — RLS enforces tenancy automatically. **Do not pass `org_id`** — not in the signature.
- Storage: edited images always overwrite the original path (`upsert: true`), never accumulate files.
- `uploadGeminiImageToSupabase` returns `{ url, id, storagePath }` — use `.url`, not the raw return value.
- **`brand_kits` is strictly org-level** (`UNIQUE org_id`, no `project_id` column). Adding per-project branding needs a migration (add `project_id`, relax the UNIQUE) plus a `runBrandConfirm`/`runBrandCheck` query change. Do not add a `project_id` filter without that migration — it silently returns no kit and flags every creative.
- **Edge Function DB types**: `supabase/functions/_shared/database.types.ts` is **hand-written**, not CLI-generated (`Update` types written out concretely to avoid a `never`-collapse in Deno's type inference). Update manually per migration. CLI regeneration path exists (`supabase gen types typescript --project-id mpvdpdxzqnidwyihyhbn`) but is unverified against this hand-written shape — always run `deno check` on `aarav-orchestrate/index.ts` before trusting generated output. All `createClient<Database>()` — never untyped `createClient()`.
- **CI gate**: `.github/workflows/typecheck.yml` — **four** parallel jobs currently committed and running on every push/PR to `main`: `build` (`tsc --noEmit` strict + `vite build`), `edge-typecheck` (`deno check` on all 11 Edge Function entry points), `edge-unit-tests` (`deno test` on `_shared/agents/`), `ws1-6-isolation` (see below). A fifth job, `client-unit-tests` (Vitest), exists only in an uncommitted working-tree diff alongside pending Vitest test files — not real until both are actually committed; don't assume it runs. `--no-verify` only skips the *local* pre-push hook mirror — it cannot skip these jobs themselves, which run server-side on GitHub regardless of how the push happened. New `supabase/functions/*/index.ts` → add to the `deno check` list here, `scripts/hooks/pre-push`, and `deploy-functions.yml`'s deploy loop.
- **Branch protection (added 2026-07-21, tightened same day)**: `main` requires 3 of the 4 committed jobs to pass — `Client build (TypeScript + Vite)`, `Edge Function type check (Deno)`, `Edge Function unit tests (no credentials)` — before anything can land (`ws1-6-isolation` deliberately excluded: probe 7 depends on deployment state, not just code correctness, so it shouldn't block a merge the way a real code defect should). `enforce_admins: true`, `allow_force_pushes: false`, `allow_deletions: false` — **no bypass for anyone, including admins.** Direct `git push` to `main` no longer works in practice: GitHub can't record a passing check against a commit that doesn't exist on the remote yet, so a brand-new commit pushed directly has no check history to satisfy the requirement and gets rejected. **All changes now go through a PR** — open a branch, push it, let CI run, merge once green. Before 2026-07-21, `main` had zero branch protection at all, so the "cannot be bypassed" framing above was aspirational for anything except the local pre-push hook; this is the first time it's actually true end to end.
  - **CI was silently broken for ~a month** (every run since commit `92e7b4f`, 2026-06-26, failed) — nobody was watching. Fixed 2026-07-21: real pre-existing TS errors (`DhruvInsightCards.tsx` bad import path + unused `React` import; `Strategy.tsx` missing `meta_ad_account_id` field) plus an `edge-unit-tests` failure (`npm:@types/node` unresolvable) that looked like a Deno/npm interop bug — reproduced only on Linux CI, never locally on Windows even with the exact CI Deno binary — but wasn't one. **Root cause, confirmed via a temporary diagnostic step (removed once solved — see commits `6279f60`/`498e705` if this needs re-diagnosing)**: `deno check` (which never failed) always targets files directly inside `supabase/functions/`, so it walks up from each file's own directory and finds `deno.json`/`deno.lock` correctly. `deno test` was invoked from repo root against a *directory* target, one level removed from where `deno install` (`working-directory: supabase/functions`) actually populated `node_modules` — its config discovery for a directory target never resolved against that tree on the Linux runner, even though the diagnostic proved the package was installed correctly and its symlink was fully intact (both directly ruled out with evidence, not assumed). **Fix**: `deno test` now runs with `working-directory: supabase/functions` and relative paths, matching `deno check`/`deno install`'s discovery pattern. Stale cache was the leading theory before instrumenting — directly ruled out too (`Cache not found for input keys` on the very run that still failed).
- **RLS isolation harness (WS1.6)**: `supabase/tests/isolation/` — 9 tests (8 cross-tenant probes + 1 static check) covering `agent_memory_chunks`, `profiles`, and the service-role write path in `handleApprove` (probe 7 — the one class of check pure-RLS probes can't reach). Modeled on the sibling `awaas-suite` repo's Gate P (same `lib.ts` probe shapes, separate implementation — no shared package). **Runs against the only Supabase project this repo has** (`CommandCentre_Prod` — no separate TEST project); every seeded row is identifiably prefixed and removed by `cleanup-isolation-probes.sh`. Wired into `typecheck.yml` as `ws1-6-isolation` with job-level secrets (never workflow-level, so other jobs never see the service-role key). Full detail, probe list, and coverage gaps: `supabase/tests/isolation/README.md`. **§5.1 Deviation Register item CLOSED 2026-07-21** — first green CI run: `29828405683`.
- **Client unit tests (Vitest)**: `npm test` (single-pass) / `npm run test:watch`. Config `vitest.config.ts` (jsdom), setup `src/test/setup.ts`. Colocated `*.test.ts`. Mock via `vi.hoisted` + `vi.mock` at the module boundary — never mock individual Supabase query methods at call-site level. Files: `useAuth.test.ts` (3, bug #32), `supabase.test.ts` (10, bugs #33/#34), `text-layers.test.ts` (6).
- **Catch-block discipline**: any `catch` with a **destructive side effect** (signOut, navigate, delete, state wipe, DB write) MUST have a paired unit test proving it does NOT fire on a transient error. A generic `catch { destructiveAction() }` is always wrong — the action must fire only on a positively-confirmed specific failure case. Background-recurring functions (`onAuthStateChange`, `setInterval`, Realtime) with a catch+side-effect are highest-risk. Use `/code-review` before finishing any auth-adjacent task.
- **Automated Edge Function deployment**: `.github/workflows/deploy-functions.yml` auto-deploys on every push to `main` touching `supabase/functions/**`. Requires repo secret `SUPABASE_ACCESS_TOKEN`. `meta-insights-sync`/`dhruv-anomaly-check` deploy with `--no-verify-jwt` (pg_cron callers). `workflow_dispatch` available for manual redeploys — **use this to verify the token/pipeline actually works before trusting it with a real deploy**, since it silently failed for a month with nobody noticing (see CI gate above). Separate workflow from `typecheck.yml` so a deploy failure never blocks type checks.
- **Test files in `_shared/agents/`**: `aanya_test.ts` (4, credential-free), `aanya_budget_test.ts` (2, credential-free), `diya_smoke_test.ts` (2, one auto-runs since `kit:null` short-circuits, one auto-ignores without `SMOKE_*_URL`), `kavya_test.ts` (10, 5 credential-free + 5 gated behind `ANTHROPIC_API_KEY`), `dhruv_test.ts` (9, 5 credential-free + 4 gated). These are the only test files — don't add duplicates.
- **Local pre-push hook** (optional, committed): `scripts/hooks/pre-push` mirrors CI. Opt in: `git config core.hooksPath scripts/hooks`. Runs npm test → typecheck → build → deno check → deno test. Bypass (`--no-verify`) only in a genuine emergency — CI is the real backstop.
- **Edge Function deployment fallback** (Docker ECR CDN failure): when `supabase functions deploy` can't pull the runtime image, deploy via the Management API instead — inline the shared types, swap `esm.sh` imports for `npm:` specifiers, `PATCH https://api.supabase.com/v1/projects/mpvdpdxzqnidwyihyhbn/functions/{slug}` with the source body. `meta-insights-sync` was deployed this way (version 8, 2026-06-22).
- **Token efficiency**: keep LLM calls lean — only the context genuinely needed, no full conversation history or redundant fields. Focused single-purpose prompts over mega-prompts. Scope `max_tokens` to the task.
- **Planning discipline**: extended reasoning / planning passes for architectural decisions, multi-step flows, and expensive-to-undo choices (schema changes, new Edge Functions, large refactors). Straightforward edits — act directly. When genuinely unsure, use `EnterPlanMode` before touching files.
- **CLAUDE.md updates are mandatory** after every codebase change — see the top of this file.

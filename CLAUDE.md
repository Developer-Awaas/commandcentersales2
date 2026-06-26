# CLAUDE.md — Command Center V2 Integration Context

> Place this file in the repo root. Claude Code reads it automatically for project context.

## IMPORTANT — Keep this file current
**Every time you modify the codebase** (new component, changed flow, new edge function, schema change, new rule discovered) **update the relevant section of this file before finishing the task.** This is the single source of truth for future Claude sessions. Stale context causes wrong assumptions and rework.

---

## Project

Command Center V2 — AWAAS Services Pvt Ltd. Real-estate marketing SaaS.
Stack: React + TypeScript, Supabase (Postgres + Edge Functions + Auth + Storage + Realtime).

---

## Active Integrations

### 1. Meta Marketing API (auto-fetch campaign stats)
- Edge Function: `supabase/functions/meta-insights-sync/`
- Runs on pg_cron every 15 min
- Writes to: `campaign_metrics` table (tagged with `project_id` when per-project accounts are configured)
- API: `https://graph.facebook.com/v21.0` — always use async POST jobs, never sync GET
- Rate limit header: `X-FB-Ads-Insights-Throttle` — back off if `acc_id_util_pct > 75`
- Token stored org-level in `org_integrations.meta_access_token` (one System User token covers all accounts under the Business Manager — never per-project)
- **Ad account ID (per-project)**: each `projects` row has a nullable `meta_ad_account_id text` column (migration `20260622030000`). The sync function checks for projects with this field set and syncs each separately, tagging `campaign_metrics` rows with `project_id`. If no project has its own account ID, falls back to `org_integrations.meta_ad_account_id` (org-level, no project tag) for backward compatibility.
- **act_ prefix**: the `meta_ad_account_id` must always be in `act_<numeric_id>` format. `SettingsPage.tsx` and `ProjectForm.tsx` both normalize bare numeric IDs on save. Do NOT strip this in the sync function.
- **Error surfacing**: `syncAccount` throws on Meta API errors (after logging to `integration_sync_log`). The outer loop captures the error and includes it in the JSON response body as `{ status: 'error', error: 'Meta API error 803: ...' }`. `SettingsPage.triggerMetaSync` reads `data.results` and shows real errors in red — not just Supabase-level errors.
- **Current sync levels**: `level: 'campaign'` (main) + `level: 'ad'` (fire-and-forget via `syncAdMetrics`, Phase 7). Phase 7 still uses the org-level `meta_ad_account_id` from `org_integrations` — not yet per-project.
- **Required Meta permissions** (shown in Settings page tutorial): `ads_read`, `ads_management`, `business_management`, `pages_read_engagement`. System User tokens (not user tokens) recommended — do not expire. Setup guide is in `SettingsPage.tsx` as a collapsible panel inside the Meta Ads Integration card.
- **Future — multi-account manager (Phase 2)**: when an org runs 10+ projects across separate ad accounts, replace `projects.meta_ad_account_id` with a new `org_ad_accounts` table (`org_id, account_id, label`) and a project↔account junction table. The migration comment in `20260622030000` documents the backfill steps. Do NOT implement until volume justifies it.

### 2. Image Generation (creative variants)
- Client-side via `src/lib/gemini-service.ts` (Nanobanana path in `Creatives.tsx`)
- Also: Edge Function `supabase/functions/generate-creatives/` (used by `CreativeViewer`)
- Model: **OpenAI GPT-Image-1** via `https://api.openai.com/v1/images/generations`. Proxied via Edge Function `generate-image` (avoids browser CORS). Requires `OPENAI_API_KEY` secret in Edge Function environment. GPT-Image-1 always returns `data[0].b64_json` directly (no `response_format` param needed). Sizes: square→`1024x1024`, portrait→`1024x1536`, landscape→`1536x1024`. Quality: `low|medium|high`.
- **Prompt format (Aanya's 9-section structure)**: flowing prose narrative (500–800 words) — SECTION 1 (scene narrative) → SECTION 2 (subject & composition %) → SECTION 3 (camera lens mm + shot type) → SECTION 4 (lighting time + Kelvin + shadows) → SECTION 5 (color palette with hex codes) → SECTION 6 (typography layer to RENDER in image with text content, fonts, sizes, positions, graphical containers) → SECTION 7 (brand elements) → SECTION 8 (negative prompts) → SECTION 9 (technical specs). **CRITICAL: Section 6 now specifies text elements that the image model RENDERS directly into the image** — no CSS overlay needed. Text includes styling details, positions, and associated graphical elements (colored panels, buttons, boxes). Reference example matching professional real estate ad style (Neelachala Homes) lives in `senior-designer-prompts.ts`.
- `generateImageWithGemini()` calls `supabase.functions.invoke('generate-image', { prompt, width, height })` — Edge Function forwards to OpenAI and returns `{ base64, mimeType }`.
- `model_used` field in `creative_assets` is set to `'gpt-image-1'`.
- **Reference images (QuickReferenceUploader)**: uploaded to `quick-references` bucket. Before calling `buildQuickGenerateBrief`, `Strategy.tsx` runs `describeImageForFlux()` (Claude Haiku vision) on each ref URL in parallel. The resulting visual description is stored in `QuickReference.visual_description` and injected by `buildReferenceManifest()` as rich visual context. This gives GPT-Image-1 detailed visual brief even though it can't process image pixels directly.
- `generateImageWithGemini` accepts `aspectRatio: '1:1' | '9:16' | '4:5'` and optional `quality: 'low'|'medium'|'high'`. Default: always `'high'` (production-grade images required). Edge fn `generate-image` accepts and forwards `quality` param. `1:1`→1080×1080, `4:5`→1080×1350, `9:16`→1080×1920.
- **Strategy page (SeniorDesignerResultPanel)**: generates 3 images from **3 distinct layout-paradigm prompts** — Feed (1:1) uses `nanobanana_prompt_main` (GRAPHIC_DESIGN_FRAME: dark bg, dual photo cards, mixed-weight headline, checklist, price badge, footer strip), Portrait (4:5) uses `nanobanana_prompt_portrait` (PHOTOREALISTIC_SCENE: single cinematic hero photo, editorial overlay), Story (9:16) uses `nanobanana_prompt_story` (TYPOGRAPHY_FORWARD: bold headline dominates 40% of frame, building as secondary card). Falls back to `nanobanana_prompt_main` if portrait/story prompt absent. `handleGenerateWithGemini` in `StrategyResult.tsx`.
- **Creatives page**: generates 3 images from 3 different variant prompts — each at 1:1 (one per angle: value/lifestyle/amenity).
- Generates 3 images per session; each stored at a **deterministic path** so edits overwrite the same file
- Storage path pattern: `generated-creatives/{orgId}/{sessionId}/{angle-slug}.{ext}` in bucket `brand-assets`
- `uploadGeminiImageToSupabase` now returns `{ url, id, storagePath }` and inserts a `creative_assets` DB row
- `creative_assets.creative_id` FK links image records to their parent `creatives` row — migration run 2026-06-11, column `creative_id uuid REFERENCES creatives(id) ON DELETE SET NULL` added live.
- Angle label → DB value map: 'Price-led with Urgency' → `value`, 'Lifestyle / Aspirational' → `lifestyle`, 'Trust & Legacy / Amenities' → `amenity`
- Funnel map: TOFU → `awareness`, MOFU → `consideration`, BOFU → `conversion`
- All 3 images from one "Generate" click share the same `session_id` UUID (column added via migration `20260605000000`)
- Prompt templates in: `src/lib/senior-designer-prompts.ts`
- **CSS overlay & Canvas compositor deprecated for text rendering** — `ImageGalleryViewer` still has these for backward compatibility but are now secondary to image-rendered text. See RULE 6 in Aanya's prompt to understand how text rendering is specified.

### 3. Claude API Proxy (`claude-proxy` Edge Function)

All client-side Claude/Anthropic calls are routed through `supabase/functions/claude-proxy/index.ts`. `ANTHROPIC_API_KEY` is stored as a Supabase Edge Function secret — never in a `VITE_` env var or the browser bundle.

- **Client callers**: `aiCall()`, `aiVision()`, `describeImageForFlux()` in `src/lib/ai-service.ts` all use `supabase.functions.invoke('claude-proxy', { body: {...} })`. `isAiEnabled()` returns `true` unconditionally (key is always server-side).
- **Out-of-band callers**: `Analyzer.tsx` (`handleResearchMetaUpdates`, uses `_beta: 'web-search-2025-03-05'`) and `AanyaMemory.tsx` (`analyzeCreativeWithVision`) — both updated to use `claude-proxy` (no longer raw browser fetches).
- **`_beta` field**: include `_beta: 'web-search-2025-03-05'` in the body to forward as `anthropic-beta` header for web-search-enabled calls. The edge function strips `_beta` before forwarding to Anthropic.
- **Deploy**: `supabase functions deploy claude-proxy` + `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
- **Security**: no Anthropic key is ever bundled into the client. `VITE_ANTHROPIC_API_KEY` has been removed from `.env` and `.env.example`.

### 4. External Editors — Edit-in-Place Flow

**Adobe Express**
- Component: `src/components/AdobeExpressModal.tsx`
- Embed SDK v4 loaded client-side; `onPublish` callback returns edited base64
- Accepts optional `storagePath` + `storageBucket` props
  - **With** `storagePath`: overwrites the original file (`upsert: true`) and updates `creative_assets.image_url` — single file per image, no extra storage
  - **Without** `storagePath` (legacy `CreativeViewer` path): creates a new `/edited/` file and updates `creative_assets.edited_image_url`
- After save, `ImageGalleryViewer` updates local state → gallery shows edited image immediately (no download needed)

**Canva**
- Per-user OAuth, tokens in `org_user_integrations`
- `canva-open-editor` edge function: uploads asset to Canva, creates design, returns `{ editUrl, designId }`
- `canva-sync-design` edge function (NEW): exports the Canva design back via `POST /v1/exports`, downloads PNG, overwrites original storage path, updates `creative_assets.image_url`
- Frontend flow: after opening Canva tab, `ImageGalleryViewer` shows a **"Sync from Canva"** button; clicking it calls `canva-sync-design` and updates gallery in-place
- `canva-oauth-callback` edge function handles OAuth redirect and stores tokens

**Download**: Always available as fallback

---

### 5. LeadGen V2 ("Aarav Agent") — feature-flagged scaffold

Split-pane agent workspace. Gated behind `LEADGEN_V2_ENABLED` (default false). When enabled: Lead Gen section tab defaults to `leadgen-v2`; old pages (Strategy, CampaignWizard, etc.) remain accessible and are NOT deleted (kept for one release as a fallback).

- Flag: `src/lib/feature-flags.ts` exports `LEADGEN_V2_ENABLED`, reads `VITE_LEADGEN_V2_ENABLED` env var (`'true'` to enable). Set in `.env` / `.env.example`, defaults to `false`.
- Gated at two call sites: `src/App.tsx` (`PageContent` falls back to `<Dashboard />` for the `'leadgen-v2'` route when off) and `src/components/layout/Sidebar.tsx` (`LEAD_GEN_NAV` only includes the "Aarav Agent ✦" nav item when the flag is on).
- Page: `src/pages/leadgen-v2/index.tsx` — renders a fixed split layout: left 360px conversation thread (`AaravThread`), right scrollable workspace canvas (`BrandCheckCard` → `StrategyCard` → `CreativeGrid`) with a footer `ApprovalBar`.
- Components in `src/pages/leadgen-v2/components/`: `AaravThread` (message bubbles + disabled mock input + `AgentStatusChip`), `AgentStatusChip` (idle/thinking/generating/ready states), `BrandCheckCard`, `StrategyCard`, `CreativeGrid` (3 placeholder tiles), `ApprovalBar` (Reject/Regenerate/Approve buttons, disabled unless status is `ready`).
- `src/hooks/useAgentSession.ts` — returns a fully static `MOCK_SESSION` (messages, strategy, creatives, brand check). **No network calls.** Exports the shared types (`AgentStatus`, `AaravMessage`, `MockStrategy`, `MockCreative`, `MockBrandCheck`, `AgentSession`).
- `src/hooks/useProfileMode.ts` — reads `profile_tier` from `localStorage`, defaults to `'profile_2'`. Tiers: `profile_1` (Starter) / `profile_2` (Growth) / `profile_3` (Enterprise), each with a label + description for upsell UI. Also stored in `profiles.tier` (server-side source of truth for cost ceilings; migration `20260620000000`).
- **Profile rendering (presentation only — same backend)**: `profile_1` collapses to Aarav's single voice — single neutral "Working on it…" spinner instead of named-agent delegation chips; canvas cards unattributed ("Campaign Strategy" not "Arjun's Strategy"). `profile_2` = current team view. Wired in `AaravThread.tsx`, `StrategyCard.tsx`, and `leadgen-v2/index.tsx` via `useProfileMode`.
- **Per-interaction budget cap** (anti-runaway, spec §5.11): `supabase/functions/_shared/tier-config.ts` holds cost ceilings per tier (`profile_1: $0.85`, `profile_2: $3.00`, `profile_3: $10.00`). Enforced in `aanya.ts` via `BudgetTracker` + `BudgetCapError`. Reserve happens synchronously before each `await generateImage` (race-free in single-threaded Deno). On exhaustion: angle returns best-of-current (if any prior image), cap noted in Aarav's message, `agent_turns.cap_hit = true` (migration `20260620010000`), Langfuse `budget-cap-hit` span logged. **Separate per-period volume quota is not yet implemented** — this per-interaction cap handles anti-runaway; monthly volume tracking is deferred.
- **LeadGen V2 README**: `src/pages/leadgen-v2/README.md` documents the orchestration contract, invariants, profile tiers, budget cap, and key files.
- Styling reuses existing design tokens only (`surface`, `border`, `text`, `brand`, `success`/`warning` semantic colors, `shadow-card`) — no new Tailwind config needed.
- `src/lib/access.ts` already maps `'leadgen-v2': 'strategy_quick'` for module access — unrelated to the feature flag, this just controls per-profile module visibility once the flag is on.
- `useAgentSession` (`src/hooks/useAgentSession.ts`) now calls the real `aarav-orchestrate` Edge Function. `sendMessage`, `regenerateCreatives`, and `requestChange` share one `inFlightRef` guard; `approveTurn` uses a separate `approveRef` — a double-click can never double-write the cost ledger or memory tables.
- **Phase 5 (complete)**: streaming delegation status via Realtime, approval gate, memory write. See below.

#### Phase 5 — Realtime turn tracking, approval gate, memory write (complete)

**New tables** (migration `20260617120000`): `agent_turns` (one row per invocation, `delegations jsonb` updated mid-turn, Realtime target), `agent_messages` (durable conversation log), `agent_memory` (approved decisions, written on `action='approve'` only).

**Approve invariants — all three required, any one alone insufficient**:
1. UI guard: Approve button disabled the instant `approveLoading` goes true.
2. Hook guard: `approveRef` blocks a second request even if state update is delayed.
3. Server guard: `approved_at IS NOT NULL` in `handleApprove()` returns early without any DB write on re-call.

**No Meta launch**: `action='approve'` sets `status='ready_to_launch'` only. Do NOT change to `'approved'` without adding a real Meta campaign-create call first.

**Wall-clock**: Supabase Free/Pro caps at **150s** (no `config.toml` = platform default). Aanya's loop is parallelised (`Promise.allSettled`) — worst case ≈ 100–130s, within limit. Migration `20260617130000` pg_cron marks turns stuck >10 min as `'failed'`. `agent_memory.user_brief` (migration `20260617140000`) + GIN FTS index on `(user_brief || summary)` for ILIKE search pre-pgvector.

#### Aarav's specialists — server-side only, never reachable from `src/`

`aarav-orchestrate` (`supabase/functions/aarav-orchestrate/index.ts`) is the **only** Edge Function the client calls. It fans work out server-side to specialist modules under `supabase/functions/_shared/agents/` — none of those are routable Edge Functions and none may ever be imported under `src/`.

- **Arjun** (`_shared/agents/arjun.ts`) — performance marketing strategist. One Claude Sonnet 4.6 call, returns `StrategyConfig` (budget split, targeting, placements, expected CPL). Runs first on every normal turn.
- **Aanya** (`_shared/agents/aanya.ts`) — creative director. Runs only after Arjun succeeds (derives from his `StrategyConfig`), and produces exactly 3 `CreativeVariant`s (one per angle: `value`/`lifestyle`/`amenity`), each with `image_url`, `copy` (headline/primary_text/cta), `rationale`, and a placeholder `brand_check` (`status: 'pass'`, note `'brand check pending'`) — **aarav-orchestrate always overwrites this placeholder** with Diya's real verdict before a creative reaches the user (see Diya below).
  - **Self-critique loop**: one Claude ideation call produces all 3 angles' copy + image prompts, then per angle: generate image → Creative Analyzer critique (a second, cheap Claude call scoring the *image prompt + copy*, not the rendered pixels) → if rejected, append the analyzer's feedback to the image prompt and regenerate. **Hard-capped at 3 iterations per angle** — on non-convergence, the highest-scoring attempt so far is used (best-of-N), never an error. Testable by mocking the analyzer to always reject — the loop provably stops at 3.
  - **Image generation always goes through the provider abstraction** (`_shared/image-provider.ts`) — `aanya.ts` never constructs an OpenAI/etc. request directly. This is the same abstraction `generate-image/index.ts` was refactored to use (see below), so a provider swap never touches either call site.
  - **Cost tracking**: `RunAanyaResult.totalCostUsd` sums the *entire* loop's cost — the ideation call, every critique call across every iteration, and every image generation's `costMeta.unitCost` — not just the final accepted pass. This is what makes the provider-benchmark spec amendment measurable from real `agent_interactions` data (one row per Aanya run, `cost_usd` = this total).
  - Images upload to bucket `brand-assets` at `generated-creatives/{orgId}/{runId}/{angle}.{ext}` (same convention as the client-side Nanobanana/GPT-Image-1 path), one fresh `runId` per Aanya run.
  - **Regenerate flow**: `AgentRequest.regenerate_creatives` (`{ strategy, angle?, keep? }`) lets the client re-run just Aanya without re-running Arjun — handled by `handleRegenerateCreatives()` in `aarav-orchestrate/index.ts`, a separate code path from the normal Arjun→Aanya turn. Omitting `angle` regenerates all 3; setting it regenerates one (the other two, `keep`, are echoed back unchanged — they're never re-sent to Aanya, and keep their own already-real `brand_check` from a prior turn).
- **Diya** (`_shared/agents/diya.ts`) — brand manager. Two functions, both invoked only by `aarav-orchestrate`:
  - **`runBrandConfirm({ orgId, projectId })`** — a deterministic `brand_kits` lookup (org-scoped), NOT an LLM call. `brand_kits` is one row per org (`UNIQUE org_id`, no `project_id` column — see migration `20260609130000`), so there's currently no "multiple/ambiguous kit" scenario to disambiguate; `projectId` is threaded through for a future per-project override but unused in the query today. No kit → returns `{ status: 'flag', notes: 'No brand kit configured...' }`, never a crash, never a fabricated pass. Runs before Arjun on every normal turn so `canvas.brand` (rendered by `BrandCheckCard`) is ready regardless of how the rest of the turn goes; also re-run (cheaply) on every `regenerate_creatives` turn since `canvas` is replaced wholesale by the client, not merged — omitting `brand` there would make the card vanish after a regenerate.
  - **`runBrandCheck({ orgId, projectId, variants, traceId, kit? })`** — **Claude Sonnet 4.6 WITH VISION**, one call per variant, image passed as `{ type: 'image', source: { type: 'url', url: variant.image_url } }` (Diya receives the URL already in Storage — never re-uploads or re-encodes it). Judges color match to the kit, aesthetic consistency, and brand-safety; returns `{ status: 'pass' | 'flag', note }` per variant. No kit → flags every variant with no LLM spend (nothing to check against). Any single variant's vision call failing flags *that* variant only (`'Brand check failed for this creative — review manually.'`) and continues checking the rest — never silently treats a failure as a pass.
  - **Orchestrator wiring** (`applyBrandCheck()` in `aarav-orchestrate/index.ts`): called unconditionally on every batch of new variants Aanya returns — the normal Arjun→Aanya turn and the regenerate turn both route through it. **INVARIANT: no Aanya creative reaches the user without passing through this.** If `runBrandCheck` itself throws (e.g. missing `ANTHROPIC_API_KEY`), every variant in that batch is fail-safe flagged (`'Brand check failed — review manually.'`) rather than left at Aanya's placeholder `'pass'` — a Diya outage must fail skeptical, not open.
  - `CreativeBrandCheck.status` / `BrandVerdict.status` is `'pass' | 'flag'` — `'flag'` is advisory only. `CreativeGrid` keeps the tile fully selectable/regenerable when flagged; hard governance blocks are Phase 5/6.
- **Kavya** (`_shared/agents/kavya.ts`) — content strategist. Handles three intents detected from the user message by `detectKavyaIntent()` in `aarav-orchestrate/index.ts`:
  - **`'plan'`** (Sonnet 4.6, `max_tokens: 4096`): 30-day SMM calendar. Returns `KavyaPlan { plan: KavyaPlanEntry[30], strategy_note }`. On success, `handleKavyaTurn` bulk-inserts all 30 entries into `smm_calendar` (mapping `date→post_date`, `posting_time→post_time`, `creative_brief→nano_prompt`, `week_theme→topic`) so the SMM Calendar page populates immediately. Insert errors are console-logged but never fail the turn.
  - **`'caption'`** (Haiku 4.5, `max_tokens: 1024`): single platform-optimised caption + hashtags. Returns `KavyaCaption { caption, hashtags, platform, char_count }`.
  - **`'reel'`** (Haiku 4.5, `max_tokens: 1024`): 3-section reel script. Returns `KavyaReelScript { hook, body, cta, music_mood, shot_list }`. No DB write — returned as canvas for user to review.
  - **Intent routing**: `detectKavyaIntent(message)` runs in `aarav-orchestrate` **before** the Arjun→Aanya chain. Returns a `KavyaIntent | null` using regex keyword matching. Non-null → `handleKavyaTurn()`, null → normal campaign flow. SMM/content messages ("content calendar", "caption", "reel script", "what should I post") route to Kavya; campaign/lead-gen messages ("Meta Ads", "CPL", "campaign", "run ads") do not.
  - **Delegation chip**: Kavya replaces the arjun/aanya chips with a single `kavya` chip for SMM turns — `ctx.delegations` is mutated in place before `finaliseTurn` so Realtime subscribers see the correct label.
  - **Cost**: logged to `agent_interactions` as `agent: 'kavya'` — covered by migration `20260625000000` which adds 'kavya' to the CHECK constraint. `database.types.ts` updated to include `'kavya'` in the agent union.
  - **Canvas shape for Kavya turns**: `{ plan: KavyaPlan } | { caption: KavyaCaption } | { reel: KavyaReelScript }` — keyed by intent. Client-side canvas rendering for Kavya is not yet implemented (turns display Aarav's text message only); canvas is stored in `agent_turns.canvas` for future UI.
  - Prompt: `loadAgentPrompt('kavya')` from `prompts.ts` — PLACEHOLDER v1.0, establishes JSON output contract. Refine separately. No critique loop, no image generation.
- **Dhruv** (`_shared/agents/dhruv.ts`) — analyst. Read-only: observes metrics and reports, never changes campaign settings. Three intents detected from the user message by `detectDhruvIntent()` in `aarav-orchestrate/index.ts` (checked before Kavya and Arjun→Aanya):
  - **`'reactive'`** (Sonnet 4.6, `max_tokens: 2048`): quick conversational insight. Returns `DhruvReactiveOutput { summary, details, alerts[], recommendations[], delegate_suggestion }`. `delegate_suggestion` is `'arjun' | 'aanya' | null` — when Dhruv identifies a needed campaign change, Aarav offers to loop in the right specialist.
  - **`'report'`** (Sonnet 4.6, `max_tokens: 4096`): full monthly narrative report. Returns `DhruvReportOutput { title, executive_summary, sections[] }`.
  - **`'dashboard'`** (Haiku 4.5, `max_tokens: 512`): 3-5 severity-coloured insight cards for dashboard header. Returns `DhruvDashboardOutput { cards[{ severity: 'red'|'amber'|'green', title, body }] }`.
  - **Pre-computation (critical)**: `buildMetricsContext()` from `_shared/metrics-query.ts` runs BEFORE the Dhruv LLM call (and also before the Arjun→Aanya chain as cross-agent enrichment). This is pure SQL + math — no LLM cost. Dhruv receives `MetricsContext` JSON (aggregates, WoW deltas, day-of-week breakdown, alert list) and narrates it; it never sees raw DB rows. This invariant ensures every number Dhruv cites is verifiable.
  - **Alert checks** (threshold-based, no LLM): CPL spike (7d avg > 1.5× 30d avg → `high`), ad fatigue (frequency > 2.5 → `medium`), CTR drop (7d avg < 70% of 30d avg → `medium`). Overspend alert omitted — `campaign_metrics` has no budget column and Meta campaign IDs can't reliably join to `campaigns.budget` (Supabase UUID ≠ Meta string ID).
  - **Cross-agent context injection**: when the Arjun→Aanya campaign chain runs, `buildMetricsContext()` is called fire-and-forget first; if `has_data: true`, the `MetricsContext` is injected into `runArjun()` via `projectContext: { recent_metrics: mc }`. A metrics query failure never blocks the campaign turn.
  - **Background anomaly job**: `supabase/functions/dhruv-anomaly-check/index.ts` — pg_cron hourly, `--no-verify-jwt`, zero LLM cost. Runs `buildMetricsContext()` for every org with an active Meta integration. High-severity alerts → inserts one `notifications` row per org per day (deduplicated to avoid hourly spam). Errors per-org are swallowed. Migration `20260626010000` schedules it.
  - **Dashboard cards (React, zero LLM)**: `src/components/DhruvInsightCards.tsx` calls `buildMetricsContext()` directly via `src/lib/metrics-query.ts` (client-side mirror of the server-side module). Renders alert cards with `red/amber/green` severity. Clicking a card pre-fills a question to aarav-orchestrate. No agent_turns row is created on dashboard load — Dhruv's LLM fires only when the user asks a conversational question.
  - **Canvas shape**: `{ dhruv: DhruvOutput, metrics_context: MetricsContext }` — keyed by `'dhruv'`. Client canvas rendering not yet implemented (turns display Aarav's text message only).
  - **Seed script**: `scripts/seed-dhruv-test-data.ts` (Deno, `deno run --allow-net --allow-env`) — 31 days of synthetic data across 3 campaigns. Intentionally triggers CPL spike (awareness campaign) and ad fatigue (conversion campaign). Delete with `DELETE FROM campaign_metrics WHERE campaign_id LIKE 'seed-%'`.
  - **Cost**: logged to `agent_interactions` as `agent: 'dhruv'` — covered by migration `20260626000000` which adds 'dhruv' to the CHECK constraint. `database.types.ts` updated to include `'dhruv'` in the agent union.
  - Prompt: `loadAgentPrompt('dhruv')` from `prompts.ts` — PLACEHOLDER v1.0. Three intent schemas defined. Refine separately.
- **Prompt versioning**: `_shared/agents/prompts.ts` is the single versioned registry (`loadAgentPrompt('arjun'|'aanya'|'diya'|'kavya'|'dhruv')`). All current bodies are marked **PLACEHOLDER v1.0** — they establish the JSON-only output contract so the orchestration plumbing works end-to-end; real prompt engineering is a separate pass (spec 5.1). Aanya's critique sub-prompt is loaded separately via `loadAanyaCritiquePrompt()` since it isn't versioned per-agent the same way. Diya's confirm step has no prompt (deterministic DB lookup); her check step uses `loadAgentPrompt('diya')`.
- **JSON parsing**: every specialist parses LLM output via `parseJsonObject()` (`_shared/agents/json-extract.ts`) — a brace-depth scanner that finds the first balanced `{...}` and strips markdown fences. Never use raw `JSON.parse` on LLM output; it breaks the moment the model adds a stray sentence before/after the JSON.
- **Langfuse**: every specialist call (Arjun's strategy call, Aanya's ideation call, each critique call, each image generation, each Diya vision call) is logged as a `GENERATION` observation nested under the parent `aarav-orchestrate` trace via `traceId` pass-through — never a bare `langfuseSpan` for an actual LLM/image/vision call (the brand-*confirm* step is the one exception — it's a DB lookup, not a model call, so it's logged as a `langfuseSpan`). Image bytes/URLs are never sent to Langfuse, only prompt text, verdicts, and `costMeta`.
- **Failure handling**: a failed specialist sets its `DelegationStatus` to `'failed'`, logs an `ERROR`-level Langfuse generation, still writes an `agent_interactions` row if any token usage was incurred before the failure, and the client always gets an Aarav-voiced fallback message — raw errors/stack traces never reach the response body. Arjun failing aborts the whole turn (no strategy to base creatives on); Aanya failing after Arjun succeeds still returns Arjun's strategy, with a note that creatives can be retried via Regenerate (and Diya's delegation is marked `'done'` since there's nothing left for her to check that turn); Diya failing returns Aanya's creatives anyway, all fail-safe flagged.

#### Image generation provider abstraction (`_shared/image-provider.ts`)

Per the spec amendment "Image Generation Provider Abstraction" — image generation must not be hardcoded to one model. `generateImage({ prompt, size?, quality?, providerHint?, traceId?, observationName? })` is the **only** place that constructs a request to an image-generation API; both `generate-image/index.ts` (browser-facing, via `gemini-service.ts`) and `aanya.ts` (server-side specialist) call this rather than talking to OpenAI/Gemini directly.
- Two providers wired up: **OpenAI GPT-Image-1** (default) and **Gemini 2.5 Flash Image** (`providerHint: 'gemini'`, reads `GEMINI_API_KEY` server-side secret — distinct from the client-side `VITE_GEMINI_API_KEY` used by the deprecated Imagen 3 path, different trust boundary, do not conflate them). Provider selection: env var `IMAGE_PROVIDER`, default `'openai'`. Adding a third provider means a new case in `generateImage()`'s switch plus a new member of the `ImageProvider` union — no caller code changes.
- **`describeImageForFlux` in `src/lib/ai-service.ts` is NOT an image generator** — it's a Claude-vision helper that describes an *existing* uploaded image as enrichment input to the client-side senior-designer prompt builder (see "Reference images" in section 2 above). Flux is never called as a generator anywhere in this repo.
- Returns `{ imageBase64, mimeType, providerUsed, costMeta: { provider, model, unitCost, currency } }` — `unitCost` is an approximate per-image USD figure (`OPENAI_IMAGE_COST_USD` by quality tier, or a flat `GEMINI_IMAGE_COST_USD`, both in `image-provider.ts`), good enough for cost-tracking/benchmarking, not invoicing-grade — re-verify against each provider's pricing page before using for real billing.
- API keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`) are read from `Deno.env` inside this module only — never exposed to the client bundle.
- **One-off benchmark**: `benchmark/image-providers.ts` (Deno script, NOT deployed) calls `generateImage()` across both providers over 8 representative Indian real-estate briefs (apartment launch, villa, plot, commercial, pre-launch teaser, price-drop, amenity, connectivity) to produce real per-image/per-interaction cost and latency data for the §5.5/§6.5 decisions — see that file's header comment for usage. Run with `deno run --allow-net --allow-env --allow-read --allow-write benchmark/image-providers.ts`; output (images + `results.csv`/`.md` + a quality-scoring template) lands in `benchmark/output/` (gitignored).

#### `agent_interactions` table (cost ledger)

Migration `20260616080000`. One row per specialist run per `aarav-orchestrate` invocation: `org_id, user_id, agent ('aarav'|'arjun'|'aanya'|'diya'), trace_id, model, input_tokens, output_tokens, cost_usd, created_at`. Aarav writes a zero-cost stub row on every turn (pure orchestration, no model call at that layer). Diya's `runBrandConfirm` (a DB lookup, no model call) does not write a row; her `runBrandCheck` writes one row aggregating all per-variant vision calls in that batch (same one-row-per-run convention as Aanya's loop). RLS: org-scoped SELECT only (`TO authenticated`); writes always go through the server-side admin/service-role client in `aarav-orchestrate`, never client-writable.

---

### 6. Langfuse — LLM observability

All LLM calls in the app are traced to Langfuse (project: AWAAS, host `https://us.cloud.langfuse.com`). No-ops cleanly everywhere if `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` aren't set, so missing config never breaks a real request.

**Why the secret never touches the browser**: `LANGFUSE_SECRET_KEY` is a true secret (Basic Auth credential for the ingestion API) and must stay server-side, same rule as `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` server secrets elsewhere in this doc. It is set as a Supabase Edge Function secret (`supabase secrets set LANGFUSE_SECRET_KEY=... LANGFUSE_PUBLIC_KEY=... LANGFUSE_HOST=...`), never as a `VITE_`-prefixed var.

**Shared client**: `supabase/functions/_shared/langfuse.ts` — hand-rolled against the (legacy but still supported) `POST /api/public/ingestion` batch endpoint rather than the OTel SDK, since Edge Functions are short-lived Deno isolates where pulling in `@opentelemetry/sdk-node` + `@langfuse/otel` is unnecessary weight for a few awaited fetch calls. Exports:
- `langfuseTrace(traceId, { name, userId?, sessionId?, tags?, metadata?, input? })` — one per request/flow
- `langfuseGeneration(traceId, { name, input?, output?, model?, inputTokens?, outputTokens?, level?, statusMessage? })` — for an actual LLM call. Always use this (not `langfuseSpan`) for model calls — Langfuse needs the GENERATION observation type to compute cost/token analytics.
- `langfuseSpan(traceId, {...})` — for non-LLM orchestration steps only.

**Server-side instrumentation** (secrets safe here — these functions already hold `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`):
- `aarav-orchestrate/index.ts` — one trace per orchestration call, tagged `['leadgen-v2', 'aarav']`, `sessionId` = the request's `session_id` (groups a conversation in the Sessions view). Arjun's call is logged as an `arjun-strategy` generation, Aanya's ideation/critique/image calls nest under the same trace (see Aanya above), and Diya's confirm step is a `diya-brand-confirm` span with her per-variant vision calls logged as `diya-brand-check-{angle}` generations.
- `generate-image/index.ts` (OpenAI GPT-Image-1, via `_shared/image-provider.ts`) — one trace + provider-tagged generation per image. Image bytes are never sent to Langfuse, only the prompt and `{ imageGenerated: true, costMeta }`.

**Client-side instrumentation** (`src/lib/ai-service.ts`): `Strategy.tsx`, `Creatives.tsx`, `AanyaMemory.tsx`, and everything else that calls `aiCall`/`aiVision`/`describeImageForFlux` get tracing automatically. All Claude calls go through the `claude-proxy` Edge Function — there are no direct browser-to-Anthropic fetches (`getApiKey()` has been removed).
- Since the Langfuse secret can't ship to the browser, these calls go through a new proxy Edge Function: `supabase/functions/langfuse-ingest/index.ts`. It requires a valid Supabase Authorization header (so it can't be used as an open relay), accepts `{ traceName, sessionId?, tags?, input?, output?, model, inputTokens?, outputTokens?, level?, statusMessage?, metadata? }`, and forwards to Langfuse using the secret stored in its own environment. No Claude/Anthropic API key ever passes through this function. It also defensively scrubs any `sk-ant-...`/`sk-lf-...`/`Bearer ...` substrings from input/output/metadata before forwarding.
- `logToLangfuse()` (exported from `ai-service.ts`) is the fire-and-forget helper every call site uses — a tracing failure must never surface as a user-facing error, so it's always `.catch()`-swallowed.
- `getBrowserSessionId()` generates one UUID per browser tab (`sessionStorage`) so a multi-step flow (e.g. Strategy's brief generation → Aanya creative-prompt upgrade) groups into one Langfuse Session instead of unrelated traces.
- Vision call messages (which embed base64 image bytes) are redacted to `{ type: 'image', source: '[redacted image data]' }` before being sent — image pixels are never sent to Langfuse.
- High-value call sites pass an explicit `traceName` for analytics (`strategy-quick-generate`, `strategy-full-strategy`, `strategy-full-aanya-creative`, `creatives-variant-generate`, `creatives-reference-analysis`, `aanya-memory-synthesize-dna`, `aanya-memory-vision-analysis`). Other call sites (`Organic.tsx`, `AdConfig.tsx`, `SMMPlanner.tsx`, `CampaignWizard.tsx`, `SMMCreatives.tsx`, `SMMAnalyzer.tsx`, `Analyzer.tsx`, `AIChatbot.tsx`, `TargetingVerifier.tsx`, `InlineCreativeReview.tsx`, `AdReview.tsx`) still get traced automatically (default trace name `claude-call`/`claude-vision`) since they all go through the same `aiCall`/`aiVision` functions — add an explicit `traceName` to any of them when you next touch that file, so it's filterable by feature in the Langfuse UI.

**Note**: `AanyaMemory.tsx`'s `analyzeCreativeWithVision()` calls `claude-proxy` directly (not via `aiVision` helper) and traces as `aanya-memory-vision-analysis` using an inline `logToLangfuse` call.

**Adding tracing to a new LLM call site**:
- New client-side call through `aiCall`/`aiVision`: nothing to do, it's automatic — optionally pass `{ traceName: 'my-feature-name' }` as the trailing options arg for better filtering.
- New client-side call that bypasses `ai-service.ts` (a direct `supabase.functions.invoke('claude-proxy', ...)` call, like `AanyaMemory.tsx`'s `analyzeCreativeWithVision`): import `logToLangfuse` from `ai-service.ts` and call it after the response, redacting any image/base64 data first.
- New server-side Edge Function with an LLM call: import `langfuseTrace`/`langfuseGeneration` from `_shared/langfuse.ts`, same pattern as `generate-image/index.ts`.

---

## Image Generation Provider — Switching Guide

> Current provider: **OpenAI GPT-Image-1** (upgraded 2026-06-12 from DALL-E 3)
> Previous providers: DALL-E 3 → NVIDIA NIM FLUX.1-schnell (unreliable, commit `dbab464`) → Google Gemini Imagen 3 (commit `01090f9`)

This section documents exactly what to change to switch between providers so no institutional knowledge is lost.

### Current image generation approach (text rendered in image)

**2026-06-12**: Aanya's prompts now generate complete ad creatives with text rendered directly in the image (not as CSS overlays). This matches professional real estate advertising standards — headlines, pricing, CTAs, and feature boxes are all integrated into the image composition. Section 6 of the 9-section prompt specifies exact text content, fonts, sizes, colors, positions, and graphical containers (colored panels, buttons, etc.). GPT-Image-1 renders these text elements at generation time. CSS overlay and Canvas compositor (`ad-compositor.ts`) are deprecated for primary text rendering (kept for backward compatibility).

### Why GPT-Image-1 prompts use 9-section structure

GPT-Image-1 responds well to descriptive prose divided into clear functional sections. The 9-section format provides architectural clarity: scene narrative → composition breakdown → camera/lens → lighting → color palette → text rendering instructions → brand elements → negatives → technical specs. This explicit structure helps the model understand both visual intent and typographic requirements. The original Gemini Imagen 3 format used the same 9-section approach (see `git show 24347b2:src/lib/senior-designer-prompts.ts` for reference).

### To revert to a previous provider

- **Imagen 3**: `git show 01090f9` for the original `gemini-service.ts` direct-fetch implementation. Original prompts: `git show 24347b2:src/lib/senior-designer-prompts.ts`. Requires `VITE_GEMINI_API_KEY` in `.env`; drop the `generate-image` edge function call.
- **DALL-E 3**: change `model: 'gpt-image-1'` → `'dall-e-3'`, portrait size `1024x1536` → `1024x1792`, quality `'low'|'medium'|'high'` → `'standard'|'hd'` in `generate-image/index.ts`.

### Provider-agnostic constraints (keep regardless of which model is active)
- Storage path + deterministic upsert pattern — keep regardless
- `creative_assets.model_used` — update to match active provider
- `ImageGalleryViewer` overlay (CSS text) + `ad-compositor.ts` (download bake) — keep regardless; they layer on top of any image

---

## Key Tables

**RLS hardened for web deployment** — all tables now use org-scoped policies (`org_id = get_current_user_org_id()`). See migration `20260610150000`. Data tables require `TO authenticated` only (anon access removed). `profiles` has a BEFORE UPDATE trigger blocking self-privilege escalation on `role`, `module_access`, `daily_ai_limit`, `org_id`.

| Table | Migration | Purpose |
|---|---|---|
| `organizations` | `20260609120000` | Org identity + brand settings (name, slug, brand_colors, tone_of_voice, etc.) |
| `profiles` | `20260409085002` | Auth user profiles — org_id, role, module_access, `tier` (migration `20260620000000`, default `'profile_2'`). Trigger auto-creates on signup |
| `projects` | `20260409123924` | Real-estate projects per org |
| `campaigns` | `20260409123924` | Ad campaigns per project |
| `daily_metrics` | `20260409123924` | Daily ad spend/leads/clicks/impressions |
| `notifications` | `20260409123924` | Per-user in-app notifications |
| `ai_sessions` | `20260409123924` | AI interaction log (strategy, ad_copy, creative, analysis). Has `project_ids uuid[]` written by Strategy.tsx. Token columns added via `20260610160000`: `claude_input_tokens`, `claude_output_tokens`, `gemini_images_generated` |
| `activity_log` | `20260411063514` | Audit trail of user actions |
| `awaas_data_pool` | `20260411084151` | AWAAS market data reference pool |
| `targeting_keywords` | `20260415072948` | Ad targeting keywords per project |
| `chatbot_log` | `20260429081859` | AIChatbot conversation history |
| `campaign_metrics` | `20260604120000` | Auto-fetched Meta Ads stats (via pg_cron every 15 min) |
| `creative_assets` | `20260604120000` | Generated images + editing lifecycle. Has `session_id uuid` to group 3-image sets |
| `org_integrations` | `20260604120000` | Org-level API tokens (Meta, Google) |
| `org_user_integrations` | `20260604120000` | Per-user OAuth tokens (Canva) |
| `integration_sync_log` | `20260604120000` | Audit trail for sync attempts |
| `competitors` | `20260609130000` | Competitor names per org. UNIQUE (org_id, name) constraint added via `20260610140000` |
| `brand_kits` | `20260609130000` | Design system per org (colors, fonts, brand voice). One row per org |
| `lead_funnel` | `20260609130000` | Weekly lead funnel metrics (total_leads, contacted, sv_done, booked). Has `project_id uuid` (migration `20260610130000`) — enables join with `ai_sessions` on org_id + project_id + ISO week |
| `organic_plans` | `20260609130000` | AI-generated weekly organic social media plans |
| `events_calendar` | `20260609130000` | Holidays/festivals/custom events for SMM planning |
| `smm_calendar` | `20260609130000` | Scheduled social media posts (captions, hashtags, status) |
| `smm_metrics` | `20260609130000` | Daily Instagram/Facebook snapshot metrics. UNIQUE on (org_id, platform, date) |
| `wizard_sessions` | `20260609130000` | Campaign Wizard multi-step session state (step_data jsonb) |
| `project_assets` | `20260609130000` | Reference images per project (asset_type, is_primary, display_order) |
| `project_design_systems` | `20260609130000` | Learned creative DNA per project. UNIQUE on project_id |
| `benchmarks` | `20260609130000` | KPI benchmarks per org/project (7d/14d rolling averages) |
| `creatives` | `20260609130000` | AI-generated ad creative records (headline, primary_text, design_dna_tags) |
| `creative_performance` | `20260609130000` | Metrics linked to individual creatives (cpl, ctr, performance_tier) |
| `agent_turns` | `20260617120000` | One row per `aarav-orchestrate` invocation. Realtime target for delegation-chip animation. `delegations jsonb` updated mid-turn. `approved_at` IS NOT NULL = idempotency sentinel. `cap_hit boolean` (migration `20260620010000`) — true when Aanya's budget ceiling was hit this turn. |
| `agent_messages` | `20260617120000` | Per-turn conversation record (user + aarav roles). Written on every turn completion. Canvas snapshot stored for recall. |
| `agent_memory` | `20260617120000` | Approved campaign decisions (strategy + selected creatives + brand verdict). Written on `action='approve'` only. Org+project scoped. **DO NOT add columns here** — semantic search is handled by `agent_memory_chunks` (projection in Phase B). |
| `agent_memory_chunks` | `20260625120000` | pgvector memory layer for semantic + hybrid search. Columns: `id`, `org_id`, `project_id`, `scope memory_scope`, `agent_name`, `content`, `embedding vector(1024)` (nullable = fail-soft), `salience real CHECK 0..1`, `access_count`, `last_accessed_at`, `expires_at`, `source_memory_id → agent_memory(id)`, `created_at`. Enum `memory_scope`: `('decision','project','builder','domain','shared','agent')`. Indexes: HNSW cosine, GIN tsvector, three btree. RLS: org-scoped same pattern as all tables. RPCs: `match_memory_chunks` (hybrid scorer) + `touch_memory_chunks` (access counter). **Phase B** (separate step, gated on cross-tenant isolation test): project `agent_memory` approved decisions into this table and wire `retrieveMemory()` in `aarav-orchestrate`. DOWN migration: `supabase/rollbacks/20260625120000_pgvector_memory_layer_down.sql`. |
| `aanya_training_creatives` | `20260613000000` | Real-world creatives Aanya trains on. source CHECK: own_ad/competitor/industry_reference/winning_template. performance_tier CHECK: top_performer/good_performer/average/underperformer/reference_only. `vision_analysis jsonb` stores Haiku description + patterns. `extracted_patterns jsonb` mirrors patterns array. RLS: org-scoped TO authenticated via `get_current_user_org_id()` — fixed in migration `20260613000000` (table was originally created via API with wrong/missing policies). Indexes: (org_id, project_id), (org_id, performance_tier). Images stored in `brand-assets` bucket under `aanya-training/{orgId}/` path. |

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
| `CampaignMetricsChart` | Stat cards + CSS bar chart + table from `campaign_metrics`. Has "Sync Now" button that calls `meta-insights-sync` edge function directly |
| `CreativeViewer` | 3-col grid, skeleton loaders, Realtime, full action set (approve/reject/regen/canva/adobe/download), lightbox. Uses `creative-assets` bucket. |
| `ImageGalleryViewer` | Post-generation gallery (`GalleryImage[]`). Maintains `localImages` state so edits update in place. Shows "Sync from Canva" button after Canva opens. Passes `storagePath`+`storageBucket="brand-assets"` to `AdobeExpressModal`. Has CSS overlay (`showOverlay` toggle) showing headline + CTA pill on each card. "Download Ad" button uses Canvas compositor (`composeAdImage`) to bake text into a ready-to-post JPEG. |
| `ad-compositor.ts` | Canvas-based compositor (`src/lib/ad-compositor.ts`). `composeAdImage(imageSrc, adCopy, colors)` loads image, draws gradient panel (bottom 42%), angle chip, word-wrapped headline, CTA pill. Returns base64 JPEG data URL. `DEFAULT_AD_COLORS = { primary: '#1a2332', accent: '#c9a961' }`. |
| `AdobeExpressModal` | Loads Adobe Express Embed SDK v4. Supports overwrite-in-place mode (pass `storagePath`) or legacy new-file mode (no `storagePath`). |
| `CanvaConnectButton` | Canva OAuth connect/disconnect, reads `org_user_integrations` |
| `Sidebar` | Collapsible sections (`Set<AppSection>` state). Section formerly "Dashboard" is now "Overview". Notifications and Projects only appear under Overview (removed from Lead Gen and SMM sections). Sidebar bg: `surface-sidebar` (`#DED5C6`), hover: `surface-sidebar-hover` (`#D0C5B3`). "Workspace" label removed. Reads `generatingPage` from `NavigationContext` — shows amber `Loader2` spinner on the nav item that is actively generating; all navigation remains freely clickable. Lead Gen section includes "Aanya's Memory" nav item. |
| `AanyaMemory` | `src/pages/AanyaMemory.tsx`. Upload drag-drop for real-world creatives. Tags: source (own_ad/competitor/industry_reference/winning_template), platform, performance_tier, CPL, CTR. Claude Haiku vision auto-analyses each upload (`analyzeCreativeWithVision` — calls `claude-proxy` Edge Function). **`VisionAnalysis` interface** (upgraded 2026-06-22): returns `{ description, patterns, section_1_scene_type, section_3_lens, section_4_lighting, section_5_hex_colors[], section_6_typography_elements[], composition_split, competitive_strengths[], avoid_reasons[] }` — 9-section-aligned so extracted data maps directly into GPT-Image-1 prompt sections. Typography elements use canonical type names: `MIXED_WEIGHT_HEADLINE | PRICE_BADGE | PHOTO_CAPTION_BAR | FEATURE_CHECKLIST | FOOTER_STRIP | CTA_BUTTON | SUBHEADLINE | TAGLINE`. "Synthesize DNA" calls Claude Sonnet (via `aiCall`), now consumes hex codes, lens/lighting, typography element types from `VisionAnalysis` → produces richer `best_performing_compositions` (with lens+split) and `best_performing_color_treatments` (with hex codes). Gallery with tier badges + expandable Aanya analysis. Filter by project + tier. **Crawl Parameters panel**: aggregates patterns by category, platform & source bar charts, CPL/CTR ranges, avoid-patterns. "Copy JSON" exports structured crawl brief. |

---

## Aanya Trainer → Strategy Feedback Loop (in progress)

Architecture to close the loop between real-world ad performance and Aanya's image generation. Fully backend — no user-facing rating UI. Implementation is phased; phases 1–2 complete.

### Implemented (2026-06-22)
- **Phase 1 — 9-section Haiku analysis**: `analyzeCreativeWithVision` extracts `VisionAnalysis` with section-aligned fields. `analyzeCompetitorWithDiya` (same model, competition-focused prompt) used for competitor/industry_reference uploads.
- **Phase 2 — Richer DNA synthesis**: `synthesizeDNA` consumes structured VisionAnalysis fields; outputs concrete hex codes, lens types, typography element names in `best_performing_*` arrays.
- **Phase 3 — Data retention + `is_live` cap**: `is_live boolean DEFAULT false` on `aanya_training_creatives` (migration `20260622000000`). Synthesis only deletes `is_live=false` rows. Arjun-promoted rows set `is_live=true`, capped at 10 per org (oldest demoted when 11th inserted).
- **Phase 4 — Arjun performance promotion**: `arjunPromoteCreatives(supabase, orgId)` in `meta-insights-sync/index.ts`. Runs fire-and-forget after each successful org sync. Reads `campaign_metrics` CPL last 14d → compares to `benchmarks.avg_14d` (metric_name='cpl', project_id IS NULL) → promotes `creative_assets` if ratio ≤ 0.95 benchmark. Project attribution via `creative_assets.creative_id → creatives.project_id`. Runs `runHaikuVision` (direct Anthropic API, ANTHROPIC_API_KEY from env) for 9-section `vision_analysis`.
- **Phase 5 — Diya competitor analysis**: `analyzeCompetitorWithDiya` in AanyaMemory replaces Haiku analysis for competitor/industry_reference source uploads. Competitive intelligence (strengths, gaps) integrated into `synthesizeDNA` prompt as a separate COMPETITOR INTELLIGENCE section. Competitor creatives separated from own_ad before synthesis.
- **Phase 6 — Section-level DNA injection**: `synthesizeDNA` now outputs `prompt_fragments jsonb` (section_1/3/4/5_hex/6_elements/8_avoid). Stored in `project_design_systems.prompt_fragments` (migration `20260622010000`). `formatDesignDNA()` in `senior-designer-prompts.ts` uses fragments for section-addressable injection when present; falls back to legacy soft-guidance block otherwise. `PromptFragments` interface exported from `senior-designer-prompts.ts`.
- **Phase 7 — Ad-level Meta sync**: `syncAdMetrics()` in `meta-insights-sync/index.ts` fires after campaign-level sync. Pulls `level: 'ad'` insights → upserts `ad_metrics` table (migration `20260622020000`). Fire-and-forget; never blocks main campaign sync. Enables future precise creative-level attribution for Arjun.
- **Meta permissions tutorial**: Collapsible in `SettingsPage.tsx`. Required permissions: `ads_read`, `ads_management`, `business_management`, `pages_read_engagement`.

### Key rules for this feature
- DNA re-synthesis is manual (user clicks Synthesize in AanyaMemory) — no auto-trigger.
- `arjunPromoteCreatives` and `syncAdMetrics` are fire-and-forget — errors logged to console, never surfaced to users or the sync log.
- `analyzeCompetitorWithDiya` is client-side via claude-proxy + Haiku — NOT routed through `_shared/agents/diya.ts` (which is server-only). Diya's competitive analysis is a prompt variant, not a separate Edge Function.
- `runHaikuVision` in `meta-insights-sync` calls Anthropic API directly (ANTHROPIC_API_KEY is a global Supabase secret, available to all edge functions).
- `is_live=true` rows are never deleted by synthesis — only `is_live=false` manual training uploads are cleared.
- Cap enforcement: per-org (not per-project) to keep storage simple. Future: per-project cap when volume justifies it.

### Key rules for this feature
- DNA re-synthesis is manual (user clicks Synthesize in AanyaMemory) — no auto-trigger.
- Arjun's performance promotion is silent — no UI feedback. It populates `aanya_training_creatives` in the background.
- Diya's competitor analysis runs only on `source IN ('competitor', 'industry_reference')` uploads. `own_ad` source uses the standard Haiku `analyzeCreativeWithVision`.
- `is_live=true` rows are never deleted by synthesis (only manual `is_live=false` rows are cleared).

---

## Generation State (cross-component)

`NavigationContext` carries `generatingPage: string | null` and `setGeneratingPage`. Strategy.tsx sets it to `'strategy'` whenever `submitting || geminiActive` is true and clears it on unmount. Sidebar reads it to show a spinner badge on the affected nav item. All navigation remains freely clickable — navigating away is allowed, but the Strategy component's in-progress state is lost on unmount.

## Quick Generate Ad flow (Strategy page)

`handleQuickSubmit` in `Strategy.tsx` **always** runs the Aanya senior-designer path — there is no `isNanobanana` gate or separate Meta/legacy branch.

1. User fills `QuickGenerateForm`: project, campaign goal, brief, **ad platform** (AiSensy or Meta Ads Manager)
   - `creativePlatform` dropdown removed — hardcoded to `'Nanobanana (Gemini)'`
   - Language selector + Quick Reference uploader always visible
2. `buildQuickGenerateBrief` builds senior-designer system/user prompts, passing `ad_platform`
   - **Meta Ads Manager**: headline ≤40 chars, first 125 chars of primary_text must be a standalone hook, description ≤30 chars, standard Meta CTA labels
   - **AiSensy (WhatsApp)**: headline = WhatsApp template header ≤60 chars, primary_text = conversational WhatsApp message body 300-500 chars, description = quick-reply button label ≤20 chars
3. Claude returns `SeniorDesignerResult` JSON → result stored as `type: 'quick_senior'`
4. `SeniorDesignerResultPanel` auto-triggers Gemini image generation on mount via `useEffect`
5. 3 images generated → uploaded to `brand-assets` bucket, `creative_assets` rows inserted
6. `ImageGalleryViewer` renders with Canva + Adobe Express CTAs

## AI Token & Image Count Tracking

`ai_sessions` now stores per-session token usage and Gemini image counts:
- `claude_input_tokens` — prompt tokens consumed by Claude (Aanya)
- `claude_output_tokens` — completion tokens from Claude
- `gemini_images_generated` — number of Gemini Imagen 3 images successfully returned (Imagen 3 has no token API; billing is per-image)
- `tokens_used` — legacy total (input + output) kept for backward compatibility

**Where populated:**
- `src/lib/ai-service.ts` — `aiCall` and `aiVision` return `_inputTokens`/`_outputTokens` metadata on every call
- `src/lib/session-logger.ts` — `logAiSession` accepts and writes all three new columns
- `Strategy.tsx` — quick generate and full strategy paths both accumulate token counts and pass them to `logAiSession`
- `Creatives.tsx` — Aanya 3-variant path accumulates `variantInputTokens`/`variantOutputTokens` across the loop; `logAiSession` called inside `.then()` callback so `imgs.length` is available as `geminiImagesGenerated`

**Reports.tsx AI Activity table** shows "Images" and "Cost (USD)" columns. Cost per session = `(in * 3 + out * 15) / 1_000_000 + images * 0.10`. Cumulative banner shows total tokens + total cost for last 20 sessions. Raw per-session token columns removed from table view.

## AI Sessions ↔ Lead Funnel link

`AiSessions.tsx` enriches strategy sessions with `lead_funnel` data:
- After loading sessions, extracts unique `project_ids[0]` from strategy/quick_generate/full_strategy sessions
- Bulk-fetches `lead_funnel` rows for those project IDs (`project_id IN (...)`)
- Matches each session to its funnel row using key: `project_id|ISO-week-start(created_at)` (Monday of that week)
- If matched, shows a green pill on the session row: "N leads · N SV · N booked"
- **No write path exists yet** — lead_funnel rows must be written with `project_id` set for this to surface data

---

## Creatives page image flow (Nanobanana path)

1. User selects project + funnel stage + **output ad platform** (Meta Ads Manager or AiSensy) → clicks "Generate 3 Variants"
2. `buildVariantBriefs` is called with `ad_platform` — Aanya generates 3 text variants with platform-specific ad copy
3. A `sessionId` UUID is created once for this batch
4. `generateImageWithGemini` is called for each prompt; result passed to `uploadGeminiImageToSupabase` with `{ sessionId, angleLabel, funnelStage, projectId }`
5. `uploadGeminiImageToSupabase` uploads to `brand-assets` at deterministic path, inserts `creative_assets` row, returns `{ url, id, storagePath }`
6. `GalleryImage` objects carry `{ url, id, label, storagePath }` — **id is always set**
7. `ImageGalleryViewer` renders with Canva + Adobe Express CTAs
8. **Adobe Express edit**: saves to same `storagePath` (overwrites), gallery updates live
9. **Canva edit**: opens external tab, "Sync from Canva" button appears; `canva-sync-design` exports and overwrites storage path, gallery updates live

---

## Known-Fixed Bugs (do not re-introduce)

Only non-obvious bugs where the root cause isn't immediately visible in the code.

| # | File | Bug | Fix |
|---|---|---|---|
| 1 | `canva-oauth-callback` | Browser redirects carry no auth header → `getUser('')` always null | `CanvaConnectButton` encodes `{returnUrl, userId, orgId}` as JSON in `state` param; callback parses state instead of reading auth header |
| 2 | `canva-sync-design` | Poll loop 20×1500ms = 30s → exceeded Edge Function wall-clock limit | Capped at 10 iterations (15s max) |
| 5 | `ImageGalleryViewer` | Canva sync matched on stale `img.url` (changed after prior Adobe Express edit) → silent discard | Switched to `id`-based match with url fallback |
| 8 | `ImageGalleryViewer` | `canvaDesignIds` reset on every parent re-render → Sync button vanished mid-session | Uses `sessionKeyRef` — only resets when first image id/url actually changes |
| 11 | `Strategy.tsx` | `isNanobanana` gate caused text-only output for non-Nanobanana platforms | Gate + dropdown removed; `handleQuickSubmit` always runs senior-designer path |
| 16 | `profiles` RLS | SELECT `USING (auth.uid() = id)` → org user list queries returned only the logged-in user | Migration `20260610150000` — SELECT now org-scoped |
| 17 | `gemini-service.ts` | `(asset as { id: string }).id` throws TypeError when RLS silently blocks INSERT (asset is null, error is also null) | Explicit null guard before cast |
| 23 | `senior-designer-prompts.ts` | Prices rendered as `$` USD in generated images | RULE 8: always `₹` / `Rs`. NEVER `$`, USD, Dollars. Fallback brand kit: `#1A3A5C` / `#C9A961` / `#FFFFFF`. |
| 29 | `aanya_training_creatives` | Table created via API with wrong RLS policies → INSERT always blocked | Migration `20260613000000` recreates 4 org-scoped policies using `get_current_user_org_id()` |
| 31 | `ai-service.ts`, `Analyzer.tsx`, `AanyaMemory.tsx` | App prompted user to enter Claude API key in browser | All Anthropic calls route through `claude-proxy` Edge Function. `getApiKey()` / `VITE_ANTHROPIC_API_KEY` removed. |

## Rules

- Every table has RLS with org_id scoping — `USING (org_id = get_current_user_org_id())`, `TO authenticated` only. Helper function `get_current_user_org_id()` is SECURITY DEFINER in migration `20260610150000`. `organizations` uses `id = get_current_user_org_id()`, `notifications` uses `user_id = auth.uid()`, `org_user_integrations` adds `user_id = auth.uid()` on top.
- `profiles` has BEFORE UPDATE trigger `prevent_self_privilege_escalation()` — blocks changes to `role`, `module_access`, `daily_ai_limit`, `org_id` on own row. Admins can update other users' profiles (separate policy).
- Edge Functions use service role key — never expose to client
- All images stored in Supabase Storage, never rely on external URLs
- Realtime subscriptions for live UI updates (no frontend polling)
- Never modify existing tables destructively (only ADD columns)
- Meta API: always async POST, never sync GET for insights
- Errors per-org in sync jobs — one org failing must not block others
- No charting libraries — use CSS/inline-style bars matching existing Analyzer pattern
- Migration timestamps use format `YYYYMMDDHHMMSS`; wrap ALTER in DO blocks
- **DOWN migrations** live in `supabase/rollbacks/` (NOT `supabase/migrations/`) — same timestamp prefix as their UP, but the CLI only scans `migrations/` so they never get auto-applied. Apply manually: `supabase db query --linked -f supabase/rollbacks/<file>.sql`.
- **`match_memory_chunks` canonical signature (Phase B wiring reference)**:
  ```
  match_memory_chunks(
    query_embedding  vector,          -- 1024-dim; pass as float[] from JS client
    query_text       text,
    filter_scope     memory_scope DEFAULT NULL,
    filter_project   uuid         DEFAULT NULL,
    match_count      int          DEFAULT 10
  ) RETURNS TABLE (
    id           uuid,
    content      text,
    scope        memory_scope,
    agent_name   text,
    salience     real,
    similarity   real,
    hybrid_score real,
    created_at   timestamptz
  )
  ```
  Called via Supabase JS: `supabase.rpc('match_memory_chunks', { query_embedding: [...], query_text, filter_scope?, filter_project?, match_count? })`. SECURITY INVOKER — RLS enforces tenancy automatically. Do NOT pass `org_id` as an argument; it is not in the signature.
- Storage: edited images always overwrite original file (same path, `upsert: true`) to avoid file accumulation
- `uploadGeminiImageToSupabase` return type is `GeminiUploadResult = { url, id, storagePath }` — callers must use `.url` not the raw return value
- **`brand_kits` is strictly org-level** — one row per org (`UNIQUE org_id`), **no `project_id` column**. `runBrandConfirm()` looks up by `org_id` only. `projectId` is threaded through Diya for a future per-project override but is unused in the query today. Adding per-project / agency branding requires: (1) a migration to add `project_id uuid REFERENCES projects(id)` on `brand_kits` (drop or relax the current UNIQUE constraint), (2) a change to Diya's `runBrandConfirm`/`runBrandCheck` to load by `(org_id, project_id)` with org-level fallback. Do NOT add a `project_id` filter to the current query without that migration — it silently returns no kit and flags every creative.
- **Edge Function DB types**: `supabase/functions/_shared/database.types.ts` is **hand-written** (not CLI-generated — see file header). Its `Update` types are written out concretely (all fields optional, same shape as `Insert`) to avoid the `Partial<Database[...]['Insert']>` self-referential pattern that collapses Supabase query-builder types to `never` in Deno. Update this file manually whenever a migration adds/alters columns. **Regenerating via CLI**: `supabase login && supabase gen types typescript --project-id mpvdpdxzqnidwyihyhbn > database.types.generated.ts` — then copy the generated file over and run `deno check supabase/functions/aarav-orchestrate/index.ts` before committing. If `deno check` passes, the CLI output is safe to use directly. If it fails with a `never` collapse, restore the hand-written file and use the generated output only as a column reference. **This test has not been run** — CLI gen-types compatibility with the hand-written format is unverified. All `createClient<Database>()` calls are in edge functions; never use untyped `createClient()`. Type casts (`as unknown as Json`) are acceptable where TypeScript can't infer that an app-level struct is JSON-serialisable — these are real casts, not `any` workarounds.
- **CI gate (real enforcement)**: `.github/workflows/typecheck.yml` is the authoritative type-check gate — three parallel jobs on every push and PR to `main`: (1) `build` → `npm ci` + `npm run typecheck` + `npm run build` (Node 20); (2) `edge-typecheck` → `deno check` on all 10 Edge Function entry points (`supabase/functions/deno.json` is auto-discovered as the config); (3) `edge-unit-tests` → `deno test --allow-env supabase/functions/_shared/agents/` (auto-discovers `*_test.ts` files; tests needing live credentials are `ignore:true` or `ignore: !SMOKE_ENV_VAR` — no secrets configured in CI). This workflow cannot be bypassed with `--no-verify`. `npm run typecheck` runs `tsc --noEmit` (strict mode) — as of 2026-06-19 the codebase is at **zero TypeScript errors** (was 65 pre-existing errors fixed in this session); do not add new errors. When a new `supabase/functions/*/index.ts` is created, add it to the `deno check` list in both `typecheck.yml` and `scripts/hooks/pre-push`, AND add it to the `deploy-functions.yml` loop (with `--no-verify-jwt` only if the function is called without a user JWT, e.g. by pg_cron).
- **Automated Edge Function deployment**: `.github/workflows/deploy-functions.yml` auto-deploys all edge functions on every push to `main` that touches `supabase/functions/**`. Uses the Supabase CLI (no Docker ECR issues in GitHub Actions). Requires one GitHub repository secret: **`SUPABASE_ACCESS_TOKEN`** (set this at GitHub → repo Settings → Secrets → Actions → New repository secret; value = the Supabase personal access token). `meta-insights-sync` and `dhruv-anomaly-check` are deployed with `--no-verify-jwt` (both called by pg_cron, no user JWT); all others with JWT verification. Also has `workflow_dispatch` for manual redeploys (e.g. after adding a new Supabase secret). `typecheck.yml` catches type errors before code reaches `deploy-functions.yml` — the two workflows are separate so a deploy failure doesn't block type checks.
- **Test files in `supabase/functions/_shared/agents/`**: `aanya_test.ts` (4 tests: iteration cap, early exit, critique-throws, image-gen failure — all credential-free); `aanya_budget_test.ts` (2 tests: tiny cap returns best-of-current without error; no-prior-image re-throws BudgetCapError); `diya_smoke_test.ts` (2 tests: `no-kit org flags all` runs in CI since `kit: null` short-circuits before any API call; on-brand/off-brand discrimination test auto-ignores in CI via `ignore: !SMOKE_ON_BRAND_URL || !SMOKE_OFF_BRAND_URL`); `kavya_test.ts` (10 tests: 5 credential-free intent detection tests run in CI; 5 LLM integration tests gated behind `ignore: !ANTHROPIC_API_KEY` for local smoke-testing); `dhruv_test.ts` (9 tests: 5 credential-free intent detection tests run in CI — report/reactive/fatigue routing, not-Dhruv negatives, report-over-analytics precedence; 4 LLM integration tests gated behind `ignore: !ANTHROPIC_API_KEY` — reactive cites real numbers, report has all sections, dashboard has 3-5 severity cards, empty context triggers honest "not enough data" response). These are the only test files — do not add `*.test.ts` variants that duplicate them.
- **Local pre-push hook (optional, committed)**: `scripts/hooks/pre-push` mirrors the CI checks and IS committed to the repo. Opt in once per clone: `git config core.hooksPath scripts/hooks`. If `deno` is not on `PATH`, the deno steps are skipped with a warning and CI catches them. Bypass with `git push --no-verify` only in a genuine emergency — CI remains the real backstop. `.git/hooks/pre-push` (untracked, if present from a prior session) is superseded by this committed version.
- **Edge Function deployment fallback (Docker ECR CDN failure)**: `supabase functions deploy` requires Docker to pull `public.ecr.aws/supabase/edge-runtime:v1.74.1`. When CloudFront returns EOF errors (known intermittent issue), deploy via the Management API instead: (1) Create a self-contained single-file version — replace `import type { ... } from '../_shared/database.types.ts'` with inlined type literals and change `https://esm.sh/@supabase/supabase-js@2` → `npm:@supabase/supabase-js@2` (esm.sh requires network fetch at runtime; `npm:` resolves natively in the edge runtime). Also replace `createClient<Database>` → `createClient`. (2) `PATCH https://api.supabase.com/v1/projects/mpvdpdxzqnidwyihyhbn/functions/{slug}` with `{ "body": "<source>", "verify_jwt": false }` and `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`. The codebase source file (with proper shared imports) is unchanged — only the deployed artifact differs. `meta-insights-sync` was successfully deployed this way as version 8 on 2026-06-22.
- **Token efficiency**: Keep all LLM calls lean — pass only the context the model genuinely needs. Avoid sending full conversation history, large blobs, or redundant fields in every call. Prefer focused single-purpose prompts over combined mega-prompts unless the task genuinely requires joint reasoning. For server-side specialists (Arjun, Aanya, Diya) keep `max_tokens` sized to the task (strategy brief ≠ image generation). For client-side `aiCall`/`aiVision` calls, scope `max_tokens` to the minimum viable for the response shape expected.
- **Planning and thinking mode**: Use extended reasoning / planning passes for architectural decisions, multi-step flows, and any task where the wrong first choice is expensive to undo (schema changes, new Edge Functions, large refactors). For straightforward edits (bug fixes, copy changes, adding a field) act directly — do not spin up a planning pass for decisions that are obvious from the code. When genuinely unsure about approach, use `EnterPlanMode` before touching files.
- **CLAUDE.md updates are mandatory**: After every codebase change (new component, changed flow, new Edge Function, schema change, bug fixed, rule discovered) update the relevant section of this file before the task is considered complete. Stale context here causes wrong assumptions in future sessions.

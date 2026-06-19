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
- Writes to: `campaign_metrics` table
- API: `https://graph.facebook.com/v21.0` — always use async POST jobs, never sync GET
- Rate limit header: `X-FB-Ads-Insights-Throttle` — back off if `acc_id_util_pct > 75`
- Token stored encrypted in `org_integrations` table

### 2. Image Generation (creative variants)
- Client-side via `src/lib/gemini-service.ts` (Nanobanana path in `Creatives.tsx`)
- Also: Edge Function `supabase/functions/generate-creatives/` (used by `CreativeViewer`)
- Model: **OpenAI GPT-Image-1** via `https://api.openai.com/v1/images/generations`. Proxied via Edge Function `generate-image` (avoids browser CORS). Requires `OPENAI_API_KEY` secret in Edge Function environment. GPT-Image-1 always returns `data[0].b64_json` directly (no `response_format` param needed). Sizes: square→`1024x1024`, portrait→`1024x1536`, landscape→`1536x1024`. Quality: `low|medium|high`.
- **Prompt format (Aanya's 9-section structure)**: flowing prose narrative (500–800 words) — SECTION 1 (scene narrative) → SECTION 2 (subject & composition %) → SECTION 3 (camera lens mm + shot type) → SECTION 4 (lighting time + Kelvin + shadows) → SECTION 5 (color palette with hex codes) → SECTION 6 (typography layer to RENDER in image with text content, fonts, sizes, positions, graphical containers) → SECTION 7 (brand elements) → SECTION 8 (negative prompts) → SECTION 9 (technical specs). **CRITICAL: Section 6 now specifies text elements that the image model RENDERS directly into the image** — no CSS overlay needed. Text includes styling details, positions, and associated graphical elements (colored panels, buttons, boxes). Reference example matching professional real estate ad style (Neelachala Homes) lives in `senior-designer-prompts.ts`.
- `generateImageWithGemini()` calls `supabase.functions.invoke('generate-image', { prompt, width, height })` — Edge Function forwards to OpenAI and returns `{ base64, mimeType }`.
- `model_used` field in `creative_assets` is set to `'gpt-image-1'`.
- **Deploy required**: run `supabase functions deploy generate-image` after pulling this change.
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

### 3. External Editors — Edit-in-Place Flow

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

### 4. LeadGen V2 ("Aarav Agent") — feature-flagged scaffold

Split-pane agent workspace, scaffolded but **not live** — gated behind `LEADGEN_V2_ENABLED` (default false) so the existing Lead Gen tab/flows are untouched.

- Flag: `src/lib/feature-flags.ts` exports `LEADGEN_V2_ENABLED`, reads `VITE_LEADGEN_V2_ENABLED` env var (`'true'` to enable). Set in `.env` / `.env.example`, defaults to `false`.
- Gated at two call sites: `src/App.tsx` (`PageContent` falls back to `<Dashboard />` for the `'leadgen-v2'` route when off) and `src/components/layout/Sidebar.tsx` (`LEAD_GEN_NAV` only includes the "Aarav Agent ✦" nav item when the flag is on).
- Page: `src/pages/leadgen-v2/index.tsx` — renders a fixed split layout: left 360px conversation thread (`AaravThread`), right scrollable workspace canvas (`BrandCheckCard` → `StrategyCard` → `CreativeGrid`) with a footer `ApprovalBar`.
- Components in `src/pages/leadgen-v2/components/`: `AaravThread` (message bubbles + disabled mock input + `AgentStatusChip`), `AgentStatusChip` (idle/thinking/generating/ready states), `BrandCheckCard`, `StrategyCard`, `CreativeGrid` (3 placeholder tiles), `ApprovalBar` (Reject/Regenerate/Approve buttons, disabled unless status is `ready`).
- `src/hooks/useAgentSession.ts` — returns a fully static `MOCK_SESSION` (messages, strategy, creatives, brand check). **No network calls.** Exports the shared types (`AgentStatus`, `AaravMessage`, `MockStrategy`, `MockCreative`, `MockBrandCheck`, `AgentSession`).
- `src/hooks/useProfileMode.ts` — reads `profile_tier` from `localStorage`, defaults to `'profile_2'`. Tiers: `profile_1` (Starter) / `profile_2` (Growth) / `profile_3` (Enterprise), each with a label + description for upsell UI.
- Styling reuses existing design tokens only (`surface`, `border`, `text`, `brand`, `success`/`warning` semantic colors, `shadow-card`) — no new Tailwind config needed.
- `src/lib/access.ts` already maps `'leadgen-v2': 'strategy_quick'` for module access — unrelated to the feature flag, this just controls per-profile module visibility once the flag is on.
- `useAgentSession` (`src/hooks/useAgentSession.ts`) now calls the real `aarav-orchestrate` Edge Function. `sendMessage`, `regenerateCreatives`, and `requestChange` share one `inFlightRef` guard; `approveTurn` uses a separate `approveRef` — a double-click can never double-write the cost ledger or memory tables.
- **Phase 5 (complete)**: streaming delegation status via Realtime, approval gate, memory write. See below.

#### Phase 5 — Realtime turn tracking, approval gate, memory write

**New tables** (migration `20260617120000`):
- `agent_turns` — one row per `aarav-orchestrate` invocation. `delegations jsonb` updated after each specialist (`{arjun:'done', aanya:'working', diya:'pending'}`). Realtime target for live delegation chips.
- `agent_messages` — durable per-turn conversation record (user + aarav roles), written on every turn completion.
- `agent_memory` — approved campaign decisions (StrategyConfig + selected creatives + Diya verdict), org+project scoped. Written on `action='approve'` only.

**Turn timing / waitUntil decision**: worst-case ~120s (14 LLM calls + 3 image gens), well within Supabase's 600s default. Synchronous chain with interim UPDATE calls chosen over waitUntil — simpler and correct for this workload.

**Realtime flow**: `aarav-orchestrate` creates an `agent_turns` row immediately, then UPDATEs `delegations` after each specialist (Arjun done → `{arjun:'done', aanya:'working'}` → Realtime fires → chip animates). `useAgentSession` subscribes to `agent_turns` filtered by `org_id=eq.{orgId}`, checks `session_id` in callback. Subscription activates after first response provides `org_id`.

**Approve invariants**:
1. UI guard: Approve button sets `disabled` the instant `approveLoading` goes true (before server responds).
2. Hook guard: `approveRef` blocks a second request even if state update is delayed.
3. Server guard: `approved_at IS NOT NULL` check in `handleApprove()` returns early on re-call without any DB write.
All three are required; any one alone is insufficient.

**No Meta launch**: `action='approve'` sets `agent_turns.status='ready_to_launch'`. The UI surfaces this honestly ("Campaign saved — ready to launch. Ad publishing not yet connected."). Do NOT change this to 'approved' without adding a real Meta campaign-create call above the status update.

**Request-change**: `requestChange(text)` calls `aarav-orchestrate` with `action='request_change'` + the user's text + `edited_strategy` (current canvas strategy) so Arjun has context to revise from. Treated as a normal send_message turn server-side — no special routing. Conversation thread accumulates; no overwrite.

**ApprovalBar** now shows: Request Change (opens inline text input → submit → requestChange) / Regenerate / Approve & Save. After approve: locked green "ready to launch" bar. "Reject" renamed "Request Change" — re-enters orchestration.

**CreativeGrid** tiles are selectable (click to toggle, checkmark overlay). Selected ids passed to `approveTurn()`. All selected by default; resets when new creatives arrive.

**AaravThread** shows a `DelegationPanel` below the last message during any in-flight turn, animating per-agent rows in real time from Realtime updates.

**Hard budget/governance blocks on flagged creatives are Phase 6** — today a `flag` from Diya is advisory only (visible badge, never disabling the tile).

**Wall-clock timeout**: Supabase Free/Pro Edge Functions cap at **150 seconds** (not 600s — no `config.toml` means platform default applies; Team/Enterprise: 400s). Aanya's angle loop is now parallelised (`Promise.allSettled`) so worst case (3 angles × 3 iterations × ~25s per iteration) is max(one-angle) ≈ 75s, not 225s sequential — total turn ≈ 100–130s, within the 150s limit. Migration `20260617130000` adds a pg_cron job that marks agent_turns rows stuck in `'working'` for >10 min as `'failed'` (requires pg_cron extension enabled). `agent_memory.user_brief` column (migration `20260617140000`) stores the original user brief directly on the approved-decision row at approve time; GIN FTS index on `(user_brief || summary)` enables ILIKE search before pgvector is added (Phase 6). `useAgentSession` now resolves `org_id` from auth on mount in parallel with the greeting turn, so the Realtime subscription is active before the first HTTP response arrives.

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
- **Prompt versioning**: `_shared/agents/prompts.ts` is the single versioned registry (`loadAgentPrompt('arjun'|'aanya'|'diya')`). All current bodies are marked **PLACEHOLDER v1.0** — they establish the JSON-only output contract so the orchestration plumbing works end-to-end; real prompt engineering is a separate pass (spec 5.1). Aanya's critique sub-prompt is loaded separately via `loadAanyaCritiquePrompt()` since it isn't versioned per-agent the same way. Diya's confirm step has no prompt (deterministic DB lookup); her check step uses `loadAgentPrompt('diya')`.
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

### 5. Langfuse — LLM observability

All LLM calls in the app are traced to Langfuse (project: AWAAS, host `https://us.cloud.langfuse.com`). No-ops cleanly everywhere if `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` aren't set, so missing config never breaks a real request.

**Why the secret never touches the browser**: `LANGFUSE_SECRET_KEY` is a true secret (Basic Auth credential for the ingestion API) and must stay server-side, same rule as `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` server secrets elsewhere in this doc. It is set as a Supabase Edge Function secret (`supabase secrets set LANGFUSE_SECRET_KEY=... LANGFUSE_PUBLIC_KEY=... LANGFUSE_HOST=...`), never as a `VITE_`-prefixed var.

**Shared client**: `supabase/functions/_shared/langfuse.ts` — hand-rolled against the (legacy but still supported) `POST /api/public/ingestion` batch endpoint rather than the OTel SDK, since Edge Functions are short-lived Deno isolates where pulling in `@opentelemetry/sdk-node` + `@langfuse/otel` is unnecessary weight for a few awaited fetch calls. Exports:
- `langfuseTrace(traceId, { name, userId?, sessionId?, tags?, metadata?, input? })` — one per request/flow
- `langfuseGeneration(traceId, { name, input?, output?, model?, inputTokens?, outputTokens?, level?, statusMessage? })` — for an actual LLM call. Always use this (not `langfuseSpan`) for model calls — Langfuse needs the GENERATION observation type to compute cost/token analytics.
- `langfuseSpan(traceId, {...})` — for non-LLM orchestration steps only.

**Server-side instrumentation** (secrets safe here — these functions already hold `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`):
- `aarav-orchestrate/index.ts` — one trace per orchestration call, tagged `['leadgen-v2', 'aarav']`, `sessionId` = the request's `session_id` (groups a conversation in the Sessions view). Arjun's call is logged as an `arjun-strategy` generation, Aanya's ideation/critique/image calls nest under the same trace (see Aanya above), and Diya's confirm step is a `diya-brand-confirm` span with her per-variant vision calls logged as `diya-brand-check-{angle}` generations.
- `generate-image/index.ts` (OpenAI GPT-Image-1, via `_shared/image-provider.ts`) — one trace + provider-tagged generation per image. Image bytes are never sent to Langfuse, only the prompt and `{ imageGenerated: true, costMeta }`.

**Client-side instrumentation** (`src/lib/ai-service.ts`): `Strategy.tsx`, `Creatives.tsx`, `AanyaMemory.tsx`, and everything else that calls `aiCall`/`aiVision`/`describeImageForFlux` get tracing automatically — these are the functions that call `api.anthropic.com` directly from the browser using the user's own per-browser Claude key (a pre-existing architectural tradeoff, see `getApiKey()` — not something this integration changes).
- Since the Langfuse secret can't ship to the browser, these calls go through a new proxy Edge Function: `supabase/functions/langfuse-ingest/index.ts`. It requires a valid Supabase Authorization header (so it can't be used as an open relay), accepts `{ traceName, sessionId?, tags?, input?, output?, model, inputTokens?, outputTokens?, level?, statusMessage?, metadata? }`, and forwards to Langfuse using the secret stored in its own environment. No Claude/Anthropic API key ever passes through this function. It also defensively scrubs any `sk-ant-...`/`sk-lf-...`/`Bearer ...` substrings from input/output/metadata before forwarding.
- `logToLangfuse()` (exported from `ai-service.ts`) is the fire-and-forget helper every call site uses — a tracing failure must never surface as a user-facing error, so it's always `.catch()`-swallowed.
- `getBrowserSessionId()` generates one UUID per browser tab (`sessionStorage`) so a multi-step flow (e.g. Strategy's brief generation → Aanya creative-prompt upgrade) groups into one Langfuse Session instead of unrelated traces.
- Vision call messages (which embed base64 image bytes) are redacted to `{ type: 'image', source: '[redacted image data]' }` before being sent — image pixels are never sent to Langfuse.
- High-value call sites pass an explicit `traceName` for analytics (`strategy-quick-generate`, `strategy-full-strategy`, `strategy-full-aanya-creative`, `creatives-variant-generate`, `creatives-reference-analysis`, `aanya-memory-synthesize-dna`, `aanya-memory-vision-analysis`). Other call sites (`Organic.tsx`, `AdConfig.tsx`, `SMMPlanner.tsx`, `CampaignWizard.tsx`, `SMMCreatives.tsx`, `SMMAnalyzer.tsx`, `Analyzer.tsx`, `AIChatbot.tsx`, `TargetingVerifier.tsx`, `InlineCreativeReview.tsx`, `AdReview.tsx`) still get traced automatically (default trace name `claude-call`/`claude-vision`) since they all go through the same `aiCall`/`aiVision` functions — add an explicit `traceName` to any of them when you next touch that file, so it's filterable by feature in the Langfuse UI.

**Known gap / not yet covered**: `AanyaMemory.tsx`'s `analyzeCreativeWithVision()` is instrumented directly (it predates `ai-service.ts`'s helpers and makes its own `fetch` call) — traced as `aanya-memory-vision-analysis`.

**Adding tracing to a new LLM call site**:
- New client-side call through `aiCall`/`aiVision`: nothing to do, it's automatic — optionally pass `{ traceName: 'my-feature-name' }` as the trailing options arg for better filtering.
- New client-side call that bypasses `ai-service.ts` (a raw `fetch` to Anthropic, like `AanyaMemory.tsx`'s vision call): import `logToLangfuse` from `ai-service.ts` and call it after the response, redacting any image/base64 data first.
- New server-side Edge Function with an LLM call: import `langfuseTrace`/`langfuseGeneration` from `_shared/langfuse.ts`, same pattern as `generate-image/index.ts`.

---

## Image Generation Provider — Switching Guide

> Current provider: **OpenAI DALL-E 3** (switched 2026-06-11)
> Previous provider: **NVIDIA NIM FLUX.1-schnell** (commit `dbab464`) — was unreliable
> Earlier provider: **Google Gemini Imagen 3** (commit `01090f9`)

This section documents exactly what to change to switch between providers so no institutional knowledge is lost.

### Switching to GPT-Image-1 (upgrade from current DALL-E 3)

GPT-Image-1 is OpenAI's newer, higher-quality model. Requires same `OPENAI_API_KEY`.
In `supabase/functions/generate-image/index.ts` change:
```ts
model: 'dall-e-3'  →  model: 'gpt-image-1'
// and portrait size:
'1024x1792'         →  '1024x1536'
// remove quality: 'standard' — GPT-Image-1 uses quality: 'low' | 'medium' | 'high'
```
In `src/lib/gemini-service.ts` change `model_used: 'dall-e-3'` → `'gpt-image-1'`.
Then `supabase functions deploy generate-image`.

### Current image generation approach (text rendered in image)

**2026-06-12**: Aanya's prompts now generate complete ad creatives with text rendered directly in the image (not as CSS overlays). This matches professional real estate advertising standards — headlines, pricing, CTAs, and feature boxes are all integrated into the image composition. Section 6 of the 9-section prompt specifies exact text content, fonts, sizes, colors, positions, and graphical containers (colored panels, buttons, etc.). GPT-Image-1 renders these text elements at generation time. CSS overlay and Canvas compositor (`ad-compositor.ts`) are deprecated for primary text rendering (kept for backward compatibility).

### Why DALL-E 3 prompts use 9-section structure

DALL-E 3 and GPT-Image-1 respond well to descriptive prose divided into clear functional sections. The 9-section format (versus FLUX's 80–150 word keywords) provides architectural clarity: scene narrative → composition breakdown → camera/lens → lighting → color palette → text rendering instructions → brand elements → negatives → technical specs. This explicit structure helps the model understand both visual intent and typographic requirements. The original Gemini Imagen 3 format used the same 9-section approach (see `git show 24347b2:src/lib/senior-designer-prompts.ts` for reference).

### To revert to Google Gemini Imagen 3

**Step 1 — `src/lib/gemini-service.ts`**

Replace `generateImageWithGemini` body with the original direct-fetch implementation (no edge function needed):
```ts
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
function getGeminiApiKey(): string { return (import.meta.env.VITE_GEMINI_API_KEY as string) || ''; }

export async function generateImageWithGemini(prompt: string, aspectRatio: '1:1' | '9:16' | '4:5' = '1:1'): Promise<GeminiGeneratedImage[]> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set.');
  const url = `${GEMINI_BASE}/imagen-3.0-generate-002:predict?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspectRatio === '4:5' ? '4:5' : aspectRatio, addWatermark: false } }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error((err as {error?:{message?:string}}).error?.message ?? `Gemini error ${res.status}`); }
  const data = await res.json() as { predictions?: { bytesBase64Encoded: string; mimeType?: string }[] };
  return (data.predictions ?? []).map(p => ({ base64: p.bytesBase64Encoded, mimeType: p.mimeType ?? 'image/png' }));
}
```
Also update `model_used` in `uploadGeminiImageToSupabase` from `'nvidia-flux-schnell'` to `'imagen-3.0-generate-002'`.

**Step 2 — `.env` / Supabase secrets**

```
VITE_GEMINI_API_KEY=<your Google AI Studio key>
```
The `generate-image` edge function is no longer called. No NVIDIA_API_KEY needed.

**Step 3 — `src/lib/senior-designer-prompts.ts` — restore Aanya's 9-section rules**

Replace RULE 2–5 (current FLUX rules) with the original Imagen 3 rules:

```
RULE 2 — NINE-SECTION STRUCTURE: Every nanobanana_prompt_main contains exactly nine labeled sections, in order:
SECTION 1: SCENE NARRATIVE
SECTION 2: SUBJECT & COMPOSITION
SECTION 3: CAMERA & LENS
SECTION 4: LIGHTING
SECTION 5: COLOR PALETTE
SECTION 6: TYPOGRAPHY LAYER
SECTION 7: BRAND & PROJECT ELEMENTS
SECTION 8: NEGATIVE PROMPTS
SECTION 9: TECHNICAL SPECS
Skipping, merging, or relabeling sections is failure.

RULE 3 — NARRATIVE NOT KEYWORDS: Section 1 is 2-3 sentences of cinematic prose like a film director writing a shot description. NOT comma-separated. NOT bullets. Pure narrative paragraph. Google's Nanobanana documentation explicitly states narrative paragraphs produce dramatically better output than keyword lists.

RULE 4 — PHOTOGRAPHIC TERMINOLOGY: Section 3 names a specific lens (24mm wide-angle, 35mm prime, 50mm natural, 85mm portrait, 100mm macro), specific shot type (architectural, three-quarter, low-angle, aerial), and optionally camera body.

RULE 5 — LIGHTING WITH INTENT: Section 4 names time, color temperature in Kelvin, and shadow direction. Example: "Golden hour backlighting at 06:45 IST, warm 3200K, long soft shadows extending east-to-west."

RULE 6 — PER-ELEMENT TYPOGRAPHY: Section 6 specifies each text element separately as TEXT ELEMENT 1, TEXT ELEMENT 2, etc. Each has Content, Font, Size, Color, Position, and Treatment as distinct sub-fields.
```

Also update the `nanobanana_prompt_main` schema description in the output JSON section to:
```
"nanobanana_prompt_main": "Complete 9-section prompt with all nine SECTION headers verbatim. 500-800 words."
```
And restore the full reference example (NHCPL 9-section block) to the prompt. Full original text is in git: `git show 24347b2:src/lib/senior-designer-prompts.ts`

**Step 4 — RULE 3 (current) removes typography from prompts**

Delete `RULE 3 — NO TEXT IN IMAGE PROMPT` (Imagen 3 can natively render text; FLUX cannot). The CSS overlay / Canvas compositor (`ad-compositor.ts`) should still be kept for the "Download Ad" baked-image flow, but Imagen 3 prompts can again include typography instructions in Section 6.

### FLUX-specific constraints to keep regardless of provider
- Storage path + deterministic upsert pattern — keep regardless
- `creative_assets.model_used` — update to match active provider
- `ImageGalleryViewer` overlay (CSS text) + `ad-compositor.ts` (download bake) — keep regardless; they layer on top of any image

---

## Key Tables

**RLS hardened for web deployment** — all tables now use org-scoped policies (`org_id = get_current_user_org_id()`). See migration `20260610150000`. Data tables require `TO authenticated` only (anon access removed). `profiles` has a BEFORE UPDATE trigger blocking self-privilege escalation on `role`, `module_access`, `daily_ai_limit`, `org_id`.

| Table | Migration | Purpose |
|---|---|---|
| `organizations` | `20260609120000` | Org identity + brand settings (name, slug, brand_colors, tone_of_voice, etc.) |
| `profiles` | `20260409085002` | Auth user profiles — org_id, role, module_access. Trigger auto-creates on signup |
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
| `agent_turns` | `20260617120000` | One row per `aarav-orchestrate` invocation. Realtime target for delegation-chip animation. `delegations jsonb` updated mid-turn. `approved_at` IS NOT NULL = idempotency sentinel. |
| `agent_messages` | `20260617120000` | Per-turn conversation record (user + aarav roles). Written on every turn completion. Canvas snapshot stored for recall. |
| `agent_memory` | `20260617120000` | Approved campaign decisions (strategy + selected creatives + brand verdict). Written on `action='approve'` only. Org+project scoped. |
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
| `AanyaMemory` | `src/pages/AanyaMemory.tsx`. Upload drag-drop for real-world creatives. Tags: source (own_ad/competitor/industry_reference/winning_template), platform, performance_tier, CPL, CTR. Claude Haiku vision auto-analyses each upload (`analyzeCreativeWithVision` — direct browser call to Anthropic API, returns `{description, patterns}`). "Synthesize DNA" calls Claude Sonnet to distil patterns → upserts `project_design_systems`. Gallery with tier badges + expandable Aanya analysis. Filter by project + tier. **Crawl Parameters panel** (full-width, above gallery): aggregates top-performer patterns by category (Layout/Color/Typography/Copy angle/Composition/Mood), platform & source bar charts, CPL/CTR ranges, avoid-patterns from underperformers. "Copy JSON" exports a structured crawl brief for external agents. Upload button disabled-state now clearly grey (not invisible) when no file is selected. Bucket errors surface a human-readable setup instruction. |

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

Migration to run in Supabase dashboard:
```sql
ALTER TABLE lead_funnel ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lead_funnel_project_id ON lead_funnel(project_id);
```

---

### Image generation UI states (in `SeniorDesignerResultPanel`)
- **Loading**: amber spinner bar — "Generating Feed + Story images with Gemini Imagen 3…"
- **Error**: centered "server busy" card — dashed-circle SVG icon + "Server busy" heading + "Copy Prompt" + "Retry" buttons. Copy Prompt copies `nanobanana_prompt_main` to clipboard.
- **Success**: gallery via `ImageGalleryViewer` followed by a **collapsed prompt bar** — chevron toggle shows/hides `nanobanana_prompt_main` in a scrollable `pre`; bar also has inline **Copy** and **Regenerate** buttons. Collapsed by default. The old standalone prompt card below the gallery was removed.

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

| # | File | Bug | Fix |
|---|---|---|---|
| 1 | `canva-oauth-callback` | OAuth flow broken — browser redirects carry no auth header → `getUser('')` always null | `CanvaConnectButton` now encodes `{returnUrl, userId, orgId}` as JSON in the `state` param; callback parses state instead of reading auth header |
| 2 | `canva-sync-design` | Poll loop 20×1500ms = 30s sleep exceeded Edge Function wall-clock limit | Capped at 10 iterations (15s max sleep) |
| 3 | `canva-sync-design` | `asset.storage_path` null → `TypeError: null.startsWith(...)` | Added explicit null guard + clear 400 error |
| 4 | `StrategyResult.tsx` | `uploadGeminiImageToSupabase` result only `.url` extracted; `id`/`storagePath` discarded | `GeneratedImageState` now carries `assetId`/`storagePath`; `GeminiImageCard` uses Canva API when `assetId` exists |
| 5 | `ImageGalleryViewer` | Canva sync matched on stale `img.url` (changed after prior Adobe Express edit) → silent discard | Switched to `id`-based match with url fallback |
| 6 | `AdobeExpressModal` | DB update result never checked; `onSave` called even on RLS/network failure → edit lost on reload | Added `{ error: updateErr }` destructure + throw |
| 7 | `ImageGalleryViewer` | Canva sync DB update was fire-and-forget (unawaited) | `await`ed + `console.warn` on failure |
| 8 | `ImageGalleryViewer` | `canvaDesignIds` reset on every parent re-render → Sync button vanished mid-session | Uses `sessionKeyRef` — only resets when first image id/url actually changes (new generation) |
| 9 | `CampaignWizard.tsx` | `buildVariantBriefs` called without `ad_platform` | Added "Output Ad Platform" dropdown to `StepCreatives`; wired to `buildVariantBriefs` |
| 10 | `canva-open-editor` | `asset.image_url` passed to Canva with no null check → cryptic 500 | Added early 400 return when `image_url` is null |
| 11 | `Strategy.tsx` + `QuickGenerateForm.tsx` | `isNanobanana` gate caused text-only output for Meta/non-Nanobanana platforms; `creativePlatform` dropdown was misleading | Removed dropdown + gate; `handleQuickSubmit` always runs the senior-designer path → always auto-generates Gemini images |
| 12 | `Analyzer.tsx` | `CampaignMetricsChart` received `campaignId={projectId}` — project UUID never matches Meta campaign IDs → empty chart when any project selected | Removed campaignId prop; chart always shows all campaigns for the org |
| 13 | `SettingsPage.tsx` | API Configuration card exposed Claude key UI (redundant with .env) + stray `)}` from old `isAdmin()` guard on Meta Ads card | Removed API Configuration + AI Usage cards and all related state/functions; stray `)}` removed |
| 14 | `SettingsPage.tsx` | Competitor seeding used `insert` → duplicate rows on every reload | Switched to `upsert` with `ignoreDuplicates: true`; added client-side case-insensitive dupe check in `addCompetitor` |
| 15 | `UserManagement.tsx` | Reset Password used `supabase.auth.admin.updateUserById` — requires service role key, silently fails with anon key | Removed reset password button and function; password management is admin-only at org level |
| 16 | `profiles` RLS | SELECT policy `USING (auth.uid() = id)` → `UserManagement.tsx` `.eq('org_id', ...)` only returned the logged-in user's own row | Migration `20260610150000` — SELECT now org-scoped; separate admin UPDATE policy added |
| 17 | `gemini-service.ts` | `(asset as { id: string }).id` throws TypeError when RLS prevents row return after INSERT (asset is null, error is also null) | Added explicit null guard: throws a clear error message before the cast |
| 18 | `Creatives.tsx` + `QuickGenerateForm.tsx` | `URL.createObjectURL(image)` called on every render → blob URLs accumulate in memory on repeated regeneration, causing browser instability | Moved to `useEffect`-managed state (`imagePreviewUrl` / `referencePreviewUrl`) — URL created once per file, revoked on change or unmount |
| 19 | `StrategyResult.tsx` (`SeniorDesignerResultPanel`) | `handleGenerateWithGemini` only generated 2 images (Feed 1:1 + Story 9:16) instead of 3 | Added Portrait Feed 4:5 (1080×1350) as the third image; `generateImageWithGemini` now accepts `'4:5'` aspectRatio |
| 20 | `SeniorDesignerPrompts.ts` + `ImageGalleryViewer` | Text was specified for CSS overlay only (Section 6: "leave zones clean for overlay") → generated images had no integrated copy, required post-editing | Changed Section 6 to render text IN image: Aanya now specifies headline, CTA, pricing, feature boxes with fonts/colors/positions/graphic containers directly in prompt. GPT-Image-1 renders text at generation time. CSS overlay + Canvas compositor remain as fallback but secondary to image-rendered text. Matches professional real estate ad standard (Neelachala Homes style). Updated reference example to show complete ad creative generation. |
| 21 | `senior-designer-prompts.ts` + `StrategyResult.tsx` | All 3 generated images used the same `nanobanana_prompt_main` prompt — output was 3 identical layouts at different sizes | Added RULE 7 (three distinct layout paradigms): `nanobanana_prompt_main`=GRAPHIC_DESIGN_FRAME (Neelachala-style dark bg + photo cards + checklist + footer), `nanobanana_prompt_portrait`=PHOTOREALISTIC_SCENE (single cinematic hero, minimal), `nanobanana_prompt_story`=TYPOGRAPHY_FORWARD (bold headline dominates, building secondary). Added `nanobanana_prompt_portrait` to `SeniorDesignerResult` type. StrategyResult.tsx now passes each distinct prompt to its corresponding aspect ratio. |
| 22 | `CreativeInputs.tsx` — `QuickReferenceUploader` | Uploaded reference image thumbnail didn't render (Supabase `quick-references` bucket may not be public) + no visual confirmation of upload success | Now stores `preview_url` (local `URL.createObjectURL` blob) alongside `url` (storage public URL). Thumbnail uses `preview_url` so it always renders. Added spinner during upload, error message on failure, green "uploaded · Aanya will run Claude Vision" banner after success. Blob URLs cleaned up on unmount via `useRef`.
| 23 | `senior-designer-prompts.ts` | Price displayed as `$` (USD) in generated images | Added RULE 8: ALL prices must use ₹ or Rs. NEVER $, USD, Dollars. Added RULE 9: substitute all brief placeholders before output. Added explicit brand_kit→Section 6 field mapping in RULE 1. Fallback brand kit: `#1A3A5C` primary, `#C9A961` accent, `#FFFFFF` text. |
| 24 | `gemini-service.ts` + `generate-image` edge fn | Image quality was `medium` — not production-grade for customer ads | `generateImageWithGemini` now defaults to `quality: 'high'`. Edge function accepts and forwards `quality` param. Story prompt Section 9 also specifies `quality: high`. |
| 25 | `StrategyResult.tsx` | No save mechanism for generated creatives — all generated images silently remained in `status='generated'` state | Added `creativesSaved` state, `saveCreatives()` fn that updates `creative_assets.status='approved'` for all gallery image IDs. Amber banner shown when gallery has images but not yet saved; turns green on save. `NavigationContext` carries `hasUnsavedCreatives` flag. `App.tsx` `navigate()` shows `window.confirm` if unsaved. `beforeunload` event guard for browser close. |
| 26 | `Reports.tsx` | Token usage shown as raw in/out numbers; cost in USD | Replaced raw token columns with "Cost (INR)" column: `(input * $3 + output * $15) / 1M + images * $0.10` × 84 INR/USD. Cumulative banner shows total tokens, images, and ₹ cost. |
| 23 | `senior-designer-prompts.ts` + `gemini-service.ts` + `generate-image` edge fn | Story (9:16) consistently poor quality — 96–110pt headline at 1792px caused AI text rendering artifacts; `quality: medium` insufficient for complex story layout | Reduced headline to 64–76pt, added pixel-dimension anchors in Section 1 (1024×1792px), added text legibility negative prompts, changed Section 9 hint to `quality: high`. Edge fn now accepts `quality` param; `generateImageWithGemini` defaults 9:16→`high`. Deploy: `supabase functions deploy generate-image`.
| 24 | `StrategyResult.tsx` — `SeniorDesignerResultPanel` | No save action for generated creatives; images generated but user had no way to confirm/save; no navigation warning on unsaved creatives | Added `Save Creative` button below gallery that updates `creative_assets.status='approved'` for all session images. Amber "unsaved" banner shown until saved. `beforeunload` event fires until images are saved.
| 27 | `AanyaMemory.tsx` — `UploadCard` | Submit button invisible when no file selected — `text-surface` (cream) at `disabled:opacity-50` on gold `bg-accent` background bleaches to nothing | Changed disabled state to `disabled:bg-border disabled:text-text-muted` so button is always clearly visible; added "Select an image above to enable upload" hint text |
| 28 | `AanyaMemory.tsx` — `UploadCard` | Raw Supabase "Bucket not found" error shown with no actionable guidance | Error handler now detects bucket-related messages and surfaces: "Go to Supabase → Storage → New bucket → name it brand-assets → set Public." |
| 29 | `aanya_training_creatives` RLS | Table was created via Supabase API with auto-generated policies that don't match `get_current_user_org_id()` pattern → INSERT always threw "new row violates row-level security policy" | Migration `20260613000000` drops all existing policies and recreates 4 standard org-scoped policies (SELECT/INSERT/UPDATE/DELETE) using `get_current_user_org_id()`, matching every other table in the schema |
| 30 | `ProjectAssetsTab.tsx` | Upload to non-existent `project-assets` bucket failed silently — storage error only `console.error`'d, DB insert error never caught, no UI feedback | Switched to `brand-assets` bucket under `project-assets/` prefix (matching existing bucket). Added `uploadError` state + red error banner. DB insert error now caught + surfaced. Bucket-not-found message gives Supabase setup instructions. `deleteAsset` handles both old and new URL patterns. |

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
- Storage: edited images always overwrite original file (same path, `upsert: true`) to avoid file accumulation
- `uploadGeminiImageToSupabase` return type is `GeminiUploadResult = { url, id, storagePath }` — callers must use `.url` not the raw return value
- **`brand_kits` is strictly org-level** — one row per org (`UNIQUE org_id`), **no `project_id` column**. `runBrandConfirm()` looks up by `org_id` only. `projectId` is threaded through Diya for a future per-project override but is unused in the query today. Adding per-project / agency branding requires: (1) a migration to add `project_id uuid REFERENCES projects(id)` on `brand_kits` (drop or relax the current UNIQUE constraint), (2) a change to Diya's `runBrandConfirm`/`runBrandCheck` to load by `(org_id, project_id)` with org-level fallback. Do NOT add a `project_id` filter to the current query without that migration — it silently returns no kit and flags every creative.
- **Edge Function DB types**: `supabase/functions/_shared/database.types.ts` is hand-written from migrations. Update it whenever a migration adds/alters columns. Use `supabase gen types typescript --project-id mpvdpdxzqnidwyihyhbn` (requires `SUPABASE_ACCESS_TOKEN`) to regenerate from the live schema. **IMPORTANT**: `Update` types must be concrete (not `Partial<Insert>`) — the self-referential pattern collapses Supabase query-builder types to `never` in Deno. All `createClient<Database>()` calls are in edge functions; never use untyped `createClient()`. Type casts (`as unknown as Json`) are acceptable where TypeScript can't infer that an app-level struct is JSON-serialisable — these are real casts, not `any` workarounds.
- **Pre-push gate**: `.git/hooks/pre-push` runs `deno check` on all Edge Function entry points and `npm run build`. Both must pass before any push. If deno is not found (CI), the deno check step is skipped with a warning (non-fatal). The gate catches server-side and client-side type errors that would otherwise only surface at deploy time.

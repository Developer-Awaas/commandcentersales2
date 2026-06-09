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

### 2. Gemini Image Generation (creative variants)
- Client-side via `src/lib/gemini-service.ts` (Nanobanana path in `Creatives.tsx`)
- Also: Edge Function `supabase/functions/generate-creatives/` (used by `CreativeViewer`)
- Model: `imagen-3.0-generate-002` (endpoint used in `gemini-service.ts`)
- Generates 3 images per session; each stored at a **deterministic path** so edits overwrite the same file
- Storage path pattern: `generated-creatives/{orgId}/{sessionId}/{angle-slug}.{ext}` in bucket `brand-assets`
- `uploadGeminiImageToSupabase` now returns `{ url, id, storagePath }` and inserts a `creative_assets` DB row
- Angle label → DB value map: 'Price-led with Urgency' → `value`, 'Lifestyle / Aspirational' → `lifestyle`, 'Trust & Legacy / Amenities' → `amenity`
- Funnel map: TOFU → `awareness`, MOFU → `consideration`, BOFU → `conversion`
- All 3 images from one "Generate" click share the same `session_id` UUID (column added via migration `20260605000000`)
- Prompt templates in: `src/lib/gemini-prompts.ts`

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

## Key Tables

All tables use RLS with `TO anon, authenticated USING (true)` (app-layer org_id filtering for pilot phase).

| Table | Migration | Purpose |
|---|---|---|
| `organizations` | `20260609120000` | Org identity + brand settings (name, slug, brand_colors, tone_of_voice, etc.) |
| `profiles` | `20260409085002` | Auth user profiles — org_id, role, module_access. Trigger auto-creates on signup |
| `projects` | `20260409123924` | Real-estate projects per org |
| `campaigns` | `20260409123924` | Ad campaigns per project |
| `daily_metrics` | `20260409123924` | Daily ad spend/leads/clicks/impressions |
| `notifications` | `20260409123924` | Per-user in-app notifications |
| `ai_sessions` | `20260409123924` | AI interaction log (strategy, ad_copy, creative, analysis) |
| `activity_log` | `20260411063514` | Audit trail of user actions |
| `awaas_data_pool` | `20260411084151` | AWAAS market data reference pool |
| `targeting_keywords` | `20260415072948` | Ad targeting keywords per project |
| `chatbot_log` | `20260429081859` | AIChatbot conversation history |
| `campaign_metrics` | `20260604120000` | Auto-fetched Meta Ads stats (via pg_cron every 15 min) |
| `creative_assets` | `20260604120000` | Generated images + editing lifecycle. Has `session_id uuid` to group 3-image sets |
| `org_integrations` | `20260604120000` | Org-level API tokens (Meta, Google) |
| `org_user_integrations` | `20260604120000` | Per-user OAuth tokens (Canva) |
| `integration_sync_log` | `20260604120000` | Audit trail for sync attempts |
| `competitors` | `20260609130000` | Competitor names per org |
| `brand_kits` | `20260609130000` | Design system per org (colors, fonts, brand voice). One row per org |
| `lead_funnel` | `20260609130000` | Weekly lead funnel metrics (total_leads, contacted, sv_done, booked) |
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
| `CampaignMetricsChart` | Stat cards + CSS bar chart + table from `campaign_metrics` |
| `CreativeViewer` | 3-col grid, skeleton loaders, Realtime, full action set (approve/reject/regen/canva/adobe/download), lightbox. Uses `creative-assets` bucket. |
| `ImageGalleryViewer` | Post-generation gallery (`GalleryImage[]`). Maintains `localImages` state so edits update in place. Shows "Sync from Canva" button after Canva opens. Passes `storagePath`+`storageBucket="brand-assets"` to `AdobeExpressModal`. |
| `AdobeExpressModal` | Loads Adobe Express Embed SDK v4. Supports overwrite-in-place mode (pass `storagePath`) or legacy new-file mode (no `storagePath`). |
| `CanvaConnectButton` | Canva OAuth connect/disconnect, reads `org_user_integrations` |

---

## Creatives page image flow (Nanobanana path)

1. User selects project + funnel stage + **output ad platform** (Meta Ads Manager or AiSensy) → clicks "Generate 3 Variants"
2. `buildVariantBriefs` is called with `ad_platform` — Aanya generates 3 text variants with platform-specific ad copy
   - **Meta Ads Manager**: headline ≤40 chars, first 125 chars of primary_text must be a standalone hook, description ≤30 chars, standard Meta CTA labels
   - **AiSensy (WhatsApp)**: headline = WhatsApp template header ≤60 chars, primary_text = conversational WhatsApp message body 300-500 chars, description = quick-reply button label ≤20 chars
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

## Rules

- Every table has RLS with org_id scoping — use `TO anon, authenticated USING (true)` pattern (no org_members table)
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

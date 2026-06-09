# CLAUDE.md — Command Center V2 Integration Context

> Place this file in the repo root. Claude Code reads it automatically for project context.

## Project

Command Center V2 — AWAAS Services Pvt Ltd. Real-estate marketing SaaS.
Stack: React + TypeScript, Supabase (Postgres + Edge Functions + Auth + Storage + Realtime).

## Active Integrations

### 1. Meta Marketing API (auto-fetch campaign stats)
- Edge Function: `supabase/functions/meta-insights-sync/`
- Runs on pg_cron every 15 min
- Writes to: `campaign_metrics` table
- API: `https://graph.facebook.com/v21.0` — always use async POST jobs, never sync GET
- Rate limit header: `X-FB-Ads-Insights-Throttle` — back off if `acc_id_util_pct > 75`
- Token stored encrypted in `org_integrations` table

### 2. Gemini Image Generation (creative variants)
- Edge Function: `supabase/functions/generate-creatives/`
- Model: `gemini-2.5-flash-image` (cost: ~$0.039/image)
- Generates 3 images in parallel via `Promise.allSettled`
- Response format: base64 inline data (not URL)
- Stores images in Supabase Storage bucket `creative-assets`
- Writes to: `creative_assets` table
- Prompt templates in: `src/lib/gemini-prompts.ts`

### 3. External Editors
- **Canva**: Connect API (`https://api.canva.com/rest/v1`), per-user OAuth, Edge Function at `supabase/functions/canva-open-editor/`
- **Adobe Express**: Embed SDK v4 loaded client-side, modal-based editing, returns edited base64 via `onPublish` callback
- **Download**: Always available as fallback

## Key Tables
- `campaign_metrics` — auto-fetched ad stats (RLS by org_id)
- `creative_assets` — generated images + editing lifecycle (RLS by org_id)
- `org_integrations` — org-level API tokens (Meta, Google)
- `org_user_integrations` — per-user OAuth tokens (Canva)
- `integration_sync_log` — audit trail for sync attempts

## UI Components (custom, no external chart lib)
- `MetricsFreshnessBadge` — inline live/stale/offline badge, Realtime-driven
- `CampaignMetricsChart` — stat cards + CSS bar chart + table from `campaign_metrics`
- `CreativeViewer` — 3-col grid, skeleton loaders, Realtime, full action set (approve/reject/regen/canva/adobe/download), lightbox
- `ImageGalleryViewer` — post-generation image display with prominent **Edit in Canva** + **Adobe Express** buttons and fullscreen lightbox; accepts `GalleryImage[]`
- `AdobeExpressModal` — loads Adobe Express Embed SDK v4, `onPublish` saves to Storage
- `CanvaConnectButton` — Canva OAuth connect/disconnect, reads `org_user_integrations`

## Creatives page image flow
1. User selects project + funnel stage → clicks "Generate 3 Variants" (Nanobanana path)
2. Aanya generates 3 text variants with `nanoPrompt` fields
3. After variants render, `generateImageWithGemini` is called in background for each prompt
4. Images are uploaded to Supabase Storage (`brand-assets` bucket) via `uploadGeminiImageToSupabase`
5. `ImageGalleryViewer` renders images with Canva + Adobe Express CTAs

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

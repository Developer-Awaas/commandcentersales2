-- ============================================================
-- Bootstrap migration: creative_assets.creative_id exists on PROD
-- (confirmed via direct query, 42 populated rows) but was never captured
-- in any migration file — added via the Supabase dashboard directly,
-- same class of gap as aanya_training_creatives (migration
-- 20260612235959). gemini-service.ts's uploadGeminiImageToSupabase()
-- has always inserted this column; PROD silently had it, but any
-- environment built purely from migration replay (CC-TEST) does not —
-- every creative_assets insert there fails with PGRST204 ("Could not
-- find the 'creative_id' column"), which uploadGeminiImageToSupabase's
-- caller swallows (StrategyResult.tsx's non-fatal fallback to a base64
-- data URL), so images still display but never get a real id — which is
-- why "Edit in Canva" always fell through to the generic template-gallery
-- fallback (ImageGalleryViewer.tsx's `if (img.id)` branch never taken).
--
-- Nullable: Creatives.tsx's variant-image upload never passes creativeId
-- (only Quick Generate's StrategyResult.tsx does, via the parent
-- `creatives` row's id), so this column is optional by actual usage.
-- ============================================================

ALTER TABLE creative_assets
  ADD COLUMN IF NOT EXISTS creative_id uuid REFERENCES creatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_creative_assets_creative_id ON creative_assets (creative_id);

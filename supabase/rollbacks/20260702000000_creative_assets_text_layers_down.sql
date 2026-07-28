-- ============================================================
-- DOWN migration for 20260702000000_creative_assets_text_layers.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260702000000_creative_assets_text_layers_down.sql
-- ============================================================

ALTER TABLE creative_assets DROP COLUMN IF EXISTS text_layers;

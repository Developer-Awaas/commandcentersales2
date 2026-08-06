-- ============================================================
-- DOWN for 20260806130000_creative_assets_overlay_recompose.sql
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260806130000_creative_assets_overlay_recompose_down.sql
-- ============================================================

ALTER TABLE creative_assets DROP COLUMN IF EXISTS clean_template_url;
ALTER TABLE creative_assets DROP COLUMN IF EXISTS overlay_zones;

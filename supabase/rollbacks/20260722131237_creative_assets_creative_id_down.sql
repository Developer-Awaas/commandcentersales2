-- Run manually: supabase db query --linked -f supabase/rollbacks/20260722131237_creative_assets_creative_id_down.sql
-- WARNING: only revert if this column was somehow wrong — PROD already
-- had this column with 42+ real rows before this migration existed;
-- dropping it discards that FK linkage (image -> parent creatives row).

DROP INDEX IF EXISTS idx_creative_assets_creative_id;
ALTER TABLE creative_assets DROP COLUMN IF EXISTS creative_id;

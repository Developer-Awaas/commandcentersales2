-- ============================================================
-- DOWN migration for 20260803120000_smm_project_id_creatives_description.sql
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260803120000_smm_project_id_creatives_description_down.sql
-- Drops the two additive columns (both nullable, no data backfill to preserve).
-- ============================================================

ALTER TABLE smm_calendar DROP COLUMN IF EXISTS project_id;
ALTER TABLE creatives DROP COLUMN IF EXISTS description;

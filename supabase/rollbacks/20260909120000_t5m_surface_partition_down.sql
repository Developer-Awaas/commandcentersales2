-- DOWN for 20260909120000_t5m_surface_partition.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- Run AFTER 20260909122000_r1_review_schema_down.sql (r1 alters
-- project_creative_guidelines). The smm_calendar hashtag backfill is not
-- reversible: the stripped leading '#' is not restored.
BEGIN;

DROP TRIGGER IF EXISTS trg_smm_calendar_normalize_hashtags ON smm_calendar;
DROP FUNCTION IF EXISTS smm_calendar_normalize_hashtags();
DROP FUNCTION IF EXISTS normalize_hashtags_array(text[]);

ALTER TABLE org_integrations DROP CONSTRAINT IF EXISTS org_integrations_ad_account_format_check;
ALTER TABLE projects         DROP CONSTRAINT IF EXISTS projects_ad_account_format_check;

DROP TABLE IF EXISTS curation_log;
DROP TABLE IF EXISTS project_creative_guidelines;

DROP INDEX IF EXISTS idx_atc_org_surface;
ALTER TABLE aanya_training_creatives DROP CONSTRAINT IF EXISTS aanya_training_creatives_surface_check;
ALTER TABLE aanya_training_creatives DROP COLUMN IF EXISTS surface;
ALTER TABLE creative_assets DROP CONSTRAINT IF EXISTS creative_assets_surface_check;
ALTER TABLE creative_assets DROP COLUMN IF EXISTS surface;

COMMIT;

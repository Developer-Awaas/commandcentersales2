-- ============================================================
-- DOWN migration for 20260730130000_tool_outputs_history_schema.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260730130000_tool_outputs_history_schema_down.sql
--
-- Reverses schema changes in reverse dependency order. The
-- creative_assets.campaign_id rename is reversed LAST and only if
-- the fresh campaign_id column this migration added is still
-- empty (NULL for every row) — if the journey feature has since
-- written real campaign links into it, blindly renaming project_id
-- back to campaign_id would silently destroy those real campaign
-- links by colliding two different columns' data into one name.
-- ============================================================

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE creative_assets DROP COLUMN IF EXISTS strategy_output_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creative_assets' AND column_name = 'campaign_id'
  ) THEN
    IF EXISTS (SELECT 1 FROM creative_assets WHERE campaign_id IS NOT NULL) THEN
      RAISE WARNING 'creative_assets.campaign_id has non-NULL values (real campaign links written by the journey feature) — '
                    'NOT dropping it or restoring the project_id rename automatically. Resolve manually.';
    ELSE
      ALTER TABLE creative_assets DROP COLUMN campaign_id;
      ALTER TABLE creative_assets DROP CONSTRAINT IF EXISTS creative_assets_project_id_fkey;
      ALTER TABLE creative_assets RENAME COLUMN project_id TO campaign_id;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS tool_outputs;

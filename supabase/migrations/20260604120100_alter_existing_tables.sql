/*
  # Add integration columns to existing tables

  Adds Meta campaign linkage and creative status tracking to campaigns and projects.
  All operations are wrapped in DO blocks so missing columns/tables don't abort.
*/

DO $$
BEGIN
  ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_campaign_id text;
  ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS creative_status text DEFAULT 'no_creatives'
    CHECK (creative_status IN ('no_creatives', 'generating', 'ready', 'approved'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_ad_format text DEFAULT '1:1';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

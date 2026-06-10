/*
  # Extend existing tables with columns missing from original migrations

  All these columns existed in the live Supabase DB (added by Bolt without tracked
  migrations) but were absent from the .sql files, causing schema-cache errors on
  INSERT/UPDATE from the app.

  All ALTER statements use ADD COLUMN IF NOT EXISTS — safe to run against a DB that
  already has these columns.

  Tables patched:
    - profiles        (+1 column)
    - campaigns       (+12 columns, budget numeric→jsonb coercion)
    - daily_metrics   (+8 columns)
    - ai_sessions     (+7 columns)
*/

-- ─────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────
-- campaigns
-- ─────────────────────────────────────────────

-- The original migration defined `budget numeric`. The app inserts budget as
-- a jsonb object {daily, duration, total, bid_strategy}. Coerce the column
-- type only if it is still numeric (no-op if already jsonb in the live DB).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns'
      AND column_name = 'budget'
      AND data_type = 'numeric'
  ) THEN
    ALTER TABLE campaigns ALTER COLUMN budget DROP DEFAULT;
    ALTER TABLE campaigns
      ALTER COLUMN budget TYPE jsonb
      USING CASE
        WHEN budget IS NULL THEN NULL
        ELSE jsonb_build_object('daily', budget::text, 'total', '', 'bid_strategy', 'lowest_cost')
      END;
    ALTER TABLE campaigns ALTER COLUMN budget SET DEFAULT '{}'::jsonb;
  END IF;
END $$;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS campaign_name  text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS funnel_stage   text    DEFAULT 'BOFU',
  ADD COLUMN IF NOT EXISTS ad_type        text    DEFAULT 'CTWA',
  ADD COLUMN IF NOT EXISTS objective      text    DEFAULT 'Messages',
  ADD COLUMN IF NOT EXISTS targeting      jsonb   DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS placements     jsonb   DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS creative_config jsonb  DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS icebreakers    jsonb   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_flow  text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS source         text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_by     text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS started_at     timestamptz DEFAULT NULL;

-- ─────────────────────────────────────────────
-- daily_metrics
-- ─────────────────────────────────────────────
ALTER TABLE daily_metrics
  ADD COLUMN IF NOT EXISTS cpl         numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ctr         numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frequency   numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach       int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS results     int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversions int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_source text    DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS project_id  uuid    REFERENCES projects(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- ai_sessions
-- ─────────────────────────────────────────────
-- session_type may already exist (the CHECK constraint migration references it).
-- All ADD COLUMN IF NOT EXISTS calls are safe either way.
ALTER TABLE ai_sessions
  ADD COLUMN IF NOT EXISTS session_type  text    DEFAULT 'quick_generate',
  ADD COLUMN IF NOT EXISTS project_ids   uuid[]  DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS input_data    jsonb   DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS output_data   jsonb   DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS health_score  numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS actions_taken jsonb   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tokens_used   int     DEFAULT 0;

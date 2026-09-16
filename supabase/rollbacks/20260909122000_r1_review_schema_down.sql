-- DOWN for 20260909122000_r1_review_schema.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- review_events_insert is left in place: after 20260916121000_r1_cleanup it is
-- the table's only INSERT policy. Run that file's DOWN first.
BEGIN;

DROP TABLE IF EXISTS cron_run_log;
DROP TABLE IF EXISTS integration_health;

DROP INDEX IF EXISTS idx_pcg_active;
ALTER TABLE project_creative_guidelines
  DROP CONSTRAINT IF EXISTS pcg_scope_check,
  DROP CONSTRAINT IF EXISTS pcg_status_check,
  DROP CONSTRAINT IF EXISTS pcg_lifecycle_consistency_check,
  DROP CONSTRAINT IF EXISTS pcg_scope_project_check,
  DROP CONSTRAINT IF EXISTS pcg_evidence_count_check,
  DROP COLUMN IF EXISTS scope,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS evidence_count,
  DROP COLUMN IF EXISTS source_review_ids,
  DROP COLUMN IF EXISTS activated_at,
  DROP COLUMN IF EXISTS retired_at;

DROP INDEX IF EXISTS idx_review_events_unprocessed;
ALTER TABLE review_events
  DROP CONSTRAINT IF EXISTS review_events_surface_check,
  DROP CONSTRAINT IF EXISTS review_events_rating_overall_check,
  DROP CONSTRAINT IF EXISTS review_events_entity_type_check,
  DROP COLUMN IF EXISTS surface,
  DROP COLUMN IF EXISTS rating_overall,
  DROP COLUMN IF EXISTS processed_at,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS entity_type,
  DROP COLUMN IF EXISTS entity_id,
  DROP COLUMN IF EXISTS rating,
  DROP COLUMN IF EXISTS intent_tags,
  DROP COLUMN IF EXISTS comment,
  DROP COLUMN IF EXISTS parent_creative_id;

COMMIT;

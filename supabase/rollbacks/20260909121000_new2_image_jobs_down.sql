-- DOWN for 20260909121000_new2_image_jobs.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- Fails on purpose if any row is 'running' or 'timed_out': those have no
-- meaning under the old vocabulary. Resolve them first.
BEGIN;

DROP TRIGGER IF EXISTS trg_image_jobs_stamp_started_at ON image_jobs;
DROP FUNCTION IF EXISTS image_jobs_stamp_started_at();
COMMENT ON COLUMN image_jobs.error IS NULL;

ALTER TABLE image_jobs DROP CONSTRAINT IF EXISTS image_jobs_status_check;
ALTER TABLE image_jobs ADD CONSTRAINT image_jobs_status_check
  CHECK (status IN ('queued', 'done', 'failed'));

ALTER TABLE image_jobs DROP CONSTRAINT IF EXISTS image_jobs_surface_check;
ALTER TABLE image_jobs
  DROP COLUMN IF EXISTS job_type,
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS model,
  DROP COLUMN IF EXISTS cost_usd,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS surface;

COMMIT;

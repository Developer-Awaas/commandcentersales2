-- ============================================================
-- DRAFT — NOT APPLIED. Phase 2 gate: docs/decisions/phase2-schema-gate.md
--
-- NEW-2: image_jobs gains attribution + timing columns, and its status
-- vocabulary widens.
--
-- ⚠️ THIS ONE IS NOT SCHEMA-ONLY. Pre-flight on CC-TEST 2026-09-09 shows the
-- live status values are 'done' (17 rows) and 'failed' (5) — 'done' is NOT in
-- the vocabulary the brief specifies. Three code sites write or read it and
-- must land in the SAME deploy, or the client hangs on a job it can no longer
-- recognise:
--     supabase/functions/generate-image/index.ts:369   .update({ status: 'done' })
--     src/lib/gemini-service.ts:106                    row.status === 'done'
--     supabase/migrations/20260811120000_image_jobs.sql:37,85  reaper + partial index
-- The data migration below renames existing rows, but a running old client
-- polling for 'done' will never resolve. Deploy order: migration, then edge,
-- then client — or keep 'done' as an accepted alias instead.
--
-- Fix-forward only. No down migration.
-- ============================================================

ALTER TABLE image_jobs
  ADD COLUMN IF NOT EXISTS job_type   text,
  ADD COLUMN IF NOT EXISTS provider   text,
  ADD COLUMN IF NOT EXISTS model      text,
  ADD COLUMN IF NOT EXISTS cost_usd   numeric(10,6),
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS surface    text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'image_jobs_surface_check') THEN
    ALTER TABLE image_jobs
      ADD CONSTRAINT image_jobs_surface_check
      CHECK (surface IS NULL OR surface IN ('leadgen', 'smm'));
  END IF;
END $$;

-- Rename before re-constraining, or the new CHECK fails on all 17 'done' rows.
UPDATE image_jobs SET status = 'succeeded' WHERE status = 'done';

ALTER TABLE image_jobs DROP CONSTRAINT IF EXISTS image_jobs_status_check;

ALTER TABLE image_jobs
  ADD CONSTRAINT image_jobs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timed_out'));

-- The reaper's partial index is on status='queued', which survives the
-- vocabulary change untouched. Recreated here only to keep it adjacent to the
-- constraint it depends on.
CREATE INDEX IF NOT EXISTS idx_image_jobs_queued ON image_jobs (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_image_jobs_org_created ON image_jobs (org_id, created_at DESC);

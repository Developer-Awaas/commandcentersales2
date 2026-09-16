-- ============================================================
-- Phase 2 gate: docs/decisions/phase2-schema-gate.md
--
-- NEW-2: image_jobs gains attribution + timing columns, and its status
-- vocabulary widens to queued|running|done|failed|timed_out.
--
-- 'done' is KEPT (revised 2026-09-16, schema gate ruling). No existing row is
-- touched, so the three code sites that write or read 'done' stay correct and
-- there is no migration → edge → client deploy-order hazard:
--     supabase/functions/generate-image/index.ts   .update({ status: 'done' })
--     src/lib/gemini-service.ts                    row.status === 'done'
--     supabase/migrations/20260811120000_image_jobs.sql  reaper + partial index
--
-- T-006a (schema only): started_at is stamped by trigger on the transition to
-- 'running'; error is documented as holding a classified reason. The
-- write-site classification is a separate commit, so no CHECK constrains
-- error yet — one now would reject the free-text errors generate-image and the
-- reaper still write, and a failed terminal update leaves the job 'queued'.
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

-- Widening only: every existing value ('queued', 'done', 'failed') stays legal.
ALTER TABLE image_jobs DROP CONSTRAINT IF EXISTS image_jobs_status_check;

ALTER TABLE image_jobs
  ADD CONSTRAINT image_jobs_status_check
  CHECK (status IN ('queued', 'running', 'done', 'failed', 'timed_out'));

-- ── T-006a: started_at on transition to running ────────────────────────────
-- Stamped at the row so no writer can forget it. A caller-supplied value wins.
CREATE OR REPLACE FUNCTION image_jobs_stamp_started_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'running'
     AND NEW.started_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'running') THEN
    NEW.started_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_image_jobs_stamp_started_at ON image_jobs;
CREATE TRIGGER trg_image_jobs_stamp_started_at
  BEFORE INSERT OR UPDATE OF status ON image_jobs
  FOR EACH ROW EXECUTE FUNCTION image_jobs_stamp_started_at();

COMMENT ON COLUMN image_jobs.error IS
  'Classified failure reason (T-006a), never a raw provider message. Vocabulary is set by the write-site classification commit; pre-T-006a rows hold free text.';

-- The reaper's partial index is on status='queued', which the widening leaves
-- untouched. Kept here only so the index sits next to the constraint.
CREATE INDEX IF NOT EXISTS idx_image_jobs_queued ON image_jobs (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_image_jobs_org_created ON image_jobs (org_id, created_at DESC);

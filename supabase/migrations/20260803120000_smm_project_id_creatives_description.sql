-- ============================================================
-- CC-P5 Step 1 — two additive, nullable columns:
--
-- 1. smm_calendar.project_id — SMM Planner + SMM Creatives select a project
--    but never persisted the association (the column simply didn't exist; a
--    prior write of `project_id` silently dropped — see bug #48). Adding it
--    (nullable FK) lets those writes record which project a post belongs to.
--
-- 2. creatives.description — the ad-variant "description" field (Meta's ≤30-char
--    description slot) is authored + displayed in the UI but had no column to
--    persist into, so it silently dropped on save (bug #48). It is user-facing
--    content, not derived/dead, so the ruling is: add the column + restore the
--    write (done in Creatives.tsx alongside this migration).
--
-- Additive only, both nullable — no destructive change, no backfill needed.
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smm_calendar' AND column_name='project_id') THEN
    ALTER TABLE smm_calendar ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='creatives' AND column_name='description') THEN
    ALTER TABLE creatives ADD COLUMN description text;
  END IF;
END $$;

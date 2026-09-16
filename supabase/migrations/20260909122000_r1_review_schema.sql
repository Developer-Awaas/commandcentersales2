-- ============================================================
-- Phase 2 gate: docs/decisions/phase2-schema-gate.md
--
-- R1 review schema + rule lifecycle + NEW-3 integration_health + cron_run_log.
--
-- INVENTORY ABSENT: CC_Phase1_Digest.md is not in this worktree, so R1's and
-- NEW-3's own column lists could not be read. review_events is therefore
-- ALTERed only with columns the Phase 2 brief itself names or that the
-- existing table plainly lacks for a lifecycle; integration_health is built
-- from its name plus the failure it exists to catch (a populated
-- org_integrations row is indistinguishable from a working one — the
-- dead-app incident). Reconcile both against the digest before apply.
--
-- review_events \d on CC-TEST 2026-09-09 (0 rows): id, org_id, project_id,
-- subject_type, subject_id, strategy_type, platform, ratings, improvement_text,
-- edit_summary, editor_ops, created_by, created_at.
--
-- Revised 2026-09-16 per schema gate: the R1 inventory columns (entity_type,
-- entity_id, rating, intent_tags, comment, parent_creative_id) are added —
-- none existed on CC-TEST. They sit alongside the older subject_type /
-- subject_id / ratings columns, which are NOT reconciled here.
-- integration_health gains token_expires_at (NEW-3).
--
-- Fix-forward only. No down migration.
-- ============================================================

-- ── R1: review_events ──────────────────────────────────────────────────────
ALTER TABLE review_events
  ADD COLUMN IF NOT EXISTS surface            text NOT NULL DEFAULT 'leadgen',
  ADD COLUMN IF NOT EXISTS rating_overall     integer,
  ADD COLUMN IF NOT EXISTS processed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS source             text,
  ADD COLUMN IF NOT EXISTS entity_type        text,
  ADD COLUMN IF NOT EXISTS entity_id          uuid,
  ADD COLUMN IF NOT EXISTS rating             integer,
  ADD COLUMN IF NOT EXISTS intent_tags        text[],
  ADD COLUMN IF NOT EXISTS comment            text,
  ADD COLUMN IF NOT EXISTS parent_creative_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_events_surface_check') THEN
    ALTER TABLE review_events ADD CONSTRAINT review_events_surface_check
      CHECK (surface IN ('leadgen', 'smm'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_events_rating_overall_check') THEN
    ALTER TABLE review_events ADD CONSTRAINT review_events_rating_overall_check
      CHECK (rating_overall IS NULL OR (rating_overall >= 1 AND rating_overall <= 5));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_events_entity_type_check') THEN
    ALTER TABLE review_events ADD CONSTRAINT review_events_entity_type_check
      CHECK (entity_type IN ('creative', 'strategy'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_review_events_unprocessed
  ON review_events (org_id, created_at) WHERE processed_at IS NULL;

-- review_events stays INSERT-only for authenticated callers: there is no
-- review-management UI, and the rows are raw signal for ingest-review (service
-- role, bypasses RLS) to aggregate. No SELECT, UPDATE or DELETE policy.
ALTER TABLE review_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_events_insert ON review_events;
CREATE POLICY review_events_insert ON review_events FOR INSERT TO authenticated
  WITH CHECK (org_id = get_current_user_org_id());

-- ── Rule lifecycle on project_creative_guidelines ──────────────────────────
-- Depends on 20260909120000, which creates the table.
ALTER TABLE project_creative_guidelines
  ADD COLUMN IF NOT EXISTS scope             text NOT NULL DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'proposed',
  ADD COLUMN IF NOT EXISTS evidence_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_review_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS activated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS retired_at        timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pcg_scope_check') THEN
    ALTER TABLE project_creative_guidelines ADD CONSTRAINT pcg_scope_check
      CHECK (scope IN ('project', 'org'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pcg_status_check') THEN
    ALTER TABLE project_creative_guidelines ADD CONSTRAINT pcg_status_check
      CHECK (status IN ('proposed', 'active', 'retired'));
  END IF;
  -- Impossible states: an active rule has an activation time and no retirement;
  -- a retired rule has both. A project-scoped rule needs a project.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pcg_lifecycle_consistency_check') THEN
    ALTER TABLE project_creative_guidelines ADD CONSTRAINT pcg_lifecycle_consistency_check
      CHECK (
        (status = 'proposed' AND activated_at IS NULL AND retired_at IS NULL)
     OR (status = 'active'   AND activated_at IS NOT NULL AND retired_at IS NULL)
     OR (status = 'retired'  AND activated_at IS NOT NULL AND retired_at IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pcg_scope_project_check') THEN
    ALTER TABLE project_creative_guidelines ADD CONSTRAINT pcg_scope_project_check
      CHECK (scope <> 'project' OR project_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pcg_evidence_count_check') THEN
    ALTER TABLE project_creative_guidelines ADD CONSTRAINT pcg_evidence_count_check
      CHECK (evidence_count >= 0 AND evidence_count = cardinality(source_review_ids));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pcg_active
  ON project_creative_guidelines (org_id, project_id, surface) WHERE status = 'active';

-- ── NEW-3: integration_health ──────────────────────────────────────────────
-- A populated org_integrations row is indistinguishable from a working one;
-- that is how meta-insights-sync logged nothing but 'skipped' for a month.
-- This table records the last real probe, not the presence of credentials.
CREATE TABLE IF NOT EXISTS integration_health (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  status         text NOT NULL,
  checked_at     timestamptz NOT NULL DEFAULT now(),
  last_ok_at     timestamptz,
  token_expires_at timestamptz,
  error_code     text,
  error_message  text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT integration_health_provider_check CHECK (provider IN ('meta', 'google_ads', 'canva', 'openai', 'anthropic')),
  CONSTRAINT integration_health_status_check   CHECK (status IN ('ok', 'degraded', 'failing', 'unconfigured')),
  CONSTRAINT integration_health_ok_check       CHECK (status <> 'ok' OR (error_code IS NULL AND error_message IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_health_org_provider
  ON integration_health (org_id, provider);

-- Read-only from src/: every write is a service-role probe, so a browser must
-- not be able to forge a green health row.
ALTER TABLE integration_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integration_health_select ON integration_health;
CREATE POLICY integration_health_select ON integration_health FOR SELECT TO authenticated
  USING (org_id = get_current_user_org_id());

-- ── cron_run_log ───────────────────────────────────────────────────────────
-- cron.job_run_details is superuser-visible only and says nothing about what
-- the FUNCTION did. This is the function's own record.
CREATE TABLE IF NOT EXISTS cron_run_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jobname      text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running',
  error        text,
  CONSTRAINT cron_run_log_status_check CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT cron_run_log_finished_check CHECK (status = 'running' OR finished_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cron_run_log_jobname ON cron_run_log (jobname, started_at DESC);

-- Cron runs are org-agnostic and carry no org_id, so there is no org-scoped
-- policy that could be written. RLS on with NO policy = deny-all to
-- authenticated; the service-role writers bypass it. Surfacing this to admins
-- needs a SECURITY DEFINER function, not a policy on a column that is absent.
ALTER TABLE cron_run_log ENABLE ROW LEVEL SECURITY;

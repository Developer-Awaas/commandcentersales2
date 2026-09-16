-- ============================================================
-- Phase 2 gate: docs/decisions/phase2-schema-gate.md
--
-- T5-M surface partition + A3 + D2b.
--
-- PLAN ABSENT: CC_V2_ultracode_plan.md is not in this worktree, so
-- project_creative_guidelines and curation_log are created with MINIMAL
-- columns inferred from their names and from the R1 lifecycle columns the
-- Phase 2 brief adds to the former. Reconcile against the plan before apply.
--
-- A5 IS DELIBERATELY ABSENT FROM THIS FILE: published_assets already carries
-- published_assets_has_provenance_check (added 20260829150000, NOT VALID).
-- The brief said "only if step 4 shows it absent"; it does not. One row still
-- violates it, so VALIDATE would fail — see the gate doc.
--
-- Revised 2026-09-16 per schema gate: A3 CHECKs are NOT VALID here and
-- validated in 20260909120500_a3_validate.sql; creative_assets.surface added.
--
-- Fix-forward only. No down migration.
-- ============================================================

-- ── T5-M: surface partition ────────────────────────────────────────────────
ALTER TABLE aanya_training_creatives
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'leadgen';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aanya_training_creatives_surface_check') THEN
    ALTER TABLE aanya_training_creatives
      ADD CONSTRAINT aanya_training_creatives_surface_check
      CHECK (surface IN ('leadgen', 'smm'));
  END IF;
END $$;

ALTER TABLE creative_assets
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'leadgen';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_assets_surface_check') THEN
    ALTER TABLE creative_assets
      ADD CONSTRAINT creative_assets_surface_check
      CHECK (surface IN ('leadgen', 'smm'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_creative_guidelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  surface     text NOT NULL DEFAULT 'leadgen' CHECK (surface IN ('leadgen', 'smm')),
  rule_text   text NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS curation_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects(id) ON DELETE CASCADE,
  surface       text NOT NULL DEFAULT 'leadgen' CHECK (surface IN ('leadgen', 'smm')),
  subject_type  text NOT NULL,
  subject_id    uuid,
  action        text NOT NULL,
  reason        text,
  actor_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_creative_guidelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE curation_log                ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pcg_org_surface  ON project_creative_guidelines (org_id, surface);
CREATE INDEX IF NOT EXISTS idx_curation_org     ON curation_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atc_org_surface  ON aanya_training_creatives (org_id, surface);

-- Both tables are written from src/, so they need the full CRUD policy set,
-- not the SELECT-only service-role shape (bug #46).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_creative_guidelines', 'curation_log'] LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$I_select ON %1$I;
      CREATE POLICY %1$I_select ON %1$I FOR SELECT TO authenticated
        USING (org_id = get_current_user_org_id());
      DROP POLICY IF EXISTS %1$I_insert ON %1$I;
      CREATE POLICY %1$I_insert ON %1$I FOR INSERT TO authenticated
        WITH CHECK (org_id = get_current_user_org_id());
      DROP POLICY IF EXISTS %1$I_update ON %1$I;
      CREATE POLICY %1$I_update ON %1$I FOR UPDATE TO authenticated
        USING (org_id = get_current_user_org_id())
        WITH CHECK (org_id = get_current_user_org_id());
      DROP POLICY IF EXISTS %1$I_delete ON %1$I;
      CREATE POLICY %1$I_delete ON %1$I FOR DELETE TO authenticated
        USING (org_id = get_current_user_org_id());
    $f$, t);
  END LOOP;
END $$;

-- ── A3: act_ prefix enforced at the column ─────────────────────────────────
-- Added NOT VALID (new writes are checked immediately, no table scan under
-- this lock); 20260909120500_a3_validate.sql validates existing rows.
-- normalizeAdAccountId() stays the writer; this is the
-- backstop for the one remaining un-normalised writer (_shared/meta-oauth.ts,
-- A4b, frozen) and for any hand-edited row.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_integrations_ad_account_format_check') THEN
    ALTER TABLE org_integrations
      ADD CONSTRAINT org_integrations_ad_account_format_check
      CHECK (meta_ad_account_id IS NULL OR meta_ad_account_id ~ '^act_\d+$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_ad_account_format_check') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_ad_account_format_check
      CHECK (meta_ad_account_id IS NULL OR meta_ad_account_id ~ '^act_\d+$') NOT VALID;
  END IF;
END $$;

-- ── D2b: hashtag normalisation at the row, not at the caller ───────────────
-- smm_calendar.hashtags is the ONLY hashtag column in the schema (checked
-- against information_schema 2026-09-09). Pre-flight: 7 of 59 rows hold at
-- least one '#'-prefixed tag — A1b. The backfill below is that fix; the
-- trigger is what stops it recurring from a writer that forgets
-- normalizeHashtags().
CREATE OR REPLACE FUNCTION normalize_hashtags_array(tags text[])
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    array_agg(t ORDER BY ord),
    ARRAY[]::text[]
  )
  FROM (
    SELECT DISTINCT ON (lower(btrim(regexp_replace(x, '^#+', ''))))
           btrim(regexp_replace(x, '^#+', '')) AS t,
           ord
    FROM unnest(tags) WITH ORDINALITY AS u(x, ord)
    WHERE btrim(regexp_replace(x, '^#+', '')) <> ''
    ORDER BY lower(btrim(regexp_replace(x, '^#+', ''))), ord
  ) d;
$$;

CREATE OR REPLACE FUNCTION smm_calendar_normalize_hashtags()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hashtags IS NOT NULL THEN
    NEW.hashtags := normalize_hashtags_array(NEW.hashtags);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_smm_calendar_normalize_hashtags ON smm_calendar;
CREATE TRIGGER trg_smm_calendar_normalize_hashtags
  BEFORE INSERT OR UPDATE OF hashtags ON smm_calendar
  FOR EACH ROW EXECUTE FUNCTION smm_calendar_normalize_hashtags();

UPDATE smm_calendar
   SET hashtags = normalize_hashtags_array(hashtags)
 WHERE hashtags IS NOT NULL
   AND hashtags IS DISTINCT FROM normalize_hashtags_array(hashtags);

-- ── Impossible-state CHECKs ────────────────────────────────────────────────
-- NONE ADDED. The brief sources these from CC_V2_ultracode_plan.md, which is
-- absent from this worktree. Inventing them would put guesses in a CHECK
-- constraint, which is the one place a guess is expensive to undo.

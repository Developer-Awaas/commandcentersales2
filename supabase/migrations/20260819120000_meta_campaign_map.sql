-- ============================================================
-- RB-M1 STEP 1 — meta_campaign_map: which Meta campaign/ad belongs to which
-- project.
--
-- Today campaign_metrics.project_id is only ever set when a PROJECT carries its
-- own meta_ad_account_id (one account per project). Every org that runs all its
-- projects from a single ad account — which is the common case, and the case on
-- the review org — gets project_id NULL on every row, so the Monitor's project
-- filter has nothing to filter on. This table is the missing join.
--
-- SHAPE NOTE: the column list here is INFERRED from the unique constraint that
-- was specified — (org_id, coalesce(meta_ad_id,''), meta_campaign_id) — plus
-- how the bridge (source='crm_bridge') and the Monitor's inline assign
-- (source='manual') use it. If the intended shape carried more, this is the
-- place to add it; nothing below assumes these are the only columns.
--
-- meta_ad_id is NULLABLE on purpose: a row with it NULL maps a whole CAMPAIGN
-- to a project, a row with it set maps a single AD (finer, and wins). The
-- unique index uses coalesce(meta_ad_id,'') because SQL NULLs are not equal to
-- each other, so a plain UNIQUE would happily allow unlimited duplicate
-- campaign-level rows — the exact thing the constraint exists to prevent.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

-- The bridge resolves projects by an external reference owned by the CRM.
-- No such column existed, so a bridge payload had nothing to match on.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='external_ref') THEN
    ALTER TABLE projects ADD COLUMN external_ref text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS projects_org_external_ref_idx
  ON projects (org_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS meta_campaign_map (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  project_id        uuid REFERENCES projects(id) ON DELETE CASCADE,
  meta_campaign_id  text NOT NULL,
  -- NULL = this row maps the whole campaign; set = maps one ad specifically.
  meta_ad_id        text,
  source            text NOT NULL CHECK (source IN ('crm_bridge','manual')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- coalesce, not a bare UNIQUE — see the note above about NULL inequality.
CREATE UNIQUE INDEX IF NOT EXISTS meta_campaign_map_unique_idx
  ON meta_campaign_map (org_id, coalesce(meta_ad_id, ''), meta_campaign_id);

CREATE INDEX IF NOT EXISTS meta_campaign_map_project_idx
  ON meta_campaign_map (org_id, project_id);

ALTER TABLE meta_campaign_map ENABLE ROW LEVEL SECURITY;

-- READ: any member of the org. The mapping is not sensitive — it is which
-- campaign belongs to which project — and the Monitor needs it for every user,
-- not just admins (the lesson from org_integrations being admin-only while the
-- Monitor depended on it).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='meta_campaign_map' AND policyname='Org members can read campaign map') THEN
    CREATE POLICY "Org members can read campaign map"
      ON meta_campaign_map FOR SELECT TO authenticated
      USING (org_id = get_current_user_org_id());
  END IF;
END $$;

-- NO client INSERT/UPDATE/DELETE policy by design. Manual assignment goes
-- through assign_campaign_to_project() below (SECURITY DEFINER, so it can
-- write while the table stays closed); the CRM bridge writes with the service
-- role, which bypasses RLS entirely.

/**
 * Manual assignment from the Monitor's "Unassigned" group.
 * SECURITY DEFINER so it can write to a table with no INSERT policy, but it
 * derives the org from the CALLER, never an argument — otherwise this would be
 * "assign any campaign into any org's project" for any authenticated user.
 */
CREATE OR REPLACE FUNCTION public.assign_campaign_to_project(
  p_campaign_id text,
  p_project_id  uuid,
  p_ad_id       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := get_current_user_org_id();
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organisation for the current user';
  END IF;

  -- The project must belong to the caller's own org. Without this a caller
  -- could point their campaign at a project id belonging to someone else.
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND org_id = v_org
  ) THEN
    RAISE EXCEPTION 'Project does not belong to this organisation';
  END IF;

  INSERT INTO meta_campaign_map (org_id, project_id, meta_campaign_id, meta_ad_id, source)
  VALUES (v_org, p_project_id, p_campaign_id, p_ad_id, 'manual')
  ON CONFLICT (org_id, coalesce(meta_ad_id, ''), meta_campaign_id)
  DO UPDATE SET project_id = EXCLUDED.project_id,
                source     = 'manual',
                updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.assign_campaign_to_project(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_campaign_to_project(text, uuid, text) TO authenticated;

COMMENT ON TABLE meta_campaign_map IS
  'Maps Meta campaign/ad ids to projects. meta_ad_id NULL = campaign-level mapping; set = ad-level (finer, wins). Written by the CRM bridge (service role) or assign_campaign_to_project (manual). Read by any org member.';
COMMENT ON COLUMN projects.external_ref IS
  'Stable identifier owned by the CRM, used by crm-map-ingest to resolve a project without knowing its uuid. Unique per org where set.';

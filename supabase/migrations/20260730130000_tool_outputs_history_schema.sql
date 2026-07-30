-- ============================================================
-- CC-P3 history/journey feature — schema.
--
-- 1. tool_outputs: one row per saved AI tool output (strategy,
--    ad_config, ad_creatives, ad_review, smm_planner,
--    smm_creatives), org-scoped, optionally linked to a campaign.
--    Same RLS shape as agent_interactions
--    (20260616080000_create_agent_interactions.sql): service-role
--    writes, authenticated org-scoped SELECT only.
--
-- 2. creative_assets.campaign_id fix. Live-verified before writing
--    this migration: the existing (unconstrained, never-FK'd)
--    creative_assets.campaign_id column has ALWAYS held
--    projects.id values, never campaigns.id (42/42 non-null rows
--    matched projects, 0 matched campaigns) — every reader/writer
--    in the codebase already treats it as a project id
--    (uploadGeminiImageToSupabase's own param is opts.projectId).
--    Fix: rename the mislabeled column to project_id (pure rename,
--    zero behavior change, matching code that's already written)
--    and give it the FK it should always have had. Then add a
--    FRESH, empty campaign_id column with the FK it needs for
--    this feature's actual campaign-journey linkage — this is the
--    first thing to ever populate it.
--
-- 3. creative_assets.strategy_output_id: links a generated image
--    back to the tool_outputs row (a saved strategy) it came from.
--
-- 4. campaigns.status: column already exists (text DEFAULT
--    'active') but has never had a CHECK constraint. Table is
--    empty on PROD (verified), so adding the constraint is safe
--    with no backfill needed.
-- ============================================================

CREATE TABLE IF NOT EXISTS tool_outputs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain      text NOT NULL CHECK (domain IN ('ads', 'social')),
  tool        text NOT NULL CHECK (tool IN ('strategy', 'ad_config', 'ad_creatives', 'ad_review', 'smm_planner', 'smm_creatives')),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  payload     jsonb NOT NULL,
  asset_refs  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status      text NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'in_progress', 'completed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_outputs_org_domain_created ON tool_outputs (org_id, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_outputs_campaign_id ON tool_outputs (campaign_id);

ALTER TABLE tool_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view their tool outputs" ON tool_outputs;
CREATE POLICY "Org members can view their tool outputs"
  ON tool_outputs FOR SELECT
  TO authenticated
  USING (org_id = get_current_user_org_id());

-- --- creative_assets.campaign_id rename + FK fix ------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creative_assets' AND column_name = 'campaign_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creative_assets' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE creative_assets RENAME COLUMN campaign_id TO project_id;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'creative_assets_project_id_fkey'
  ) THEN
    ALTER TABLE creative_assets
      ADD CONSTRAINT creative_assets_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_creative_assets_project_id ON creative_assets (project_id);

-- Fresh campaign_id column — genuinely new, not the renamed one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creative_assets' AND column_name = 'campaign_id'
  ) THEN
    ALTER TABLE creative_assets
      ADD COLUMN campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_creative_assets_campaign_id ON creative_assets (campaign_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creative_assets' AND column_name = 'strategy_output_id'
  ) THEN
    ALTER TABLE creative_assets
      ADD COLUMN strategy_output_id uuid REFERENCES tool_outputs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- --- campaigns.status CHECK ----------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_status_check'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_status_check
      CHECK (status IN ('active', 'suspended', 'completed'));
  END IF;
END $$;

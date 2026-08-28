-- ============================================================
-- RB-PUB STEP 0c — published_assets: the record of everything this product
-- has ever put on someone else's Page, including the things it only
-- pretended to.
--
-- PROBED FIRST, not assumed: `select table_name from information_schema.tables
-- where table_name='published_assets'` returned zero rows on CC-TEST
-- (2026-08-28). The P3-era schema references the table only in a COMMENT on
-- ad_metrics.thumbnail_url ("ads not published through Command Center have no
-- published_assets row") — a forward reference to a table that was never
-- created. This creates it for real.
--
-- dry_run rows are the point, not overhead. A dry run writes a row with
-- meta_post_id NULL: it proves the payload was assembled and validated
-- WITHOUT a Graph write, which is the only publish evidence that can be
-- produced in CI or by a reviewer who must not post to a live Page. A table
-- that only recorded real posts would have nothing to show for the safe path.
--
-- WRITE PATH IS SERVICE-ROLE ONLY (meta-publish), so SELECT-only RLS is
-- correct here — the opposite of bug #46's tool_outputs, which is written from
-- src/ by an authenticated user and therefore needed the full CRUD set. The
-- distinction is who writes, not how important the table is: a client must
-- never be able to forge a "we posted this" row.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

CREATE TABLE IF NOT EXISTS published_assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id        uuid REFERENCES projects(id) ON DELETE SET NULL,
  creative_asset_id uuid REFERENCES creative_assets(id) ON DELETE SET NULL,
  tool_output_id    uuid REFERENCES tool_outputs(id) ON DELETE SET NULL,
  page_id           text NOT NULL,
  ig_user_id        text,
  platform          text NOT NULL,
  meta_post_id      text,
  permalink         text,
  message           text,
  dry_run           boolean NOT NULL DEFAULT false,
  posted_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  posted_at         timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='published_assets_platform_check') THEN
    ALTER TABLE published_assets
      ADD CONSTRAINT published_assets_platform_check
      CHECK (platform IN ('facebook','instagram'));
  END IF;
END $$;

-- The two reads this table actually gets: "what has this org posted" (history,
-- newest first) and "was this creative already posted" (the double-post check
-- the dialog does before enabling a live Post).
CREATE INDEX IF NOT EXISTS idx_published_assets_org_posted_at
  ON published_assets (org_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_published_assets_creative_asset
  ON published_assets (creative_asset_id) WHERE creative_asset_id IS NOT NULL;

ALTER TABLE published_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read published assets" ON published_assets;
CREATE POLICY "Org members read published assets"
  ON published_assets FOR SELECT
  TO authenticated
  USING (org_id = get_current_user_org_id());

-- No INSERT/UPDATE/DELETE policy, deliberately: every write comes from
-- meta-publish on the service-role client, which bypasses RLS. Adding a
-- client INSERT policy here would let a browser claim a post that never
-- happened.

COMMENT ON TABLE published_assets IS
  'One row per publish ATTEMPT through meta-publish, real or dry-run. dry_run=true + meta_post_id NULL means the payload was assembled and validated but no Graph write was made. Service-role write path only (RLS is SELECT-only by design).';
COMMENT ON COLUMN published_assets.dry_run IS
  'true = validated, nothing posted. The CI-safe and reviewer-safe proof that the publish chain works without touching a live Page.';
COMMENT ON COLUMN published_assets.page_id IS
  'The Page actually targeted, copied from org_integrations.publish_page_id AFTER the PUBLISH_ALLOWED_PAGE_IDS allowlist check passed. Recorded so a wrong target is answerable from the table, not from logs.';

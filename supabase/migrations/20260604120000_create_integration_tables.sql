/*
  # Create integration tables for Meta Ads, Gemini creatives, and external editors

  New tables:
  - org_integrations: org-level API tokens (Meta, Google Ads)
  - org_user_integrations: per-user OAuth tokens (Canva, Adobe Express)
  - campaign_metrics: auto-fetched Meta/Google ad stats per campaign per day
  - creative_assets: Gemini-generated images + editing lifecycle
  - integration_sync_log: audit trail for every Meta/Google sync attempt

  RLS: anon + authenticated USING(true) pattern matching project conventions.
  Realtime enabled on campaign_metrics and creative_assets for live UI updates.
*/

-- ============================================================
-- TABLE: org_integrations
-- Stores org-level API tokens for Meta, Google Ads, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS org_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('meta', 'google_ads')),
  meta_ad_account_id text,
  meta_access_token text,
  token_expires_at timestamptz,
  is_active boolean DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, provider)
);

ALTER TABLE org_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon select org_integrations" ON org_integrations;
DROP POLICY IF EXISTS "Allow anon insert org_integrations" ON org_integrations;
DROP POLICY IF EXISTS "Allow anon update org_integrations" ON org_integrations;
CREATE POLICY "Allow anon select org_integrations" ON org_integrations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon insert org_integrations" ON org_integrations FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow anon update org_integrations" ON org_integrations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- TABLE: org_user_integrations
-- Per-user OAuth tokens (Canva, Adobe Express)
-- ============================================================
CREATE TABLE IF NOT EXISTS org_user_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('canva', 'adobe_express')),
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE org_user_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon select org_user_integrations" ON org_user_integrations;
DROP POLICY IF EXISTS "Allow anon insert org_user_integrations" ON org_user_integrations;
DROP POLICY IF EXISTS "Allow anon update org_user_integrations" ON org_user_integrations;
DROP POLICY IF EXISTS "Allow anon delete org_user_integrations" ON org_user_integrations;
CREATE POLICY "Allow anon select org_user_integrations" ON org_user_integrations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon insert org_user_integrations" ON org_user_integrations FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow anon update org_user_integrations" ON org_user_integrations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete org_user_integrations" ON org_user_integrations FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- TABLE: campaign_metrics
-- Auto-fetched Meta/Google ad stats per campaign per day
-- ============================================================
CREATE TABLE IF NOT EXISTS campaign_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text,
  ad_account_id text,
  date_start date NOT NULL,
  date_stop date NOT NULL,
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  reach integer DEFAULT 0,
  spend numeric(12,2) DEFAULT 0,
  ctr numeric(8,6) DEFAULT 0,
  frequency numeric(6,4) DEFAULT 0,
  leads integer DEFAULT 0,
  cpl numeric(10,2),
  roas numeric(8,4),
  platform text NOT NULL CHECK (platform IN ('meta', 'google')),
  synced_at timestamptz DEFAULT now(),
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_metrics_upsert_key
  ON campaign_metrics (org_id, campaign_id, date_start, date_stop, platform);

ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon select campaign_metrics" ON campaign_metrics;
DROP POLICY IF EXISTS "Allow anon insert campaign_metrics" ON campaign_metrics;
DROP POLICY IF EXISTS "Allow anon update campaign_metrics" ON campaign_metrics;
CREATE POLICY "Allow anon select campaign_metrics" ON campaign_metrics FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon insert campaign_metrics" ON campaign_metrics FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow anon update campaign_metrics" ON campaign_metrics FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Enable Realtime for live UI updates
ALTER PUBLICATION supabase_realtime ADD TABLE campaign_metrics;

-- ============================================================
-- TABLE: creative_assets
-- Gemini-generated images with editing lifecycle
-- ============================================================
CREATE TABLE IF NOT EXISTS creative_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  campaign_id uuid,
  funnel_stage text NOT NULL CHECK (funnel_stage IN ('awareness', 'consideration', 'conversion')),
  angle text NOT NULL CHECK (angle IN ('lifestyle', 'architecture', 'amenity', 'community', 'value')),
  image_url text NOT NULL,
  edited_image_url text,
  storage_path text NOT NULL,
  prompt_used text,
  model_used text DEFAULT 'imagen-3.0-generate-002',
  canva_design_id text,
  canva_edit_url text,
  editor_used text CHECK (editor_used IN ('canva', 'adobe_express')),
  status text DEFAULT 'generated' CHECK (status IN ('generating', 'generated', 'editing', 'edited', 'approved', 'rejected')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE creative_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon select creative_assets" ON creative_assets;
DROP POLICY IF EXISTS "Allow anon insert creative_assets" ON creative_assets;
DROP POLICY IF EXISTS "Allow anon update creative_assets" ON creative_assets;
DROP POLICY IF EXISTS "Allow anon delete creative_assets" ON creative_assets;
CREATE POLICY "Allow anon select creative_assets" ON creative_assets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon insert creative_assets" ON creative_assets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow anon update creative_assets" ON creative_assets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete creative_assets" ON creative_assets FOR DELETE TO anon, authenticated USING (true);

-- Enable Realtime so skeleton loaders update progressively
ALTER PUBLICATION supabase_realtime ADD TABLE creative_assets;

-- ============================================================
-- TABLE: integration_sync_log
-- Audit trail for every Meta/Google sync attempt
-- ============================================================
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'error', 'throttled', 'skipped')),
  rows_synced integer DEFAULT 0,
  error text,
  throttle_pct numeric(5,2),
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon select integration_sync_log" ON integration_sync_log;
DROP POLICY IF EXISTS "Allow anon insert integration_sync_log" ON integration_sync_log;
CREATE POLICY "Allow anon select integration_sync_log" ON integration_sync_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon insert integration_sync_log" ON integration_sync_log FOR INSERT TO anon, authenticated WITH CHECK (true);

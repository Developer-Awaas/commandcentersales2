-- ad_metrics: ad-level Meta insights (Phase 7 of Aanya Trainer feedback loop).
-- One row per ad per date window. Enables Arjun to do precise creative-level performance attribution.
CREATE TABLE IF NOT EXISTS ad_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  ad_account_id text NOT NULL,
  campaign_id   text NOT NULL,
  adset_id      text,
  ad_id         text NOT NULL,
  ad_name       text NOT NULL DEFAULT '',
  date_start    date NOT NULL,
  date_stop     date NOT NULL,
  impressions   integer NOT NULL DEFAULT 0,
  clicks        integer NOT NULL DEFAULT 0,
  reach         integer NOT NULL DEFAULT 0,
  spend         numeric NOT NULL DEFAULT 0,
  ctr           numeric NOT NULL DEFAULT 0,
  leads         integer NOT NULL DEFAULT 0,
  cpl           numeric,
  platform      text NOT NULL DEFAULT 'meta',
  synced_at     timestamptz NOT NULL DEFAULT now(),
  raw_payload   jsonb,
  UNIQUE (org_id, ad_id, date_start, date_stop, platform)
);

ALTER TABLE ad_metrics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ad_metrics_select" ON ad_metrics;
  DROP POLICY IF EXISTS "ad_metrics_insert" ON ad_metrics;
  CREATE POLICY "ad_metrics_select" ON ad_metrics
    FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  -- Writes always go through the service-role client in meta-insights-sync edge function
  -- No client INSERT policy intentional.
END $$;

CREATE INDEX IF NOT EXISTS idx_ad_metrics_org_date ON ad_metrics (org_id, date_start DESC);
CREATE INDEX IF NOT EXISTS idx_ad_metrics_campaign  ON ad_metrics (org_id, campaign_id);

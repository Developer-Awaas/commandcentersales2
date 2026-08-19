-- DOWN for 20260819130000_ad_metrics_extended.sql
-- Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260819130000_ad_metrics_extended_down.sql
--
-- Drops the added columns only. ad_metrics itself PREDATES this migration and
-- is deliberately left in place — dropping it would destroy the Phase 7
-- ad-level history the UP never created.
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS unique_clicks;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS frequency;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS cpm;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS cpc;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS video_p25;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS video_p50;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS video_p75;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS video_p100;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS quality_ranking;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS engagement_rate_ranking;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS conversion_rate_ranking;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS adset_name;
ALTER TABLE ad_metrics DROP COLUMN IF EXISTS creative_thumb;
DROP INDEX IF EXISTS ad_metrics_org_date_idx;
DROP INDEX IF EXISTS ad_metrics_campaign_idx;

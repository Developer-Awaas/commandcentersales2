-- ============================================================
-- RB-M1 STEP 3 — ad_metrics gains the fields the ad-level view needs.
--
-- NOTE: ad_metrics is NOT a new table — it has existed since the Phase 7
-- ad-level sync (id, org_id, ad_account_id, campaign_id, adset_id, ad_id,
-- ad_name, date_start, date_stop, impressions, clicks, reach, spend, ctr,
-- leads, cpl, platform, synced_at, raw_payload). This ALTERs it rather than
-- recreating it, so existing rows survive.
--
-- Everything added is nullable: Meta omits fields that do not apply (video
-- quartiles on a static image ad, the three *_ranking fields until an ad has
-- enough delivery to be scored). NULL here means "Meta did not report it",
-- which is different from zero and must stay different — a 0% video completion
-- rate on an image ad would be a fabricated number.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$
DECLARE
  col text;
  cols text[] := ARRAY[
    'unique_clicks integer',
    'frequency numeric',
    'cpm numeric',
    'cpc numeric',
    'video_p25 integer',
    'video_p50 integer',
    'video_p75 integer',
    'video_p100 integer',
    'quality_ranking text',
    'engagement_rate_ranking text',
    'conversion_rate_ranking text',
    'adset_name text',
    -- Graph ad-creative thumbnail, fetched during sync so the Campaigns
    -- "Running now" section can show a face for an ad that was not published
    -- through Command Center (and therefore has no published_assets row).
    'creative_thumb text'
  ];
BEGIN
  FOREACH col IN ARRAY cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ad_metrics' AND column_name = split_part(col, ' ', 1)
    ) THEN
      EXECUTE format('ALTER TABLE ad_metrics ADD COLUMN %s', col);
    END IF;
  END LOOP;
END $$;

-- The ad-level view reads by org + day; the sync upserts by the natural key.
CREATE INDEX IF NOT EXISTS ad_metrics_org_date_idx
  ON ad_metrics (org_id, date_start DESC);
CREATE INDEX IF NOT EXISTS ad_metrics_campaign_idx
  ON ad_metrics (org_id, campaign_id, date_start DESC);

COMMENT ON COLUMN ad_metrics.quality_ranking IS
  'Meta delivery ranking (above_average / average / below_average_*). NULL until the ad has enough delivery to be scored — NULL is not "average".';
COMMENT ON COLUMN ad_metrics.creative_thumb IS
  'Graph ad-creative thumbnail_url, captured at sync time. Fallback for ads not published through Command Center (no published_assets row).';

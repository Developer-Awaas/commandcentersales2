-- ============================================================
-- DOWN for 20260814140000_aanya_training_review_metadata.sql
--
-- NOT auto-applied. Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260814140000_aanya_training_review_metadata_down.sql
--
-- DESTRUCTIVE but recoverable: these columns are a projection of
-- review_events, so as long as review_events still exists, re-running
-- ingest-review rebuilds them. Drop review_events too and the signal is gone.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aanya_training_designer_rating_check') THEN
    ALTER TABLE aanya_training_creatives DROP CONSTRAINT aanya_training_designer_rating_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aanya_training_text_quality_check') THEN
    ALTER TABLE aanya_training_creatives DROP CONSTRAINT aanya_training_text_quality_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aanya_training_ad_platform_check') THEN
    ALTER TABLE aanya_training_creatives DROP CONSTRAINT aanya_training_ad_platform_check;
  END IF;
END $$;

ALTER TABLE aanya_training_creatives DROP COLUMN IF EXISTS designer_rating;
ALTER TABLE aanya_training_creatives DROP COLUMN IF EXISTS text_quality;
ALTER TABLE aanya_training_creatives DROP COLUMN IF EXISTS edit_summary;
ALTER TABLE aanya_training_creatives DROP COLUMN IF EXISTS editor_ops_digest;
ALTER TABLE aanya_training_creatives DROP COLUMN IF EXISTS strategy_type;
ALTER TABLE aanya_training_creatives DROP COLUMN IF EXISTS ad_platform;
ALTER TABLE aanya_training_creatives DROP COLUMN IF EXISTS layout_tags;

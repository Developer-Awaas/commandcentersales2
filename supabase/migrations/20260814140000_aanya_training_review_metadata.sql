-- ============================================================
-- RB-P2 / P2.13 PART D — carry human review signal onto the training rows.
--
-- ingest-review aggregates review_events and stamps the result here, so
-- Aanya's training set knows not just WHICH creatives ran but which ones a
-- human judged market-ready and what they had to change to get them there.
--
-- All additive, all nullable. A training row with no review is the normal
-- case (every row predates this, and competitor/reference uploads are never
-- reviewed) — NULL means "not reviewed", which must stay distinguishable
-- from "reviewed and scored badly".
--
-- ad_platform is a NEW column and deliberately NOT the existing `platform`.
-- That column already means something else: AanyaMemory writes the SURFACE a
-- creative is styled for ('meta' | 'aisensy', labelled Meta / WhatsApp in the
-- UI), which is a design target independent of who bought the placement.
-- Reusing it for the meta|google ad platform would re-create precisely the
-- two-questions-in-one-column conflation that P2.13 PART C removed from
-- campaigns.platform. Two axes, two columns.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='aanya_training_creatives' AND column_name='designer_rating') THEN
    ALTER TABLE aanya_training_creatives ADD COLUMN designer_rating int;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='aanya_training_creatives' AND column_name='text_quality') THEN
    ALTER TABLE aanya_training_creatives ADD COLUMN text_quality int;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='aanya_training_creatives' AND column_name='edit_summary') THEN
    ALTER TABLE aanya_training_creatives ADD COLUMN edit_summary text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='aanya_training_creatives' AND column_name='editor_ops_digest') THEN
    ALTER TABLE aanya_training_creatives ADD COLUMN editor_ops_digest jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='aanya_training_creatives' AND column_name='strategy_type') THEN
    ALTER TABLE aanya_training_creatives ADD COLUMN strategy_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='aanya_training_creatives' AND column_name='ad_platform') THEN
    ALTER TABLE aanya_training_creatives ADD COLUMN ad_platform text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='aanya_training_creatives' AND column_name='layout_tags') THEN
    ALTER TABLE aanya_training_creatives ADD COLUMN layout_tags jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aanya_training_designer_rating_check') THEN
    ALTER TABLE aanya_training_creatives
      ADD CONSTRAINT aanya_training_designer_rating_check
      CHECK (designer_rating IS NULL OR designer_rating BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aanya_training_text_quality_check') THEN
    ALTER TABLE aanya_training_creatives
      ADD CONSTRAINT aanya_training_text_quality_check
      CHECK (text_quality IS NULL OR text_quality BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aanya_training_ad_platform_check') THEN
    ALTER TABLE aanya_training_creatives
      ADD CONSTRAINT aanya_training_ad_platform_check
      CHECK (ad_platform IS NULL OR ad_platform IN ('meta','google'));
  END IF;
END $$;

COMMENT ON COLUMN aanya_training_creatives.ad_platform IS
  'Ad platform the creative was authored for: meta | google. NOT the same axis as `platform`, which is the styling surface (meta | aisensy/WhatsApp).';
COMMENT ON COLUMN aanya_training_creatives.designer_rating IS
  'Human strategy-fit score 1-5 from review_events. NULL = not reviewed, which is not the same as a low score.';

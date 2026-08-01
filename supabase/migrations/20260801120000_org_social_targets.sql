-- ============================================================
-- CC-P4 Step 4: SMM Monitor / SocialMetricsProvider needs org-level
-- follower/reach TARGETS (the handles — fb_page_url/ig_page_url — already
-- exist on organizations). Add them here (additive only, all nullable) so
-- ManualSocialMetricsProvider can surface targets alongside the actuals
-- from smm_metrics, and SMM Planner can pre-fill them (editable overrides).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='ig_follower_target') THEN
    ALTER TABLE organizations ADD COLUMN ig_follower_target integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='ig_reach_target') THEN
    ALTER TABLE organizations ADD COLUMN ig_reach_target integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='fb_follower_target') THEN
    ALTER TABLE organizations ADD COLUMN fb_follower_target integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='fb_reach_target') THEN
    ALTER TABLE organizations ADD COLUMN fb_reach_target integer;
  END IF;
END $$;

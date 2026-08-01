-- ============================================================
-- DOWN migration for 20260801120000_org_social_targets.sql
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260801120000_org_social_targets_down.sql
-- Drops the follower/reach target columns (additive-only forward migration).
-- ============================================================

ALTER TABLE organizations DROP COLUMN IF EXISTS ig_follower_target;
ALTER TABLE organizations DROP COLUMN IF EXISTS ig_reach_target;
ALTER TABLE organizations DROP COLUMN IF EXISTS fb_follower_target;
ALTER TABLE organizations DROP COLUMN IF EXISTS fb_reach_target;

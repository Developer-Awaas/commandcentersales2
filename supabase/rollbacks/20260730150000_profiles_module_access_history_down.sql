-- ============================================================
-- DOWN migration for 20260730150000_profiles_module_access_history.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260730150000_profiles_module_access_history_down.sql
--
-- Restores the prior column default and removes the two backfilled keys
-- from every profile that has them. Additive-migration philosophy means
-- this is safe to run even if some profiles have since had these keys
-- removed manually by an admin (array_remove is a no-op on a value not
-- present).
-- ============================================================

ALTER TABLE profiles ALTER COLUMN module_access SET DEFAULT ARRAY[
  'dashboard','projects','strategy','strategy_quick','ad_config','creatives',
  'ad_review','analyzer','organic','notifications','reports','settings'
];

UPDATE profiles SET module_access = array_remove(module_access, 'history_ads');
UPDATE profiles SET module_access = array_remove(module_access, 'history_social');

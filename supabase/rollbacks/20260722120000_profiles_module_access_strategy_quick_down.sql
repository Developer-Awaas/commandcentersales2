-- Run manually: supabase db query --linked -f supabase/rollbacks/20260722120000_profiles_module_access_strategy_quick_down.sql
-- WARNING: reverts to the naming-mismatch bug this migration fixes — any
-- non-admin profile relying on the default would lose Strategy/LeadGen-V2
-- nav access again. Only run this if reverting the whole fix for a specific
-- understood reason. Coarse: removes 'strategy_quick' from any row where
-- 'strategy' is present, which could also remove a grant an admin added
-- deliberately after this migration ran — there's no way to distinguish
-- those from rows this migration itself touched.
ALTER TABLE profiles ALTER COLUMN module_access SET DEFAULT ARRAY[
  'dashboard','projects','strategy','ad_config','creatives',
  'ad_review','analyzer','organic','notifications','reports','settings'
];

UPDATE profiles
SET module_access = array_remove(module_access, 'strategy_quick')
WHERE 'strategy' = ANY(module_access);

-- DOWN migration for 20260728220000_canva_versioned_edit_tracking.sql
-- NOT auto-applied — the Supabase CLI only scans supabase/migrations/.
-- Run manually only if this needs to be reverted:
--   supabase db query --linked -f supabase/rollbacks/20260728220000_canva_versioned_edit_tracking_down.sql
--
-- Order matters: canva_edit_sessions references creative_asset_versions,
-- must drop it first.

DROP TABLE IF EXISTS canva_edit_sessions;
DROP TABLE IF EXISTS creative_asset_versions;

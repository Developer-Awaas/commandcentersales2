-- Run manually: supabase db query --linked -f supabase/rollbacks/20260721190000_canva_versioned_edit_tracking_down.sql
-- WARNING: destructive — drops all recorded Canva edit history.
DROP TABLE IF EXISTS canva_edit_sessions;
DROP TABLE IF EXISTS creative_asset_versions;

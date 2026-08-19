-- ============================================================
-- DOWN for 20260819120000_meta_campaign_map.sql
--
-- NOT auto-applied. Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260819120000_meta_campaign_map_down.sql
--
-- DESTRUCTIVE: every campaign→project mapping is lost. The manual ones were
-- typed by a human in the Monitor and are not reconstructible; the crm_bridge
-- ones can be re-ingested by replaying the bridge.
--
-- projects.external_ref is dropped too — it exists only for the bridge to
-- resolve against. Drop it and a replayed bridge payload resolves nothing.
-- ============================================================

DROP FUNCTION IF EXISTS public.assign_campaign_to_project(text, uuid, text);
DROP TABLE IF EXISTS meta_campaign_map;
DROP INDEX IF EXISTS projects_org_external_ref_idx;
ALTER TABLE projects DROP COLUMN IF EXISTS external_ref;

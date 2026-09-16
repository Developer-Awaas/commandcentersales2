-- T-008 (P0): creative_assets carried "Allow anon delete creative_assets"
-- (20260604120000) — FOR DELETE TO anon, authenticated USING (true). Anyone
-- holding the public anon key could delete every org's creatives.
--
-- SELECT/INSERT/UPDATE are already org-scoped TO authenticated ("Allow
-- select/insert/update creative_assets"); only DELETE needed replacing.
-- Every client delete (CreativeViewer, creative-history, history-service)
-- runs as a signed-in user on its own org's rows, so the scoped policy keeps
-- them working.
--
-- Down: supabase/rollbacks/20260916120000_fix_creative_assets_rls_down.sql

DROP POLICY IF EXISTS "Allow anon delete creative_assets" ON creative_assets;

DROP POLICY IF EXISTS "Allow delete creative_assets" ON creative_assets;
CREATE POLICY "Allow delete creative_assets" ON creative_assets
  FOR DELETE TO authenticated
  USING (org_id = get_current_user_org_id());

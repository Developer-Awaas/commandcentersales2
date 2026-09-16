-- DOWN for 20260916120000_fix_creative_assets_rls.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- ⚠️ RE-OPENS T-008: restores the anon DELETE USING (true) policy, which lets
-- anyone with the public anon key delete every org's creatives. Only for an
-- emergency where the scoped policy itself is proven broken — and replace it
-- again immediately.
BEGIN;

DROP POLICY IF EXISTS "Allow delete creative_assets" ON creative_assets;
CREATE POLICY "Allow anon delete creative_assets" ON creative_assets
  FOR DELETE TO anon, authenticated USING (true);

COMMIT;

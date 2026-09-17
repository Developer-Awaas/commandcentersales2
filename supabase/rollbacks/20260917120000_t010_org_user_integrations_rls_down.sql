-- DOWN for 20260917120000_t010_org_user_integrations_rls.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- ⚠️ RE-OPENS T-010 for this table. Emergency use only; replace again at once.
BEGIN;

DROP POLICY IF EXISTS "Allow delete org_user_integrations" ON org_user_integrations;
CREATE POLICY "Allow anon delete org_user_integrations" ON org_user_integrations
  FOR DELETE TO anon, authenticated USING (true);

COMMIT;

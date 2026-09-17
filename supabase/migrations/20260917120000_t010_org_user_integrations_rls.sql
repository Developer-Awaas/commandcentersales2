-- T-010 (P0) 1/3: org_user_integrations carried "Allow anon delete
-- org_user_integrations" (20260604120000) — FOR DELETE TO anon, authenticated
-- USING (true). Anyone with the anon key could delete every user's Canva
-- connection. Replaced with the same org + user rule SELECT/UPDATE already use.
-- Only client delete: src/components/CanvaConnectButton.tsx:88 (own row).
-- Edge writers (canva-oauth-callback, canva-sync-design, _shared/canva-oauth)
-- use the service role and are unaffected.
--
-- Down: supabase/rollbacks/20260917120000_t010_org_user_integrations_rls_down.sql

DROP POLICY IF EXISTS "Allow anon delete org_user_integrations" ON org_user_integrations;

DROP POLICY IF EXISTS "Allow delete org_user_integrations" ON org_user_integrations;
CREATE POLICY "Allow delete org_user_integrations" ON org_user_integrations
  FOR DELETE TO authenticated
  USING (org_id = get_current_user_org_id() AND user_id = auth.uid());

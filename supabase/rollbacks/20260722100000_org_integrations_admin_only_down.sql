-- Run manually: supabase db query --linked -f supabase/rollbacks/20260722100000_org_integrations_admin_only_down.sql
-- WARNING: reverts to the org-scoped-only policies (the actual vulnerability
-- this migration fixes). Only run this if the admin-gating itself needs to
-- be rolled back for a specific, understood reason.
DROP POLICY IF EXISTS "Admins can select org_integrations" ON org_integrations;
DROP POLICY IF EXISTS "Admins can insert org_integrations" ON org_integrations;
DROP POLICY IF EXISTS "Admins can update org_integrations" ON org_integrations;

CREATE POLICY "Allow select org_integrations" ON org_integrations FOR SELECT TO authenticated
  USING (org_id = get_current_user_org_id());
CREATE POLICY "Allow insert org_integrations" ON org_integrations FOR INSERT TO authenticated
  WITH CHECK (org_id = get_current_user_org_id());
CREATE POLICY "Allow update org_integrations" ON org_integrations FOR UPDATE TO authenticated
  USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

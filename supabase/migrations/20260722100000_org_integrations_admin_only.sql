-- ============================================================
-- Close a real credential-exposure gap: org_integrations (Meta/Google
-- API tokens, incl. meta_access_token) has been readable and writable
-- by ANY authenticated member of the org since the RLS org-scoping fix
-- (20260610150000) — that migration added org_id scoping everywhere
-- but never added a role check here, unlike profiles' admin-gated
-- update policy. Any org member — a disgruntled employee, a
-- compromised member account — can currently read and overwrite the
-- org's live Meta access token.
--
-- Found via the review-build reviewer-scoping verification (a
-- member-role account was created specifically to prove denial
-- boundaries by authentication, not row inspection — per Prompt C's
-- requirement). It failed: org_integrations read AND write both
-- succeeded for a plain member.
--
-- Fix: mirror profiles' existing admin-gated pattern exactly (same
-- EXISTS-subquery-against-profiles.role mechanism, not a new one) —
-- SELECT/INSERT/UPDATE now require org_id match AND the acting user's
-- own profiles.role = 'admin'.
--
-- Verified before this migration that no legitimate flow needs
-- non-admin access: SettingsPage.tsx (the only client-side
-- read/write caller) has no role gate today either — meaning
-- non-admin access to this page was itself unintended, not a
-- feature to preserve. meta-insights-sync and dhruv-anomaly-check
-- (the only Edge Function callers) both use the service-role client,
-- which bypasses RLS entirely — unaffected by this change.
-- ============================================================

DROP POLICY IF EXISTS "Allow select org_integrations" ON org_integrations;
DROP POLICY IF EXISTS "Allow insert org_integrations" ON org_integrations;
DROP POLICY IF EXISTS "Allow update org_integrations" ON org_integrations;

CREATE POLICY "Admins can select org_integrations"
  ON org_integrations FOR SELECT TO authenticated
  USING (
    org_id = get_current_user_org_id() AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert org_integrations"
  ON org_integrations FOR INSERT TO authenticated
  WITH CHECK (
    org_id = get_current_user_org_id() AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "Admins can update org_integrations"
  ON org_integrations FOR UPDATE TO authenticated
  USING (
    org_id = get_current_user_org_id() AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (org_id = get_current_user_org_id());

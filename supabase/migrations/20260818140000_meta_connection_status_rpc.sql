-- ============================================================
-- RB-PM2 — let a NON-ADMIN see whether Meta is connected.
--
-- Bug #42 correctly locked org_integrations to admins: the row holds
-- meta_access_token, and any org member being able to read a live API
-- credential was the vulnerability. That fix is not being weakened here.
--
-- But PerformanceMonitor's getConnectionStatus() reads that same table, so for
-- every non-admin the read returns zero rows and the page renders "Connect
-- Meta to see live performance" — regardless of the connection actually being
-- healthy. The campaign_metrics rows are readable by members and sitting right
-- there; the page just never gets far enough to show them.
--
-- Concretely: a Meta app reviewer is a member. They would connect an account,
-- watch the sync succeed, and still be told to connect one. That is an app
-- review failed on a permissions bug rather than on the product.
--
-- So: a SECURITY DEFINER function exposing only the NON-SECRET fields, scoped
-- to the caller's own org by the same helper every RLS policy here uses.
-- meta_access_token is deliberately absent from the return type — not filtered
-- at the callsite, absent, so no future edit can leak it by accident.
-- ============================================================

CREATE OR REPLACE FUNCTION public.meta_connection_status()
RETURNS TABLE (
  status              text,
  is_active           boolean,
  meta_ad_account_id  text,
  last_sync_at        timestamptz,
  meta_app_id         text,
  meta_granted_scopes text[],
  token_expires_at    timestamptz,
  meta_verified_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.status,
         oi.is_active,
         oi.meta_ad_account_id,
         oi.last_sync_at,
         oi.meta_app_id,
         oi.meta_granted_scopes,
         oi.token_expires_at,
         oi.meta_verified_at
  FROM org_integrations oi
  WHERE oi.org_id = get_current_user_org_id()
    AND oi.provider = 'meta'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.meta_connection_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meta_connection_status() TO authenticated;

COMMENT ON FUNCTION public.meta_connection_status() IS
  'Non-secret Meta connection status for the CALLER''S OWN org. Exists because org_integrations is admin-only (bug #42) while every member needs to know whether Meta is connected. Never returns meta_access_token — it is absent from the return type, not filtered out.';

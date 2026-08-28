-- DOWN for 20260828120000_publish_targets.sql. Manual only:
--   supabase db query --linked -f supabase/rollbacks/20260828120000_publish_targets_down.sql
--
-- Dropping publish_page_id/publish_ig_user_id DISCARDS the admin's chosen
-- publish targets. That is intended for a rollback, but it is a real loss:
-- re-applying the UP migration comes back with the columns empty, and the
-- Post button correctly hides until an admin re-picks a target. Nothing
-- silently falls back to meta_page_id — that is the whole point.

ALTER TABLE org_integrations DROP COLUMN IF EXISTS publish_page_id;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS publish_ig_user_id;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS publish_page_name;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS publish_ig_username;

-- Restore the pre-publish CHECK sets.
ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_provider_check;
ALTER TABLE agent_interactions
  ADD CONSTRAINT agent_interactions_provider_check
  CHECK (provider IS NULL OR provider IN ('anthropic', 'openai', 'gemini'));
ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_call_type_check;
ALTER TABLE agent_interactions
  ADD CONSTRAINT agent_interactions_call_type_check
  CHECK (call_type IS NULL OR call_type IN ('text', 'image_gen', 'image_edit', 'vision'));
-- NOTE: any publish rows already written violate the narrowed CHECK. Postgres
-- validates on ADD CONSTRAINT, so this DOWN fails loudly rather than leaving
-- rows the schema says cannot exist. Delete them first if that is intended:
--   DELETE FROM agent_interactions WHERE call_type = 'publish';

-- Restore the pre-publish RPC signature (RB-PM2's original).
DROP FUNCTION IF EXISTS public.meta_connection_status();

CREATE FUNCTION public.meta_connection_status()
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
  SELECT oi.status, oi.is_active, oi.meta_ad_account_id, oi.last_sync_at,
         oi.meta_app_id, oi.meta_granted_scopes, oi.token_expires_at, oi.meta_verified_at
  FROM org_integrations oi
  WHERE oi.org_id = get_current_user_org_id() AND oi.provider = 'meta'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.meta_connection_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meta_connection_status() TO authenticated;

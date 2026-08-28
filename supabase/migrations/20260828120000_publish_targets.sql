-- ============================================================
-- RB-PUB STEP 0a — publish TARGETS are their own binding, separate from the
-- insights ad-account binding.
--
-- WHY A SEPARATE COLUMN AND NOT meta_page_id: meta_page_id is DISCOVERED —
-- resolveMetaAssets() writes whatever /me/accounts returns first. Using it as
-- a publish target would mean the app posts to whichever Page Meta happened to
-- list first, which on this token is a real customer's Page (Neelachala
-- Homes). A publish target must be CHOSEN by a human, never discovered, and
-- must be impossible to acquire as a side effect of an unrelated sync.
--
-- publish_page_id / publish_ig_user_id are therefore the ONLY values the
-- publish functions accept. They are set deliberately in Settings → Publishing
-- by an admin, and cross-checked at call time against the server-side
-- PUBLISH_ALLOWED_PAGE_IDS allowlist, which the org row cannot influence.
-- Two independent gates: a wrong row alone cannot post anywhere.
--
-- publish_page_name / publish_ig_username are DISPLAY ONLY — never used to
-- target anything. They exist so the approval dialog can say "Posts to: AWAAS
-- CC Test Page" instead of a bare numeric id, which is the difference between
-- a human confirming a target and a human confirming a string.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='publish_page_id') THEN
    ALTER TABLE org_integrations ADD COLUMN publish_page_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='publish_ig_user_id') THEN
    ALTER TABLE org_integrations ADD COLUMN publish_ig_user_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='publish_page_name') THEN
    ALTER TABLE org_integrations ADD COLUMN publish_page_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='publish_ig_username') THEN
    ALTER TABLE org_integrations ADD COLUMN publish_ig_username text;
  END IF;
END $$;

COMMENT ON COLUMN org_integrations.publish_page_id IS
  'The ONLY Facebook Page meta-publish will post to for this org. Chosen by an admin in Settings, never discovered — unlike meta_page_id, which is whatever /me/accounts listed first. Still cross-checked against the PUBLISH_ALLOWED_PAGE_IDS env allowlist at call time.';
COMMENT ON COLUMN org_integrations.publish_ig_user_id IS
  'The ONLY Instagram business account meta-publish will post to for this org. Gated by publish_page_id''s allowlist check — an IG publish rides the linked Page''s token.';
COMMENT ON COLUMN org_integrations.publish_page_name IS
  'Display only. Shown in the approval dialog so a human confirms a NAME, not a numeric id. Never used for targeting.';

-- ------------------------------------------------------------
-- The cost ledger has to be able to record a publish. A Graph write costs no
-- model spend, but "zero cost" and "not recorded" are different facts, and
-- only one of them survives a question about what this app posted and when.
--
-- Both CHECKs are NULL-permissive already; this only widens the allowed set.
-- ------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_provider_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_provider_check
    CHECK (provider IS NULL OR provider IN ('anthropic', 'openai', 'gemini', 'meta'));
  ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_call_type_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_call_type_check
    CHECK (call_type IS NULL OR call_type IN ('text', 'image_gen', 'image_edit', 'vision', 'publish'));
END $$;

-- ------------------------------------------------------------
-- meta_connection_status(): the non-admin read path (RB-PM2). The Post button
-- must be visible to members, and org_integrations is admin-only (bug #42), so
-- the publish targets have to come through this same door.
--
-- Return type changes, so this is a DROP + CREATE, not CREATE OR REPLACE.
-- meta_access_token remains ABSENT from the return type — not filtered, absent.
-- ------------------------------------------------------------
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
  meta_verified_at    timestamptz,
  publish_page_id     text,
  publish_ig_user_id  text,
  publish_page_name   text,
  publish_ig_username text
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
         oi.meta_verified_at,
         oi.publish_page_id,
         oi.publish_ig_user_id,
         oi.publish_page_name,
         oi.publish_ig_username
  FROM org_integrations oi
  WHERE oi.org_id = get_current_user_org_id()
    AND oi.provider = 'meta'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.meta_connection_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meta_connection_status() TO authenticated;

COMMENT ON FUNCTION public.meta_connection_status() IS
  'Non-secret Meta connection status + publish targets for the CALLER''S OWN org. Exists because org_integrations is admin-only (bug #42) while every member needs to know whether Meta is connected and where a post would go. Never returns meta_access_token — it is absent from the return type, not filtered out.';

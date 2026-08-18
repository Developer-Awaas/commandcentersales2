-- ============================================================
-- RB-MO — Meta OAuth (FB Login for Business) + token provenance.
--
-- WHY THIS EXISTS: the only real Meta token this product ever stored was
-- minted by an application that has since been DELETED. Every Graph call with
-- it returns OAuthException 190 "Application has been deleted", and
-- meta-insights-sync has logged nothing but `skipped` since 2026-07-20 — a
-- silent failure nobody saw for a month, because the row looked populated.
--
-- A token you cannot attribute to an app is a token you cannot trust. From
-- here on, every stored token records WHICH app minted it, WHICH scopes were
-- actually granted, and WHEN that was verified against /debug_token — so the
-- question "is this ours?" is answered by a column, never by a Graph call
-- that may itself fail for the same reason.
--
-- All additive and nullable: rows predating this have genuinely unknown
-- provenance, and a backfill would be inventing it. NULL meta_app_id means
-- "unverified — treat as suspect", which is exactly right for the NH token.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='meta_app_id') THEN
    ALTER TABLE org_integrations ADD COLUMN meta_app_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='meta_granted_scopes') THEN
    ALTER TABLE org_integrations ADD COLUMN meta_granted_scopes text[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='meta_token_type') THEN
    ALTER TABLE org_integrations ADD COLUMN meta_token_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='meta_user_id') THEN
    ALTER TABLE org_integrations ADD COLUMN meta_user_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='meta_page_id') THEN
    ALTER TABLE org_integrations ADD COLUMN meta_page_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='meta_ig_user_id') THEN
    ALTER TABLE org_integrations ADD COLUMN meta_ig_user_id text;
  END IF;
  -- When /debug_token last confirmed the row. NULL = never verified.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='meta_verified_at') THEN
    ALTER TABLE org_integrations ADD COLUMN meta_verified_at timestamptz;
  END IF;
END $$;

-- oauth_flow_sessions already carries `provider` and is reused as-is for Meta.
-- code_verifier is relaxed to NULL because PKCE is PROVIDER-dependent: Canva
-- requires it, Facebook Login does not support it. Storing a random unused
-- verifier to satisfy NOT NULL would misrepresent the flow as PKCE-protected
-- when the state nonce is what actually protects it.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='oauth_flow_sessions' AND column_name='code_verifier' AND is_nullable='NO'
  ) THEN
    ALTER TABLE oauth_flow_sessions ALTER COLUMN code_verifier DROP NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN org_integrations.meta_app_id IS
  'App that minted meta_access_token, from /debug_token. NULL = unverified provenance (pre-dates RB-MO) — treat as suspect, do not assume it is ours.';
COMMENT ON COLUMN org_integrations.meta_granted_scopes IS
  'Scopes /debug_token reported as actually granted — not what was requested.';
COMMENT ON COLUMN oauth_flow_sessions.code_verifier IS
  'PKCE verifier. NULL for providers without PKCE support (Facebook); the single-use state nonce is the CSRF control there.';

-- ============================================================
-- DOWN for 20260818120000_meta_oauth_provenance.sql
--
-- NOT auto-applied. Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260818120000_meta_oauth_provenance_down.sql
--
-- DESTRUCTIVE: drops the provenance columns, which is the entire point of the
-- UP. After this, a stored token is once again unattributable — the exact
-- state that let a token from a DELETED app sit in org_integrations looking
-- healthy for a month. Only run this if the OAuth work is being abandoned.
--
-- code_verifier is deliberately NOT restored to NOT NULL: any Meta OAuth
-- session row written since the UP has a NULL there, so re-adding the
-- constraint would fail. Delete those rows first if you truly need it back
-- (they are single-use and expire in 10 minutes, so waiting also works).
-- ============================================================

ALTER TABLE org_integrations DROP COLUMN IF EXISTS meta_app_id;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS meta_granted_scopes;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS meta_token_type;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS meta_user_id;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS meta_page_id;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS meta_ig_user_id;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS meta_verified_at;

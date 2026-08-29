-- DOWN for 20260829150000_published_assets_require_provenance.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
BEGIN;

ALTER TABLE published_assets
  DROP CONSTRAINT IF EXISTS published_assets_has_provenance_check;

COMMIT;

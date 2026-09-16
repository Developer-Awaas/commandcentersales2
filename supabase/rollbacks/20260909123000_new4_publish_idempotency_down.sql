-- DOWN for 20260909123000_new4_publish_idempotency.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
BEGIN;

DROP INDEX IF EXISTS uq_published_assets_idempotency_key;
ALTER TABLE published_assets DROP COLUMN IF EXISTS idempotency_key;

COMMIT;

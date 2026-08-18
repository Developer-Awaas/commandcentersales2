-- ============================================================
-- DOWN for 20260818130000_org_integrations_status.sql
--
-- NOT auto-applied. Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260818130000_org_integrations_status_down.sql
--
-- Dropping this column returns the schema to a state where "user switched it
-- off" and "the token is dead" are the same value again — which is exactly
-- how a customer's broken integration disappeared from the sync loop for a
-- month without a single log line. is_active is left as-is; it was kept in
-- sync with status by the sync function, so no data is lost by dropping.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='org_integrations_status_check') THEN
    ALTER TABLE org_integrations DROP CONSTRAINT org_integrations_status_check;
  END IF;
END $$;

ALTER TABLE org_integrations DROP COLUMN IF EXISTS status;

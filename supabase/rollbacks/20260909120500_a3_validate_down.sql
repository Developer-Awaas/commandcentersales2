-- DOWN for 20260909120500_a3_validate.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- A validated constraint cannot be un-validated in place. Re-add both as
-- NOT VALID, which restores the post-t5m, pre-validate state exactly.
BEGIN;

ALTER TABLE org_integrations DROP CONSTRAINT IF EXISTS org_integrations_ad_account_format_check;
ALTER TABLE org_integrations ADD CONSTRAINT org_integrations_ad_account_format_check
  CHECK (meta_ad_account_id IS NULL OR meta_ad_account_id ~ '^act_\d+$') NOT VALID;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_ad_account_format_check;
ALTER TABLE projects ADD CONSTRAINT projects_ad_account_format_check
  CHECK (meta_ad_account_id IS NULL OR meta_ad_account_id ~ '^act_\d+$') NOT VALID;

COMMIT;

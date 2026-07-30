-- ============================================================
-- Fix meta-insights-sync's cron job: cron.job.command has the
-- project URL and service-role key as literal values baked into
-- the SQL text — readable in plaintext by anyone with read access
-- to cron.job (same class of exposure PR #20 fixed for
-- dhruv-anomaly-check, flagged there as a follow-up for this job
-- specifically).
--
-- cleanup-stuck-agent-turns was audited alongside this job and
-- needs NO change: its cron.job.command is a bare in-database SQL
-- UPDATE (no net.http_post call, no service-role key, no vault
-- dependency at all) — confirmed live before writing this
-- migration. Only meta-insights-sync required the vault rewrite.
--
-- Fix: read both values from Supabase Vault at call time via
-- vault.decrypted_secrets, same pattern as
-- 20260729130000_dhruv_anomaly_check_cron_vault.sql. Requires the
-- 'project_url' and 'service_role_key' vault secrets to already
-- exist (they do — seeded for the dhruv fix and confirmed present
-- again before this migration). If they don't exist yet, this
-- migration skips (RAISE WARNING) rather than scheduling a cron
-- job that would fail immediately.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url')
       OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
      RAISE WARNING 'vault secrets "project_url"/"service_role_key" not found — meta-insights-sync cron job was NOT rescheduled. '
                    'Seed them first (see supabase/migrations/20260729130000_dhruv_anomaly_check_cron_vault.sql history / CLAUDE.md), then re-run this migration.';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-insights-sync') THEN
        PERFORM cron.unschedule('meta-insights-sync');
      END IF;

      PERFORM cron.schedule(
        'meta-insights-sync',
        '*/15 * * * *',
        $cron$
        SELECT net.http_post(
          url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/meta-insights-sync',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
          ),
          body    := '{}'::jsonb
        );
        $cron$
      );

      RAISE NOTICE 'pg_cron job "meta-insights-sync" rescheduled (every 15 min, vault-backed, no plaintext key).';
    END IF;
  ELSE
    RAISE WARNING 'pg_cron extension not enabled — meta-insights-sync job was NOT scheduled.';
  END IF;
END $$;

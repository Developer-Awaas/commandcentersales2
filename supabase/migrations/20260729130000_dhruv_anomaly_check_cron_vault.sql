-- ============================================================
-- Fix dhruv-anomaly-check's cron job: it referenced
-- current_setting('app.supabase_url') / current_setting
-- ('app.supabase_service_role_key') — database-level GUCs that
-- were never set (unlike meta-insights-sync's cron job, which
-- has the URL/key hardcoded as literals). Every hourly run has
-- been failing since 20260626010000 with an undefined-GUC error,
-- silently (no alert channel watches cron.job_run_details).
--
-- Fix: read both values from Supabase Vault at call time via
-- vault.decrypted_secrets, instead of a GUC. Requires the
-- 'project_url' and 'service_role_key' vault secrets to already
-- exist (seeded once, manually, NOT by this migration — an
-- env-specific one-off, same treatment as the ALTER DATABASE
-- fallback this replaces). If they don't exist yet, this
-- migration skips (RAISE WARNING) rather than scheduling a cron
-- job that will just fail the same way GUCs did — same guard
-- style as pg_cron-not-enabled in the sibling migrations.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url')
       OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
      RAISE WARNING 'vault secrets "project_url"/"service_role_key" not found — dhruv-anomaly-check cron job was NOT rescheduled. '
                    'Seed them first (see supabase/migrations/20260626010000_dhruv_anomaly_check_cron.sql history / CLAUDE.md), then re-run this migration.';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dhruv-anomaly-check') THEN
        PERFORM cron.unschedule('dhruv-anomaly-check');
      END IF;

      PERFORM cron.schedule(
        'dhruv-anomaly-check',
        '0 * * * *',
        $cron$
        SELECT net.http_post(
          url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/dhruv-anomaly-check',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
          ),
          body    := '{}'::jsonb
        );
        $cron$
      );

      RAISE NOTICE 'pg_cron job "dhruv-anomaly-check" rescheduled (hourly, vault-backed).';
    END IF;
  ELSE
    RAISE WARNING 'pg_cron extension not enabled — dhruv-anomaly-check job was NOT scheduled.';
  END IF;
END $$;

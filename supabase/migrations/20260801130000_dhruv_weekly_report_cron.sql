-- ============================================================
-- CC-P4 Step 6: weekly Dhruv performance report. Invokes the
-- dhruv-weekly-report Edge Function every Monday 06:00 UTC — it writes a
-- tool_outputs 'performance'/weekly_report row + a notification per active
-- org WITH metrics (orgs with no data are skipped inside the function).
--
-- Vault-backed, same pattern as 20260729130000_dhruv_anomaly_check_cron_vault
-- (no plaintext keys). Skips with a WARNING if the vault secrets aren't
-- seeded yet rather than scheduling a job that would just fail.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url')
       OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
      RAISE WARNING 'vault secrets "project_url"/"service_role_key" not found — dhruv-weekly-report cron job was NOT scheduled.';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dhruv-weekly-report') THEN
        PERFORM cron.unschedule('dhruv-weekly-report');
      END IF;

      PERFORM cron.schedule(
        'dhruv-weekly-report',
        '0 6 * * 1',
        $cron$
        SELECT net.http_post(
          url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/dhruv-weekly-report',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
          ),
          body    := '{}'::jsonb
        );
        $cron$
      );

      RAISE NOTICE 'pg_cron job "dhruv-weekly-report" scheduled (weekly, Monday 06:00 UTC, vault-backed).';
    END IF;
  ELSE
    RAISE WARNING 'pg_cron extension not enabled — dhruv-weekly-report job was NOT scheduled.';
  END IF;
END $$;

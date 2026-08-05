-- ============================================================
-- Weekly backstop sweep for tool_outputs' 30-row-per-(org_id, tool)
-- retention cap (CC-P3 Step 3). The primary enforcement is
-- saveToolOutput's own post-insert check (src/lib/history-service.ts) —
-- this cron job exists only to catch rows that check missed. Same
-- vault-backed pattern as 20260729130000_dhruv_anomaly_check_cron_vault.sql
-- and 20260730120000_meta_insights_sync_cron_vault.sql — no plaintext
-- keys, skips (RAISE WARNING) if the vault secrets aren't seeded yet.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url')
       OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
      RAISE WARNING 'vault secrets "project_url"/"service_role_key" not found — history-retention-sweep cron job was NOT scheduled. '
                    'Seed them first, then re-run this migration.';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'history-retention-sweep') THEN
        PERFORM cron.unschedule('history-retention-sweep');
      END IF;

      PERFORM cron.schedule(
        'history-retention-sweep',
        '0 3 * * 0',
        $cron$
        SELECT net.http_post(
          url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/history-retention-sweep',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
          ),
          body    := '{}'::jsonb
        );
        $cron$
      );

      RAISE NOTICE 'pg_cron job "history-retention-sweep" scheduled (weekly, Sunday 03:00 UTC, vault-backed).';
    END IF;
  ELSE
    RAISE WARNING 'pg_cron extension not enabled — history-retention-sweep job was NOT scheduled.';
  END IF;
END $$;

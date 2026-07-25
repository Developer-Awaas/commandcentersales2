-- Schedule Dhruv's anomaly-check job every hour on the hour.
-- Pure SQL + threshold math — zero LLM cost. Creates notifications for
-- high-severity alerts (CPL spike, ad fatigue, CTR drop).
--
-- Prerequisite: pg_cron extension must be enabled in the project.
-- (Dashboard → Database → Extensions → pg_cron)
-- If not enabled, this block emits a WARNING and skips — it won't error.
-- (This migration originally assumed pg_cron was "already" enabled — true
-- on prod, since it was turned on manually via the dashboard and never
-- through a migration, but false on any fresh environment: local
-- `supabase start`, or a from-scratch fork. Guarded to match the sibling
-- cron migration's pattern, 20260617130000.)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dhruv-anomaly-check') THEN
      PERFORM cron.unschedule('dhruv-anomaly-check');
    END IF;

    PERFORM cron.schedule(
      'dhruv-anomaly-check',
      '0 * * * *',
      $cron$
      SELECT net.http_post(
        url     := current_setting('app.supabase_url') || '/functions/v1/dhruv-anomaly-check',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
        ),
        body    := '{}'::jsonb
      );
      $cron$
    );

    RAISE NOTICE 'pg_cron job "dhruv-anomaly-check" scheduled (hourly).';
  ELSE
    RAISE WARNING 'pg_cron extension not enabled — dhruv-anomaly-check job was NOT scheduled. '
                  'Enable it at Dashboard → Database → Extensions → pg_cron, then re-run this migration.';
  END IF;
END $$;

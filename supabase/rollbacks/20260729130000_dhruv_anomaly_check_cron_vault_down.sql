-- ============================================================
-- DOWN migration for 20260729130000_dhruv_anomaly_check_cron_vault.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260729130000_dhruv_anomaly_check_cron_vault_down.sql
--
-- Unschedules the job rather than restoring the old GUC-based
-- version — that version was permanently broken (unset GUCs), so
-- there is no working prior state to roll back to.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dhruv-anomaly-check') THEN
    PERFORM cron.unschedule('dhruv-anomaly-check');
  END IF;
END $$;

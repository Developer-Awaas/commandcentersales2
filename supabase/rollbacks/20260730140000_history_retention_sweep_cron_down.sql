-- ============================================================
-- DOWN migration for 20260730140000_history_retention_sweep_cron.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260730140000_history_retention_sweep_cron_down.sql
--
-- Unschedules the job. Safe to run any time — this cron job is only a
-- backstop; saveToolOutput's own post-insert cap enforcement keeps
-- working without it, just without the weekly catch-up sweep.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'history-retention-sweep') THEN
    PERFORM cron.unschedule('history-retention-sweep');
  END IF;
END $$;

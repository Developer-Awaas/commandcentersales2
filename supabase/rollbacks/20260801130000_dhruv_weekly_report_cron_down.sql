-- ============================================================
-- DOWN migration for 20260801130000_dhruv_weekly_report_cron.sql
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260801130000_dhruv_weekly_report_cron_down.sql
-- Unschedules the weekly report job. Safe any time.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dhruv-weekly-report') THEN
    PERFORM cron.unschedule('dhruv-weekly-report');
  END IF;
END $$;

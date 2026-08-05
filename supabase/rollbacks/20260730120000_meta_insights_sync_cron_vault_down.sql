-- ============================================================
-- DOWN migration for 20260730120000_meta_insights_sync_cron_vault.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260730120000_meta_insights_sync_cron_vault_down.sql
--
-- Unschedules the job. Unlike the sibling dhruv-anomaly-check
-- rollback, the PRE-migration version of this job was not broken
-- (it had a working, but plaintext, service-role key literal in
-- cron.job.command) — that literal was never captured anywhere by
-- this migration or its tooling, so it cannot be safely
-- reconstructed here. Running this rollback stops meta-insights-
-- sync entirely (campaign_metrics stops updating every 15 min)
-- until a new cron.schedule call is issued manually.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-insights-sync') THEN
    PERFORM cron.unschedule('meta-insights-sync');
  END IF;
END $$;

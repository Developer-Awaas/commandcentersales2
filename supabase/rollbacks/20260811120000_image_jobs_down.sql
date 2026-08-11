-- DOWN for 20260811120000_image_jobs.sql
-- Lives in supabase/rollbacks/ (NOT migrations/) so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/20260811120000_image_jobs_down.sql
--
-- NOTE: reverting this migration alone will break async generation — the client
-- (gemini-service.ts) and generate-image's async branch both depend on the table.
-- Revert the code to the sync path first, then run this.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stuck-image-jobs') THEN
    PERFORM cron.unschedule('cleanup-stuck-image-jobs');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'image_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE image_jobs;
  END IF;
END $$;

DROP POLICY IF EXISTS "Org members can view their image jobs" ON image_jobs;
DROP TABLE IF EXISTS image_jobs;

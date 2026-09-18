-- DOWN for 20260918120000_t006a_reaper_classify.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- Restores the reaper to 20260811120000's original shape: 'queued' only, the
-- original unclassified message. Only correct to run together with rolling
-- back the generate-image edge deploy that started writing 'running'.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stuck-image-jobs') THEN
      PERFORM cron.unschedule('cleanup-stuck-image-jobs');
    END IF;

    PERFORM cron.schedule(
      'cleanup-stuck-image-jobs',
      '*/10 * * * *',
      $cron$
        UPDATE public.image_jobs
        SET    status       = 'failed',
               error        = 'Generation exceeded the Edge Function wall-clock limit',
               completed_at = now()
        WHERE  status     = 'queued'
          AND  created_at < now() - interval '10 minutes';
      $cron$
    );
  END IF;
END $$;

COMMIT;

-- T-006a write-site (2/2): the reaper (20260811120000) only ever reaped rows
-- still 'queued'. Once generate-image starts writing status='running' before
-- calling the provider (edge change, same commit), a job can get killed by
-- the platform wall-clock limit AFTER that transition — and a 'running' row
-- is exactly as stuck as a 'queued' one, so the reaper must catch both.
--
-- Classification here matches _shared/image-error.ts's vocabulary but can
-- only ever write the two classes the edge function itself cannot produce:
--   'running' when reaped → wall_clock  (work started; the isolate died
--                                        mid-flight — started_at proves it)
--   'queued'  when reaped → reaper      (the async task never even flipped
--                                        the row to running; started_at is
--                                        still null)
-- Both messages carry the same [class] prefix formatClassifiedError() uses,
-- so image_jobs.error is machine-parseable no matter which side wrote it.
--
-- NOT applied to TEST or deployed as part of this commit — rides the same
-- gated deploy as the generate-image edge change it depends on.
--
-- Down: supabase/rollbacks/20260918120000_t006a_reaper_classify_down.sql

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
               error        = CASE status
                                 WHEN 'running' THEN '[wall_clock] Killed by the platform wall-clock limit while running.'
                                 ELSE '[reaper] Never transitioned to running — reaped after 10 minutes queued.'
                               END,
               completed_at = now()
        WHERE  status IN ('queued', 'running')
          AND  created_at < now() - interval '10 minutes';
      $cron$
    );

    RAISE NOTICE 'pg_cron job "cleanup-stuck-image-jobs" rescheduled (T-006a: now reaps running too).';
  ELSE
    RAISE WARNING 'pg_cron extension not enabled — stuck image-job cleanup was NOT scheduled. '
                  'Enable it at Dashboard → Database → Extensions → pg_cron, then re-run this migration.';
  END IF;
END $$;

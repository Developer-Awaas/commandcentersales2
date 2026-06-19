-- pg_cron reaper: mark agent_turns rows that have been stuck in 'working'
-- for more than 10 minutes as 'failed'. This covers the tail case where
-- the Edge Function exceeds the wall-clock limit (or crashes hard without
-- triggering the top-level catch in aarav-orchestrate) and never writes a
-- terminal status to the row, leaving the client UI spinning forever.
--
-- Runs every 10 minutes. The 10-minute threshold is intentional:
--   - Supabase Free/Pro wall-clock limit: 150s (~2.5 min)
--   - Supabase Team wall-clock limit: 400s (~7 min)
--   - 10 min guarantees a stuck row is caught even on the longest-running plan.
--
-- Prerequisite: pg_cron extension must be enabled in the project.
-- (Dashboard → Database → Extensions → pg_cron)
-- If not enabled, this block emits a WARNING and skips — it won't error.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule any prior version so this migration is safely re-runnable.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stuck-agent-turns') THEN
      PERFORM cron.unschedule('cleanup-stuck-agent-turns');
    END IF;

    PERFORM cron.schedule(
      'cleanup-stuck-agent-turns',
      '*/10 * * * *',
      $cron$
        UPDATE public.agent_turns
        SET    status     = 'failed',
               updated_at = now()
        WHERE  status     = 'working'
          AND  updated_at < now() - interval '10 minutes';
      $cron$
    );

    RAISE NOTICE 'pg_cron job "cleanup-stuck-agent-turns" scheduled (every 10 min).';
  ELSE
    RAISE WARNING 'pg_cron extension not enabled — stuck-turn cleanup job was NOT scheduled. '
                  'Enable it at Dashboard → Database → Extensions → pg_cron, then re-run this migration.';
  END IF;
END $$;

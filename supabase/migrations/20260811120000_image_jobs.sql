-- ============================================================
-- image_jobs — async image generation.
--
-- WHY: Supabase's request idle timeout is 150s; a gpt-image-2 edit
-- at quality:'high' with 5 reference images measures 129.4s live on
-- TEST (HTTP 200). ~20s of slack, and three ways to lose it:
--   - 3 concurrent generations per click (StrategyResult.tsx),
--   - withRetry re-running a whole generation on a 429 (129+2+129),
--   - no AbortSignal on the OpenAI fetch, so nothing but the
--     gateway ever stops a slow call.
-- Result: intermittent 504s with the request hung in the browser.
--
-- Fix: generate-image returns a job id immediately and finishes the
-- work in EdgeRuntime.waitUntil(). This table is the handoff — the
-- client watches the row via Realtime and reads the PNG from Storage.
--
-- RLS shape is deliberately agent_interactions', NOT tool_outputs':
-- src/ only ever SELECTs this table; every write is service-role from
-- the Edge Function. Bug #46's lesson is that the full CRUD policy set
-- is required when src/ WRITES a table — that is not the case here, so
-- SELECT-only is correct rather than an oversight.
-- ============================================================

CREATE TABLE IF NOT EXISTS image_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done', 'failed')),
  storage_path text,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_image_jobs_org_created ON image_jobs (org_id, created_at DESC);
-- Partial index for the reaper below: only ever scans unfinished rows.
CREATE INDEX IF NOT EXISTS idx_image_jobs_queued ON image_jobs (created_at) WHERE status = 'queued';

ALTER TABLE image_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view their image jobs" ON image_jobs;
CREATE POLICY "Org members can view their image jobs"
  ON image_jobs FOR SELECT
  TO authenticated
  USING (org_id = get_current_user_org_id());

-- Realtime: the client subscribes to its own job row rather than polling.
-- (Poll fallback still exists client-side — a dropped socket must not hang
-- a generation.) Same mechanism as creative_assets in 20260604120000.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'image_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE image_jobs;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Reaper: a background task killed by the wall-clock limit never
-- writes a terminal status, which would leave the client waiting on a
-- row that will never change. 10 minutes clears the longest plan
-- (Free/Pro 150s, Team 400s).
--
-- The pg_extension guard is mandatory, not defensive boilerplate:
-- bug #44 was this exact migration shape hard-failing every fresh
-- environment with `schema "cron" does not exist`.
-- ------------------------------------------------------------
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

    RAISE NOTICE 'pg_cron job "cleanup-stuck-image-jobs" scheduled (every 10 min).';
  ELSE
    RAISE WARNING 'pg_cron extension not enabled — stuck image-job cleanup was NOT scheduled. '
                  'Enable it at Dashboard → Database → Extensions → pg_cron, then re-run this migration.';
  END IF;
END $$;

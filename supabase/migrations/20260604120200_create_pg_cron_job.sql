/*
  # Schedule Meta insights sync every 15 minutes via pg_cron

  IMPORTANT: Before running this migration, replace the placeholders:
    - YOUR_PROJECT_REF  → your Supabase project ref (found in project URL)
    - YOUR_SERVICE_ROLE_KEY → your service role key (from Project Settings > API)

  The pg_net extension must be enabled: Dashboard > Extensions > pg_net
  The pg_cron extension must be enabled: Dashboard > Extensions > pg_cron
*/

-- Uncomment and fill in credentials before running:
/*
SELECT cron.schedule(
  'meta-insights-sync',
  '*\/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/meta-insights-sync',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
*/

-- To verify the job was created:
-- SELECT * FROM cron.job WHERE jobname = 'meta-insights-sync';

-- To remove the job if needed:
-- SELECT cron.unschedule('meta-insights-sync');

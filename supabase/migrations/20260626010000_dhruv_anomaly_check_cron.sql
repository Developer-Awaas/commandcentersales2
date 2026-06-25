-- Schedule Dhruv's anomaly-check job every hour on the hour.
-- Pure SQL + threshold math — zero LLM cost. Creates notifications for
-- high-severity alerts (CPL spike, ad fatigue, CTR drop).
--
-- Requires pg_cron to be enabled (already is — meta-insights-sync uses it).
-- Edge Function URL resolves automatically via Supabase internals.

SELECT cron.schedule(
  'dhruv-anomaly-check',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/dhruv-anomaly-check',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

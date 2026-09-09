-- ============================================================
-- CC-TEST cron parity with PROD.  NOT a migration — lives in
-- supabase/scripts/ so the CLI never auto-applies it.
--
-- Apply:  supabase db query --linked -f supabase/scripts/test-cron-parity.sql
--         (confirm `cat supabase/.temp/project-ref` = yelmuykbqdyeikgbmkoq first)
--
-- WHY THIS EXISTS.  Discovery on 2026-09-09 found CC-TEST carrying two jobs
-- against PROD's five, and pg_net absent — so `dhruv-anomaly-check` had never
-- once invoked its function (934 consecutive `schema "net" does not exist`
-- failures), and `dhruv-weekly-report` / `history-retention-sweep` /
-- `meta-insights-sync` had no job at all.  The vault migrations that would
-- have fixed this (20260729130000, 20260730120000, 20260730140000,
-- 20260801130000) all RAISE WARNING and skip when the vault secrets are
-- missing, which is exactly what happened here — so replaying migrations
-- does not close the gap, and this script does.
--
-- SECRETS.  `project_url` is not a secret and is seeded below.
-- `service_role_key` IS, and is deliberately NOT in this file: seed it once by
-- hand (see docs/runbooks/test-cron-parity.md), then re-run this script.  That
-- is the same contract 20260729130000 sets for PROD — the script schedules
-- nothing rather than scheduling jobs that would fail on a missing secret.
--
-- `cleanup-stuck-image-jobs` is intentionally untouched: it is pure SQL, has
-- no PROD counterpart, and works without pg_net.
-- ============================================================

create extension if not exists pg_net;

-- Non-secret. Idempotent: vault.create_secret errors on a duplicate name.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret(
      'https://yelmuykbqdyeikgbmkoq.supabase.co',
      'project_url',
      'CC-TEST project URL, read by the pg_cron jobs at call time'
    );
    raise notice 'vault secret "project_url" seeded.';
  end if;
end $$;

do $$
declare
  j record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'pg_cron not enabled — no jobs scheduled.';
    return;
  end if;

  if not exists (select 1 from vault.secrets where name = 'service_role_key') then
    raise warning 'vault secret "service_role_key" not found — NO jobs scheduled. '
                  'Seed it once (docs/runbooks/test-cron-parity.md), then re-run this script.';
    return;
  end if;

  -- Same four jobnames, schedules and bodies as PROD; the URL and bearer are
  -- read from the vault at call time, never baked into cron.job.command.
  for j in
    select * from (values
      ('dhruv-anomaly-check',     '0 * * * *'),
      ('dhruv-weekly-report',     '0 6 * * 1'),
      ('history-retention-sweep', '0 3 * * 0'),
      ('meta-insights-sync',      '*/15 * * * *')
    ) as t(jobname, schedule)
  loop
    -- Idempotent by jobname: an existing job is replaced, so re-running this
    -- script converges rather than stacking duplicates. This is also what
    -- rewrites dhruv-anomaly-check off its dead current_setting() GUCs.
    if exists (select 1 from cron.job where jobname = j.jobname) then
      perform cron.unschedule(j.jobname);
    end if;

    perform cron.schedule(j.jobname, j.schedule, format(
      $cron$
      SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/%s',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        ),
        body    := '{}'::jsonb
      );
      $cron$, j.jobname));

    raise notice 'scheduled % (%)', j.jobname, j.schedule;
  end loop;
end $$;

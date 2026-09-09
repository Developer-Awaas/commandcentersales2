# CC-TEST cron parity

CC-TEST ran 2 cron jobs against PROD's 5 and had no `pg_net`, so `dhruv-anomaly-check` never once invoked its function and `dhruv-weekly-report` / `history-retention-sweep` / `meta-insights-sync` had no job at all; the vault migrations skip silently when the secrets are absent, so replaying migrations does not fix it. Run `supabase db query --linked -f supabase/scripts/test-cron-parity.sql` (confirm `cat supabase/.temp/project-ref` is `yelmuykbqdyeikgbmkoq` first) — it is idempotent and converges on re-run.

It seeds `project_url` itself but deliberately refuses to schedule anything until the `service_role_key` vault secret exists, because a job scheduled against a missing secret fails exactly as invisibly as the GUC-based one it replaces. Seed that once by hand — the key must never reach this repo, a command line, or a transcript, so run it yourself with a leading `!`:

    ! supabase db query --linked "select vault.create_secret('<TEST service_role key>', 'service_role_key', 'CC-TEST service role key for pg_cron')"

then re-run the parity script and confirm with `select jobname, schedule, active from cron.job;`.

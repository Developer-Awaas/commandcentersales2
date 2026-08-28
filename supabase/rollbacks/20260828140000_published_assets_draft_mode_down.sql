-- DOWN for 20260828140000_published_assets_draft_mode.sql. Manual only:
--   supabase db query --linked -f supabase/rollbacks/20260828140000_published_assets_draft_mode_down.sql
--
-- Dropping `published` collapses DRAFT and LIVE into one indistinguishable
-- state (both are dry_run=false). Any draft rows already written become
-- unreadable as drafts — they will look like live posts. Export first if that
-- distinction matters:
--   supabase db query --linked "copy (select * from published_assets) to stdout with csv header"

ALTER TABLE published_assets DROP CONSTRAINT IF EXISTS published_assets_dryrun_not_published_check;
ALTER TABLE published_assets DROP COLUMN IF EXISTS published;

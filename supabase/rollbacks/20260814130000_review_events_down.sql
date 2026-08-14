-- ============================================================
-- DOWN for 20260814130000_review_events.sql
--
-- NOT auto-applied — supabase/rollbacks/ is outside the CLI's migration scan
-- on purpose. Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260814130000_review_events_down.sql
--
-- DESTRUCTIVE: drops every captured review. This data has no other home —
-- ingest-review copies a DIGEST of it onto aanya_training_creatives, not the
-- rows themselves, so the improvement_text and editor_ops are gone for good.
-- Export before running if the training signal matters.
-- ============================================================

DROP INDEX IF EXISTS review_events_org_subject_idx;
DROP TABLE IF EXISTS review_events;

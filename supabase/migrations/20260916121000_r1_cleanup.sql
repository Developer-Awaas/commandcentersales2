-- R1 cleanup + R-02.
--
-- 1. review_events carried two identical INSERT policies after
--    20260909122000: the original "Users can insert reviews for their org"
--    and r1's review_events_insert. The r1 one is kept (its file documents it).
--
-- 2. subject_type / subject_id / ratings are NOT dropped here, though the
--    table holds 0 rows on TEST: src/lib/review-service.ts inserts all three
--    and supabase/functions/ingest-review filters on subject_type/subject_id.
--    Dropping them first would make every review insert fail silently
--    (submitReview swallows the error). Retire the writers first, then drop.
--
-- 3. R-02: the A5 orphan cleanup, so PROD needs no manual step. Only
--    never-published rows with no provenance are deleted. A published orphan
--    is real history — it is left in place, and VALIDATE then fails this
--    migration loudly rather than deleting it.
--
-- Down: supabase/rollbacks/20260916121000_r1_cleanup_down.sql

DROP POLICY IF EXISTS "Users can insert reviews for their org" ON review_events;

DELETE FROM published_assets
 WHERE creative_asset_id IS NULL
   AND tool_output_id IS NULL
   AND published = false;

ALTER TABLE published_assets VALIDATE CONSTRAINT published_assets_has_provenance_check;

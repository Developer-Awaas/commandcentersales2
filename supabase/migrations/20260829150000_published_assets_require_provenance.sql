-- published_assets: a published row must say WHAT it published.
--
-- The table has two provenance columns and, until now, no rule that either be
-- present:
--   creative_asset_id  an ads creative (Strategy / Creatives pages)
--   tool_output_id     an SMM creative — those images live in
--                      brand-assets/smm-creatives/ and deliberately have NO
--                      creative_assets row, since that table is ads-specific
--
-- Both being NULL is a real state today: a caller that passes only image_url
-- publishes successfully and leaves a row nothing can be traced back to. That
-- is how an audit question ("what did we post to the customer's Page, and from
-- which creative?") becomes unanswerable after the fact.
--
-- NOT VALID is deliberate, not laziness. One existing row (a downgrade probe,
-- 2026-08-29) has neither id. Validating retroactively would either fail the
-- migration or force deleting real history to satisfy a new rule — and this
-- repo's standing rule is additive-only, never destructive. NOT VALID enforces
-- the constraint on every INSERT and UPDATE from now on while leaving the past
-- alone, which is the whole point.
--
-- To validate later, once that row is cleaned up:
--   ALTER TABLE published_assets VALIDATE CONSTRAINT published_assets_has_provenance_check;
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'published_assets'::regclass
      AND conname  = 'published_assets_has_provenance_check'
  ) THEN
    ALTER TABLE published_assets
      ADD CONSTRAINT published_assets_has_provenance_check
      CHECK (creative_asset_id IS NOT NULL OR tool_output_id IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

COMMIT;

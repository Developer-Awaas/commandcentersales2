-- ============================================================
-- RB-PUB STEP 2 — the DRAFT tier.
--
-- dry_run proves the payload assembles. It does not prove Meta accepts it,
-- because it never asks. A live post proves Meta accepts it and puts the
-- result in front of the public. Between those two there was nothing, and
-- "nothing" is what forces a screencast to be recorded against a real
-- published post on a real Page.
--
-- Graph already has the missing middle:
--   Facebook   POST /{page}/feed|photos with published=false -> a real
--              post id that is invisible on the Page.
--   Instagram  stop after the media container -> a real creation_id with
--              nothing on the profile (publishing is a SEPARATE second call,
--              so not making it is not a workaround, it is just not finishing).
--
-- Both produce genuine Graph evidence with no public artefact.
--
-- SHAPE: `published boolean`, not a `mode` enum, and not a rename of dry_run.
-- The existing column already answers "did we call Graph at all"; the new one
-- answers "can anyone see it". Three valid states, one impossible:
--
--   dry_run  published   meaning
--   -------  ---------   ------------------------------------------------
--   true     false       assembled and validated, no Graph call at all
--   false    false       DRAFT — real Graph object, invisible
--   false    true        LIVE  — real Graph object, public
--   true     true        impossible; the CHECK below forbids it
--
-- Adding a column beside dry_run rather than replacing it keeps every existing
-- reader (and the index and comments from 20260828130000) working untouched,
-- which is the additive rule this repo holds to.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='published_assets' AND column_name='published') THEN
    ALTER TABLE published_assets ADD COLUMN published boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- A dry run made no Graph call, so it cannot possibly be public. Enforced in
-- the schema rather than trusted from the writer: buildPublishedAssetRow is
-- the only writer today, and this is what keeps that true if it ever isn't.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='published_assets_dryrun_not_published_check') THEN
    ALTER TABLE published_assets
      ADD CONSTRAINT published_assets_dryrun_not_published_check
      CHECK (NOT (dry_run AND published));
  END IF;
END $$;

COMMENT ON COLUMN published_assets.published IS
  'Can anyone see it. false + dry_run=false = DRAFT (a real Graph object — unpublished FB post, or an IG container never published — that is invisible to the public). true = LIVE. Paired with dry_run, which answers the different question of whether Graph was called at all.';
COMMENT ON COLUMN published_assets.meta_post_id IS
  'Graph id of the created object. For a LIVE or DRAFT Facebook post this is the post id; for a DRAFT Instagram row it is the media CONTAINER id (creation_id), which is a real Graph object that was deliberately never published. Distinguish by platform + published, not by parsing the id.';

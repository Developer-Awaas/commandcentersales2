-- ============================================================
-- RB-P2 / P2.13 PART D — review capture.
--
-- Every strategy and creative this product generates is judged by a human
-- before it ships, and until now that judgement was thrown away. The edits a
-- designer makes to get a creative market-ready are precisely the training
-- signal Aanya lacks: not "was this good" but "what was wrong with it and
-- what did a professional change".
--
-- WRITE-ONLY BY DESIGN. Org-scoped INSERT for authenticated users, and NO
-- SELECT policy at all. There is no review-management UI and none is planned
-- — reviews exist to be aggregated server-side (ingest-review, service role,
-- which bypasses RLS) into aanya_training_creatives metadata. Granting SELECT
-- would create a feature nobody asked for and put one reviewer's candid
-- "what did you change" text in front of their colleagues.
--
-- No UPDATE/DELETE policy either: a review is a point-in-time observation. If
-- someone reviews the same subject twice, that is two rows and the later one
-- wins downstream — editing history in place would destroy the record of what
-- was actually thought at the time.
--
-- subject_id is intentionally NOT a foreign key. It points at either a
-- tool_outputs row (strategy) or a creative_assets row (creative), and no
-- single FK can express that. Cascading deletes would also silently erase the
-- training signal when a campaign is distilled and its tool_outputs removed
-- (see distillCampaign) — the review must outlive the artefact it describes.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

CREATE TABLE IF NOT EXISTS review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,

  subject_type text NOT NULL CHECK (subject_type IN ('strategy','creative')),
  -- See above: deliberately unconstrained, points into two different tables.
  subject_id uuid,

  -- Auto-derived context, denormalised on purpose so a review stays readable
  -- after the artefact it describes has been distilled away.
  strategy_type text,
  platform text CHECK (platform IS NULL OR platform IN ('meta','google')),

  -- Per-section 1-5 scores, e.g. {"headline":4,"targeting":5}. jsonb rather
  -- than columns because the sections differ per subject_type and per
  -- generated output — a fixed schema would need a migration per new section.
  ratings jsonb NOT NULL DEFAULT '{}'::jsonb,

  improvement_text text,
  -- "What did you change to make it market-ready?" — free text, creative only.
  edit_summary text,
  -- Layer-op history from the in-app mini-editor when the creative was edited
  -- there. The actual operations a professional performed, which is stronger
  -- signal than any rating.
  editor_ops jsonb,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE review_events ENABLE ROW LEVEL SECURITY;

-- INSERT only. get_current_user_org_id() is the same SECURITY DEFINER helper
-- every other table in this schema scopes on (20260610150000).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'review_events' AND policyname = 'Users can insert reviews for their org'
  ) THEN
    CREATE POLICY "Users can insert reviews for their org"
      ON review_events FOR INSERT
      TO authenticated
      WITH CHECK (org_id = get_current_user_org_id());
  END IF;
END $$;

-- The only read path is ingest-review on the service-role client, which
-- bypasses RLS. This index serves that aggregation, not a UI.
CREATE INDEX IF NOT EXISTS review_events_org_subject_idx
  ON review_events (org_id, subject_type, subject_id, created_at DESC);

COMMENT ON TABLE review_events IS
  'Human review of generated strategies/creatives. INSERT-only for authenticated users; no SELECT policy — aggregated server-side by ingest-review. No management UI by design.';
COMMENT ON COLUMN review_events.subject_id IS
  'tool_outputs.id (strategy) or creative_assets.id (creative). Deliberately not an FK: two possible targets, and the review must outlive distillCampaign deleting the artefact.';

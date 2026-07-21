-- ============================================================
-- Canva versioned edit-tracking.
--
-- The existing Canva edit-in-place flow (canva-sync-design/index.ts)
-- overwrites the original creative's image in Storage on export-back
-- (upsert: true onto the same storage_path) — the pre-edit state is
-- destroyed with no trace, not even in the DB (edited_image_url exists
-- on creative_assets but was never actually written). Fixed properly
-- here as permanent product code, not a review-build-only hack:
-- additive migration + down-migration, org-scoped RLS matching the
-- rest of the schema.
--
-- creative_asset_versions: immutable snapshots. A row here is never
-- updated after insert — canva-open-editor records the CURRENT
-- image_url/storage_path as "version_before" (no byte copy needed,
-- since nothing overwrites that path anymore once this ships), and
-- canva-sync-design uploads the Canva export to a brand-new
-- version-suffixed path and records it as "version_after".
--
-- canva_edit_sessions: one row per open-editor → export round trip.
-- canva-sync-design closes the most recent 'opened' session for a
-- given creative_id (no client changes needed — the existing client
-- call shape is unchanged).
-- ============================================================

CREATE TABLE IF NOT EXISTS creative_asset_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id  uuid NOT NULL REFERENCES creative_assets(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  image_url    text NOT NULL,
  storage_path text NOT NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creative_asset_versions_creative_id
  ON creative_asset_versions (creative_id, created_at DESC);

ALTER TABLE creative_asset_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "creative_asset_versions_select"
    ON creative_asset_versions FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- No INSERT/UPDATE/DELETE policies — writes are service-role only
-- (canva-open-editor / canva-sync-design), matching agent_turns'
-- pattern (migration 20260617120000).


CREATE TABLE IF NOT EXISTS canva_edit_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id        uuid NOT NULL REFERENCES creative_assets(id) ON DELETE CASCADE,
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  correlation_id     uuid NOT NULL DEFAULT gen_random_uuid(),
  version_before_id  uuid REFERENCES creative_asset_versions(id) ON DELETE SET NULL,
  version_after_id   uuid REFERENCES creative_asset_versions(id) ON DELETE SET NULL,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  exported_at        timestamptz,
  edit_summary       jsonb,
  status             text NOT NULL DEFAULT 'opened'
                       CHECK (status IN ('opened', 'exported', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_canva_edit_sessions_creative_status
  ON canva_edit_sessions (creative_id, status, opened_at DESC);

ALTER TABLE canva_edit_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "canva_edit_sessions_select"
    ON canva_edit_sessions FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Writes are service-role only, same rationale as above.

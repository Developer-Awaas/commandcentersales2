-- ============================================================
-- Canva versioned edit-tracking (schema only, this pass).
--
-- The current Canva edit-in-place flow (canva-sync-design/index.ts)
-- overwrites the original creative's image in Storage on export-back
-- (upsert: true onto the same storage_path) — the pre-edit state is
-- destroyed with no trace, not even in the DB. This migration adds the
-- tables that fix will be built against — additive only, org-scoped RLS
-- matching the rest of the schema. canva-sync-design itself is NOT
-- rewritten in this pass (see file:line noted in the P0 digest for P3
-- handoff) — these tables are unused by any shipped code until then.
--
-- creative_asset_versions: immutable snapshots. A row here is never
-- updated after insert — canva-open-editor would record the CURRENT
-- image_url/storage_path as "version_before", and canva-sync-design
-- would upload the Canva export to a brand-new version-suffixed path
-- and record it as "version_after".
--
-- canva_edit_sessions: one row per open-editor -> export round trip.
-- canva-sync-design would close the most recent 'opened' session for a
-- given creative_id.
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

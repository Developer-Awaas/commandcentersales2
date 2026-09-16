-- DOWN for 20260916121000_r1_cleanup.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- The deleted orphan published_assets rows are not recoverable. The
-- provenance CHECK is re-added NOT VALID, its pre-cleanup state.
BEGIN;

CREATE POLICY "Users can insert reviews for their org" ON review_events
  FOR INSERT TO authenticated
  WITH CHECK (org_id = get_current_user_org_id());

ALTER TABLE published_assets DROP CONSTRAINT IF EXISTS published_assets_has_provenance_check;
ALTER TABLE published_assets ADD CONSTRAINT published_assets_has_provenance_check
  CHECK (creative_asset_id IS NOT NULL OR tool_output_id IS NOT NULL) NOT VALID;

COMMIT;

-- ============================================================
-- Fix RLS on aanya_training_creatives
-- Table was created via Supabase API — policies may be missing
-- or use a different pattern from the rest of the codebase.
-- This migration drops any existing policies and re-creates
-- them using the standard get_current_user_org_id() pattern.
-- ============================================================

-- Enable RLS (idempotent — safe if already enabled)
ALTER TABLE aanya_training_creatives ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies so we start clean
DROP POLICY IF EXISTS "Enable read access for all users"            ON aanya_training_creatives;
DROP POLICY IF EXISTS "Enable insert for authenticated users only"  ON aanya_training_creatives;
DROP POLICY IF EXISTS "Enable update for users based on user_id"    ON aanya_training_creatives;
DROP POLICY IF EXISTS "Enable delete for users based on user_id"    ON aanya_training_creatives;
DROP POLICY IF EXISTS "aanya_training_creatives_select"             ON aanya_training_creatives;
DROP POLICY IF EXISTS "aanya_training_creatives_insert"             ON aanya_training_creatives;
DROP POLICY IF EXISTS "aanya_training_creatives_update"             ON aanya_training_creatives;
DROP POLICY IF EXISTS "aanya_training_creatives_delete"             ON aanya_training_creatives;

-- Standard org-scoped policies matching every other table in this schema
CREATE POLICY "aanya_training_creatives_select"
  ON aanya_training_creatives FOR SELECT TO authenticated
  USING (org_id = get_current_user_org_id());

CREATE POLICY "aanya_training_creatives_insert"
  ON aanya_training_creatives FOR INSERT TO authenticated
  WITH CHECK (org_id = get_current_user_org_id());

CREATE POLICY "aanya_training_creatives_update"
  ON aanya_training_creatives FOR UPDATE TO authenticated
  USING  (org_id = get_current_user_org_id())
  WITH CHECK (org_id = get_current_user_org_id());

CREATE POLICY "aanya_training_creatives_delete"
  ON aanya_training_creatives FOR DELETE TO authenticated
  USING (org_id = get_current_user_org_id());

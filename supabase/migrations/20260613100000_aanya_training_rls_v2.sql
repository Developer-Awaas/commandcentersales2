-- ============================================================
-- Self-contained RLS fix for aanya_training_creatives.
--
-- Does NOT rely on get_current_user_org_id() existing — uses
-- an inline subquery instead, so this runs cleanly even if
-- the earlier RLS migration was never applied to this project.
-- ============================================================

-- Re-create the helper function (CREATE OR REPLACE is idempotent)
CREATE OR REPLACE FUNCTION get_current_user_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Enable RLS
ALTER TABLE aanya_training_creatives ENABLE ROW LEVEL SECURITY;

-- Drop ALL policies on this table unconditionally
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE tablename = 'aanya_training_creatives'
      AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON aanya_training_creatives', pol.policyname);
  END LOOP;
END;
$$;

-- Recreate with inline subquery — no dependency on external function
CREATE POLICY "atc_select"
  ON aanya_training_creatives FOR SELECT TO authenticated
  USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1)
  );

CREATE POLICY "atc_insert"
  ON aanya_training_creatives FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1)
  );

CREATE POLICY "atc_update"
  ON aanya_training_creatives FOR UPDATE TO authenticated
  USING  (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1))
  WITH CHECK (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY "atc_delete"
  ON aanya_training_creatives FOR DELETE TO authenticated
  USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1)
  );

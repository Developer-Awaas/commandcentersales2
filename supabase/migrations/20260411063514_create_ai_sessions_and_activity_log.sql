/*
  # Create AI Sessions and Activity Log Tables

  ## New Tables

  ### ai_sessions
  - Tracks every AI call made in the app (strategy, ad config, creatives, review, analysis, organic)
  - Stores the full input/output for learning and auditing
  - Fields: org_id, user_id, session_type, project_ids, input_summary, input_data, output_data, health_score, tokens_used

  ### activity_log
  - Tracks all significant user actions (create/edit/delete project, generate strategy, save metrics, etc.)
  - Lightweight event log for understanding usage patterns
  - Fields: org_id, user_id, action, entity_type, entity_id, details

  ## Security
  - RLS enabled on both tables
  - Authenticated users can insert and select their own org's data
*/

-- ai_sessions table already created in earlier migration, skip if exists
-- Only add missing columns if needed
ALTER TABLE IF EXISTS ai_sessions
ADD COLUMN IF NOT EXISTS session_type text,
ADD COLUMN IF NOT EXISTS project_ids uuid[],
ADD COLUMN IF NOT EXISTS input_data jsonb,
ADD COLUMN IF NOT EXISTS output_data jsonb,
ADD COLUMN IF NOT EXISTS health_score numeric(4,1),
ADD COLUMN IF NOT EXISTS tokens_used integer;

-- Use 'type' column that already exists
CREATE INDEX IF NOT EXISTS ai_sessions_org_id_idx ON ai_sessions (org_id);
CREATE INDEX IF NOT EXISTS ai_sessions_created_at_idx ON ai_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_sessions_type_idx ON ai_sessions (type);

ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_sessions' AND policyname = 'Org members can read own ai sessions'
  ) THEN
    CREATE POLICY "Org members can read own ai sessions"
      ON ai_sessions FOR SELECT
      TO authenticated
      USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_sessions' AND policyname = 'Org members can insert ai sessions'
  ) THEN
    CREATE POLICY "Org members can insert ai sessions"
      ON ai_sessions FOR INSERT
      TO authenticated
      WITH CHECK (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id text NOT NULL DEFAULT 'dev-user-001',
  action text NOT NULL,
  entity_type text DEFAULT NULL,
  entity_id text DEFAULT NULL,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_org_id_idx ON activity_log (org_id);
CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_action_idx ON activity_log (action);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'activity_log' AND policyname = 'Org members can read own activity'
  ) THEN
    CREATE POLICY "Org members can read own activity"
      ON activity_log FOR SELECT
      TO authenticated
      USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'activity_log' AND policyname = 'Org members can insert activity'
  ) THEN
    CREATE POLICY "Org members can insert activity"
      ON activity_log FOR INSERT
      TO authenticated
      WITH CHECK (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));
  END IF;
END $$;

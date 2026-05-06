/*
  # Fix RLS policies for unauthenticated dev access

  ## Problem
  The app uses the anon key without Supabase Auth, so auth.uid() is always null.
  The *_org_isolation policies call get_user_org_id() which returns null for
  unauthenticated requests, blocking all rows.

  ## Changes
  - Drop the restrictive *_org_isolation policies on all tables
  - Drop conflicting duplicate policies on ai_sessions and activity_log
  - Ensure the existing permissive SELECT policies (qual = true) remain and work
  - Add anon role to all permissive policies so unauthenticated clients can read/write
*/

-- Drop all org_isolation restrictive policies
DROP POLICY IF EXISTS "projects_org_isolation" ON projects;
DROP POLICY IF EXISTS "campaigns_org_isolation" ON campaigns;
DROP POLICY IF EXISTS "daily_metrics_org_isolation" ON daily_metrics;
DROP POLICY IF EXISTS "notifications_user_isolation" ON notifications;
DROP POLICY IF EXISTS "ai_sessions_org_isolation" ON ai_sessions;
DROP POLICY IF EXISTS "activity_log_org_isolation" ON activity_log;

-- Drop auth.uid()-based policies on ai_sessions (conflict with anon access)
DROP POLICY IF EXISTS "Users can insert own ai_sessions" ON ai_sessions;
DROP POLICY IF EXISTS "Users can update own ai_sessions" ON ai_sessions;
DROP POLICY IF EXISTS "Users can view own ai_sessions" ON ai_sessions;
DROP POLICY IF EXISTS "Org members can insert ai sessions" ON ai_sessions;
DROP POLICY IF EXISTS "Org members can read own ai sessions" ON ai_sessions;

-- Drop auth.uid()-based policies on activity_log
DROP POLICY IF EXISTS "Org members can insert activity" ON activity_log;
DROP POLICY IF EXISTS "Org members can read own activity" ON activity_log;

-- Drop auth.uid()-based policies on notifications
DROP POLICY IF EXISTS "Users can insert own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;

-- Recreate permissive policies that allow anon access for all tables

-- projects
DROP POLICY IF EXISTS "Authenticated users can view projects" ON projects;
DROP POLICY IF EXISTS "Authenticated users can insert projects" ON projects;
DROP POLICY IF EXISTS "Authenticated users can update projects" ON projects;

CREATE POLICY "Allow anon select projects"
  ON projects FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow anon insert projects"
  ON projects FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow anon update projects"
  ON projects FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon delete projects"
  ON projects FOR DELETE
  TO anon, authenticated
  USING (true);

-- campaigns
DROP POLICY IF EXISTS "Authenticated users can view campaigns" ON campaigns;
DROP POLICY IF EXISTS "Authenticated users can insert campaigns" ON campaigns;
DROP POLICY IF EXISTS "Authenticated users can update campaigns" ON campaigns;

CREATE POLICY "Allow anon select campaigns"
  ON campaigns FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow anon insert campaigns"
  ON campaigns FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow anon update campaigns"
  ON campaigns FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- daily_metrics
DROP POLICY IF EXISTS "Authenticated users can view daily_metrics" ON daily_metrics;
DROP POLICY IF EXISTS "Authenticated users can insert daily_metrics" ON daily_metrics;
DROP POLICY IF EXISTS "Authenticated users can update daily_metrics" ON daily_metrics;

CREATE POLICY "Allow anon select daily_metrics"
  ON daily_metrics FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow anon insert daily_metrics"
  ON daily_metrics FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow anon update daily_metrics"
  ON daily_metrics FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- notifications
CREATE POLICY "Allow anon select notifications"
  ON notifications FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow anon insert notifications"
  ON notifications FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow anon update notifications"
  ON notifications FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ai_sessions
CREATE POLICY "Allow anon select ai_sessions"
  ON ai_sessions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow anon insert ai_sessions"
  ON ai_sessions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- activity_log
CREATE POLICY "Allow anon select activity_log"
  ON activity_log FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow anon insert activity_log"
  ON activity_log FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

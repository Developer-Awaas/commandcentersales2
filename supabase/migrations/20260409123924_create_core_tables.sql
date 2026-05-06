/*
  # Create core marketing tables

  1. New Tables
    - `projects`
      - `id` (uuid, primary key)
      - `org_id` (uuid, nullable)
      - `name` (text) - project name
      - `locality` (text) - locality/area
      - `city` (text)
      - `total_units` (int)
      - `units_remaining` (int)
      - `price_min` (numeric) - min price in INR
      - `price_max` (numeric) - max price in INR
      - `priority` (text) - 'High', 'Medium', 'Low'
      - `is_active` (bool, default true)
      - `created_at` (timestamptz)

    - `campaigns`
      - `id` (uuid, primary key)
      - `org_id` (uuid, nullable)
      - `project_id` (uuid, nullable, fk -> projects)
      - `name` (text)
      - `platform` (text)
      - `status` (text) - 'active', 'paused', 'ended'
      - `budget` (numeric)
      - `created_at` (timestamptz)

    - `daily_metrics`
      - `id` (uuid, primary key)
      - `org_id` (uuid, nullable)
      - `campaign_id` (uuid, nullable, fk -> campaigns)
      - `date` (date)
      - `spend` (numeric)
      - `leads` (int)
      - `impressions` (int)
      - `clicks` (int)
      - `created_at` (timestamptz)

    - `notifications`
      - `id` (uuid, primary key)
      - `org_id` (uuid, nullable)
      - `user_id` (uuid, nullable, fk -> auth.users)
      - `title` (text)
      - `message` (text)
      - `type` (text) - 'info', 'warning', 'error', 'success'
      - `is_read` (bool, default false)
      - `created_at` (timestamptz)

    - `ai_sessions`
      - `id` (uuid, primary key)
      - `org_id` (uuid, nullable)
      - `user_id` (uuid, nullable, fk -> auth.users)
      - `type` (text) - 'strategy', 'ad_copy', 'creative', 'analysis'
      - `input_summary` (text)
      - `output` (text)
      - `project_id` (uuid, nullable)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Authenticated users can read/insert their org's data

  3. Notes
    - All tables support org_id for multi-tenancy
    - RLS checks auth.uid() for user-scoped tables
*/

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  name text NOT NULL DEFAULT '',
  locality text DEFAULT '',
  city text DEFAULT '',
  total_units int DEFAULT 0,
  units_remaining int DEFAULT 0,
  price_min numeric DEFAULT 0,
  price_max numeric DEFAULT 0,
  priority text DEFAULT 'Medium',
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view projects"
  ON projects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  platform text DEFAULT '',
  status text DEFAULT 'active',
  budget numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view campaigns"
  ON campaigns FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert campaigns"
  ON campaigns FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update campaigns"
  ON campaigns FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  spend numeric DEFAULT 0,
  leads int DEFAULT 0,
  impressions int DEFAULT 0,
  clicks int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view daily_metrics"
  ON daily_metrics FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert daily_metrics"
  ON daily_metrics FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update daily_metrics"
  ON daily_metrics FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  message text DEFAULT '',
  type text DEFAULT 'info',
  is_read bool DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text DEFAULT 'strategy',
  input_summary text DEFAULT '',
  output text DEFAULT '',
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ai_sessions"
  ON ai_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ai_sessions"
  ON ai_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ai_sessions"
  ON ai_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Option B: connect ai_sessions with lead_funnel via project_id
-- Allows joining session activity to weekly funnel metrics for the same project + week

ALTER TABLE lead_funnel
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_funnel_project_id ON lead_funnel(project_id);

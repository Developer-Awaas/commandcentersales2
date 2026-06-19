-- agent_interactions: per-request cost/usage log for the LeadGen V2 "Aarav"
-- orchestrator. One row per aarav-orchestrate invocation (and, later, one
-- per specialist delegation it fans out to). Separate from ai_sessions
-- because ai_sessions.session_type has a narrow CHECK constraint tied to
-- the legacy Strategy/Creatives flows — this avoids re-touching that
-- constraint for an unrelated feature.

CREATE TABLE IF NOT EXISTS agent_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent text NOT NULL CHECK (agent IN ('aarav', 'arjun', 'aanya', 'diya')),
  trace_id text,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_interactions_org_id ON agent_interactions(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_created_at ON agent_interactions(created_at);

ALTER TABLE agent_interactions ENABLE ROW LEVEL SECURITY;

-- Rows are written by aarav-orchestrate using the service role key (bypasses
-- RLS). This SELECT policy only governs client-side reads (e.g. a future
-- cost-reporting view), scoped the same way every other table in this
-- schema is scoped.
DROP POLICY IF EXISTS "Org members can view their agent interactions" ON agent_interactions;
CREATE POLICY "Org members can view their agent interactions"
  ON agent_interactions FOR SELECT
  TO authenticated
  USING (org_id = get_current_user_org_id());

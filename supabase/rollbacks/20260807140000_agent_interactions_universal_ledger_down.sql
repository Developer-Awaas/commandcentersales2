-- DOWN for 20260807140000_agent_interactions_universal_ledger.sql
-- Manual-apply only (supabase CLI never scans rollbacks/). Reverts the
-- universal-ledger extension back to the agent-only shape.

DROP FUNCTION IF EXISTS check_daily_feature_cap(text, integer);

DROP POLICY IF EXISTS "Org members insert their own agent interactions" ON agent_interactions;

DROP INDEX IF EXISTS idx_agent_interactions_org_created_feature;

DO $$ BEGIN
  ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_provider_check;
  ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_call_type_check;
  ALTER TABLE agent_interactions DROP COLUMN IF EXISTS provider;
  ALTER TABLE agent_interactions DROP COLUMN IF EXISTS call_type;
  ALTER TABLE agent_interactions DROP COLUMN IF EXISTS feature;
  ALTER TABLE agent_interactions DROP COLUMN IF EXISTS project_id;
  ALTER TABLE agent_interactions DROP COLUMN IF EXISTS image_count;
  ALTER TABLE agent_interactions DROP COLUMN IF EXISTS unit_cost_usd;
END $$;

-- Restore NOT NULL + the agent-only CHECK. (Assumes no NULL-agent rows remain;
-- delete them first if the universal ledger was ever written to.)
DO $$ BEGIN
  ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_agent_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_agent_check
    CHECK (agent IN ('aarav', 'arjun', 'aanya', 'diya', 'kavya', 'dhruv'));
  ALTER TABLE agent_interactions ALTER COLUMN agent SET NOT NULL;
  -- Restore cost_usd NOT NULL (backfill any NULLs to 0 first).
  UPDATE agent_interactions SET cost_usd = 0 WHERE cost_usd IS NULL;
  ALTER TABLE agent_interactions ALTER COLUMN cost_usd SET NOT NULL;
END $$;

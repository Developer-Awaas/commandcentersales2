-- Add 'kavya' to the agent_interactions.agent CHECK constraint so Kavya's
-- cost rows can be inserted by aarav-orchestrate. Wrapped in DO $$ ... END $$
-- per migration convention; exception handler absorbs a missing constraint
-- name (rename-safe) but lets other errors propagate normally.

DO $$ BEGIN
  ALTER TABLE agent_interactions
    DROP CONSTRAINT IF EXISTS agent_interactions_agent_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_agent_check
    CHECK (agent IN ('aarav', 'arjun', 'aanya', 'diya', 'kavya'));
END $$;

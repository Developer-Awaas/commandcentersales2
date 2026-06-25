DO $$ BEGIN
  ALTER TABLE agent_interactions
    DROP CONSTRAINT IF EXISTS agent_interactions_agent_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_agent_check
    CHECK (agent IN ('aarav', 'arjun', 'aanya', 'diya', 'kavya', 'dhruv'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

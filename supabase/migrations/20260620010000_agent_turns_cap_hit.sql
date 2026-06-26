-- Add cap_hit flag to agent_turns so the dashboard and Langfuse can filter
-- turns where the per-interaction budget ceiling was reached mid-generation.
-- Written by aarav-orchestrate's finaliseTurn when runAanya returns capHit=true.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_turns' AND column_name = 'cap_hit'
  ) THEN
    ALTER TABLE agent_turns ADD COLUMN cap_hit boolean NOT NULL DEFAULT false;
  END IF;
END $$;

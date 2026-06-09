-- Adds a JSONB array column to track Aanya revision history per creative.
-- Each entry: { iteration: number, brief: SeniorDesignerResult, issues_addressed: string[], fixes_applied: string[], created_at: timestamp }
-- The original senior_designer_brief column stays immutable; revisions append here.

-- Only add if table exists (skipped if creatives table never created)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'creatives') THEN
    ALTER TABLE creatives
      ADD COLUMN IF NOT EXISTS revised_briefs jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

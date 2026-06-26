-- Add prompt_fragments jsonb to project_design_systems.
-- Stores section-level GPT-Image-1 prompt injection text produced by DNA synthesis.
-- Phase 6 of Aanya Trainer feedback loop.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_design_systems' AND column_name = 'prompt_fragments'
  ) THEN
    ALTER TABLE project_design_systems ADD COLUMN prompt_fragments jsonb;
  END IF;
END $$;

-- Add is_live flag to aanya_training_creatives.
-- is_live = true: auto-promoted by Arjun from live campaign performance — kept after synthesis, capped at 10 per project.
-- is_live = false (default): manually uploaded training data — deleted after synthesis as before.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aanya_training_creatives' AND column_name = 'is_live'
  ) THEN
    ALTER TABLE aanya_training_creatives ADD COLUMN is_live boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aanya_training_is_live
  ON aanya_training_creatives (org_id, is_live)
  WHERE is_live = true;

-- Add session_id to group the 3 images from one generation run
-- Allows edits to overwrite the same files, saving storage
ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS session_id uuid;
CREATE INDEX IF NOT EXISTS creative_assets_session_id_idx ON creative_assets (session_id);

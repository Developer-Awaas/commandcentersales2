-- ============================================================
-- RB-P2 Step 1 — persist the text-overlay re-composite inputs so "Edit Text"
-- survives a reload and works from any viewer (not just the in-session Strategy
-- flow whose inputs lived only in memory).
--
--   clean_template_url : the pre-text image (model's clean template). Editing
--                        text_layers re-composites over THIS, never over the
--                        already-composited final (which would double the text).
--   overlay_zones      : the vision-located zones (for clean-plate ghost erase).
--
-- text_layers already exists (jsonb). Both additive + nullable — a creative
-- without them simply isn't overlay-editable. DOWN in supabase/rollbacks/.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='creative_assets' AND column_name='clean_template_url') THEN
    ALTER TABLE creative_assets ADD COLUMN clean_template_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='creative_assets' AND column_name='overlay_zones') THEN
    ALTER TABLE creative_assets ADD COLUMN overlay_zones jsonb;
  END IF;
END $$;

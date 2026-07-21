-- ============================================================
-- Text-overlay layer system for generated creatives.
--
-- Ad copy (headline/price/CTA) moves from being baked into the
-- AI-generated image by the image model, to an app-controlled,
-- editable overlay stored per creative_assets row. See
-- src/lib/text-layers.ts for the TextLayer shape and compositor.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creative_assets' AND column_name = 'text_layers'
  ) THEN
    ALTER TABLE creative_assets ADD COLUMN text_layers jsonb DEFAULT NULL;
  END IF;
END $$;

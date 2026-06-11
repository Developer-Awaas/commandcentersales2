-- Adds columns that the codebase inserts/updates but were absent from the
-- original creatives table definition.
-- Strategy.tsx:  cta, senior_designer_brief, reference_image_manifest, languages
-- creative-dna.ts + AdReview.tsx: design_dna, review_data, follow_up_prompt, created_by

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'creatives') THEN

    -- Ad copy CTA label (Strategy.tsx save payload)
    ALTER TABLE creatives ADD COLUMN IF NOT EXISTS cta text DEFAULT '';

    -- Full Aanya senior-designer JSON result stored for future re-use / revision
    ALTER TABLE creatives ADD COLUMN IF NOT EXISTS senior_designer_brief jsonb DEFAULT '{}'::jsonb;

    -- Array of { role, instruction } reference image manifest from Aanya
    ALTER TABLE creatives ADD COLUMN IF NOT EXISTS reference_image_manifest jsonb DEFAULT '[]'::jsonb;

    -- Languages array e.g. ['English', 'Hindi'] (Strategy.tsx save payload)
    ALTER TABLE creatives ADD COLUMN IF NOT EXISTS languages text[] DEFAULT '{}';

    -- Structured design DNA object (distinct from design_dna_tags which is flat)
    ALTER TABLE creatives ADD COLUMN IF NOT EXISTS design_dna jsonb DEFAULT '{}'::jsonb;

    -- Full review/DNA analysis blob from creative-dna.ts
    ALTER TABLE creatives ADD COLUMN IF NOT EXISTS review_data jsonb DEFAULT '{}'::jsonb;

    -- Follow-up prompt text for iterative Aanya revisions
    ALTER TABLE creatives ADD COLUMN IF NOT EXISTS follow_up_prompt text DEFAULT '';

    -- User who created this record (Supabase auth user id)
    ALTER TABLE creatives ADD COLUMN IF NOT EXISTS created_by uuid;

  END IF;
END $$;

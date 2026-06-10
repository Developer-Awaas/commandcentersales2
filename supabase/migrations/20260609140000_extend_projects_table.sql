/*
  # Extend projects table with missing columns

  The original migration only captured base fields (name, locality, city,
  price_min/max, total_units, units_remaining, priority, is_active).
  The ProjectForm and Project type expect many more columns that were added
  directly in Supabase by Bolt without a tracked migration.

  All columns use ADD COLUMN IF NOT EXISTS — safe to run against the live DB.
*/

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS code               text DEFAULT '',
  ADD COLUMN IF NOT EXISTS nearest_landmarks  text DEFAULT '',
  ADD COLUMN IF NOT EXISTS status             text DEFAULT 'Upcoming',
  ADD COLUMN IF NOT EXISTS completion_pct     numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expected_possession text DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_types         text DEFAULT '',
  ADD COLUMN IF NOT EXISTS carpet_area_range  text DEFAULT '',
  ADD COLUMN IF NOT EXISTS price_range_lacs   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS per_sqft_rate      numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS usps               text DEFAULT '',
  ADD COLUMN IF NOT EXISTS amenities          text DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_buyer       text DEFAULT 'End-user',
  ADD COLUMN IF NOT EXISTS budget_segment     text DEFAULT '',
  ADD COLUMN IF NOT EXISTS rera_number        text DEFAULT '',
  ADD COLUMN IF NOT EXISTS landing_page_url   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS brochure_url       text DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp_flow      text DEFAULT '',
  ADD COLUMN IF NOT EXISTS notes              text DEFAULT '',
  ADD COLUMN IF NOT EXISTS configurations     jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS price_history      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz DEFAULT now();

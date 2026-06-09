/*
  # Create organizations table

  This table was referenced by the app and RLS migrations but never created
  in tracked migrations (it may have existed from an untracked Bolt session).
  This migration adds it idempotently.
*/

CREATE TABLE IF NOT EXISTS organizations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL DEFAULT '',
  slug           text UNIQUE,
  brand_colors   text DEFAULT '#1B4332, #2DD4A8, #FFFFFF',
  tone_of_voice  text DEFAULT 'Professional & Premium',
  whatsapp_number text DEFAULT '',
  primary_city   text DEFAULT 'Bhubaneswar',
  secondary_city text DEFAULT 'Cuttack',
  fb_page_url    text DEFAULT '',
  ig_page_url    text DEFAULT '',
  default_age_range text DEFAULT '28-50',
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Allow anon select organizations" ON organizations;
  DROP POLICY IF EXISTS "Allow anon insert organizations" ON organizations;
  DROP POLICY IF EXISTS "Allow anon update organizations" ON organizations;
  CREATE POLICY "Allow anon select organizations" ON organizations FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert organizations" ON organizations FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update organizations" ON organizations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

/*
  # Create targeting_keywords table

  ## Summary
  Stores verified and non-available targeting keywords per platform so the AI
  can prioritise known-good keywords and avoid ones that aren't available.

  ## New Tables
  - `targeting_keywords`
    - `id` (uuid, primary key)
    - `org_id` (uuid) — organisation that verified this keyword
    - `keyword` (text) — the targeting keyword
    - `category` (text) — 'interest', 'demographic', or 'behavior'
    - `platform` (text) — e.g. 'AiSensy', 'Meta Ads Manager'
    - `status` (text) — 'available', 'not_found', 'partial'
    - `times_suggested` (int) — how many times AI suggested this keyword
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)
    - UNIQUE constraint on (keyword, category, platform)

  ## Security
  - RLS enabled
  - Anon and authenticated users can read/write (matching existing app pattern)
*/

CREATE TABLE IF NOT EXISTS targeting_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  keyword text NOT NULL,
  category text NOT NULL DEFAULT 'interest',
  platform text NOT NULL DEFAULT 'AiSensy',
  status text NOT NULL DEFAULT 'available',
  times_suggested integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (keyword, category, platform)
);

ALTER TABLE targeting_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon select targeting_keywords"
  ON targeting_keywords FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow anon insert targeting_keywords"
  ON targeting_keywords FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow anon update targeting_keywords"
  ON targeting_keywords FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_targeting_keywords_platform_status ON targeting_keywords (platform, status);
CREATE INDEX IF NOT EXISTS idx_targeting_keywords_org ON targeting_keywords (org_id);

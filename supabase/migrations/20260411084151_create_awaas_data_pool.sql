/*
  # Create awaas_data_pool table

  ## Summary
  Creates the AWAAS (anonymized data sharing) pool table for cross-builder benchmarking.

  ## New Tables
  - `awaas_data_pool`
    - `id` (uuid, primary key)
    - `org_id` (uuid, references organizations)
    - `data_type` (text) — e.g. 'campaign_performance'
    - `anonymized_data` (jsonb) — anonymized metrics without identifiable info
    - `city` (text) — city only, no specific locality
    - `price_segment` (text) — e.g. 'Under 40L', '40L-1Cr', '1Cr+'
    - `unit_type` (text) — e.g. '2BHK', '3BHK'
    - `project_status` (text)
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - Authenticated users can insert their org's data
  - Authenticated users can read all data (anonymized, cross-org benchmarking)
*/

CREATE TABLE IF NOT EXISTS awaas_data_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  data_type text NOT NULL DEFAULT 'campaign_performance',
  anonymized_data jsonb NOT NULL DEFAULT '{}',
  city text,
  price_segment text,
  unit_type text,
  project_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE awaas_data_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own org awaas data"
  ON awaas_data_pool FOR INSERT
  TO authenticated
  WITH CHECK (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY "Authenticated users can read awaas pool"
  ON awaas_data_pool FOR SELECT
  TO authenticated
  USING (true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'awaas_data_pool' AND indexname = 'awaas_data_pool_org_id_idx') THEN
    CREATE INDEX awaas_data_pool_org_id_idx ON awaas_data_pool (org_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'awaas_data_pool' AND indexname = 'awaas_data_pool_created_at_idx') THEN
    CREATE INDEX awaas_data_pool_created_at_idx ON awaas_data_pool (created_at DESC);
  END IF;
END $$;

/*
  # Add configurations and price_history to projects

  1. Changes
    - `configurations` (JSONB, default []) — array of per-config objects:
      {type, carpet, price_lacs, total_units, remaining_units, available, notes}
    - `price_history` (JSONB, default []) — array of price change records:
      {date, type, old_price, new_price, source}

  2. Notes
    - Both columns use IF NOT EXISTS to be safe on re-run
    - No data loss — existing rows get empty arrays as defaults
*/

ALTER TABLE projects ADD COLUMN IF NOT EXISTS configurations JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS price_history JSONB DEFAULT '[]';

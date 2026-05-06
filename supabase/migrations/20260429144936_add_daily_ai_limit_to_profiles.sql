/*
  # Add daily_ai_limit to profiles

  Adds a `daily_ai_limit` integer column to the profiles table.
  Defaults to 30 for regular users. Admin can set higher limits per user.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'daily_ai_limit'
  ) THEN
    ALTER TABLE profiles ADD COLUMN daily_ai_limit integer NOT NULL DEFAULT 30;
  END IF;
END $$;

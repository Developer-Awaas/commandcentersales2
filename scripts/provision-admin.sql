-- =============================================================
-- Admin User Provisioning Script
-- Run this in: Supabase Dashboard → SQL Editor
--
-- BEFORE running this script, you MUST create the auth user:
--   Supabase Dashboard → Authentication → Users → "Add user"
--   Email:    rdev332@gmail.com
--   Password: (set a strong password — note it for testing)
--   Check "Auto Confirm User" so no email link is needed
--   Click "Create user" then come back here and run this script.
-- =============================================================

-- Step 0: ensure organizations table exists (may be missing from DB)
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
  -- idempotent RLS policies
  DROP POLICY IF EXISTS "Allow anon select organizations" ON organizations;
  DROP POLICY IF EXISTS "Allow anon insert organizations" ON organizations;
  DROP POLICY IF EXISTS "Allow anon update organizations" ON organizations;
  CREATE POLICY "Allow anon select organizations" ON organizations FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert organizations" ON organizations FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update organizations" ON organizations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- Step 1-3: create org + provision admin profile
DO $$
DECLARE
  v_org_id   uuid;
  v_user_id  uuid;
BEGIN

  -- 1. Create org if it doesn't already exist
  INSERT INTO organizations (id, name, slug)
  VALUES (gen_random_uuid(), 'Neelachala Homes', 'neelachala-homes')
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO v_org_id FROM organizations WHERE slug = 'neelachala-homes';

  -- 2. Look up the auth user by email
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'rdev332@gmail.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'User rdev332@gmail.com not found in auth.users. '
      'Create the user in Supabase Dashboard → Authentication → Users first.';
  END IF;

  -- 3. Upsert profile with admin role and full module access
  INSERT INTO profiles (id, email, full_name, org_id, role, module_access)
  VALUES (
    v_user_id,
    'rdev332@gmail.com',
    'Rahul Dev',
    v_org_id,
    'admin',
    ARRAY[
      'dashboard','projects','projects_edit',
      'ai_sessions','strategy_quick','strategy_full',
      'campaign_wizard','ad_config','creatives','ad_review',
      'analyzer','campaigns','organic',
      'smm_planner','smm_calendar','smm_creatives','smm_analyzer',
      'content_library','brand_kit',
      'notifications','settings','user_management',
      'reports','data_export','api_config'
    ]
  )
  ON CONFLICT (id) DO UPDATE SET
    org_id        = EXCLUDED.org_id,
    full_name     = EXCLUDED.full_name,
    role          = EXCLUDED.role,
    module_access = EXCLUDED.module_access;

  RAISE NOTICE 'Done. org_id=%, user_id=%', v_org_id, v_user_id;
END;
$$;

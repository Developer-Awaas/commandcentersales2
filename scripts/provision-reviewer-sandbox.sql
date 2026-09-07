-- Give the Meta reviewer an EMPTY org, so the app-review journey starts at
-- "create your first project" instead of on top of seeded demo data.
-- TEST-only (AwaasSuite_CC_Test). RB-RS, 2026-09-03.
--
-- WHY A NEW ORG AND NOT "HIDE THE DEMO PROJECT":
-- there is no per-user project scoping anywhere in this schema. profiles
-- carries module_access (which MODULES you see), never a project list, and
-- projects are scoped by org_id alone. Deactivating "Ananta Enclave" would
-- therefore blank the app for every account in the demo org — including
-- meta-review@awaas.world, whose recorded R-A beats read that project. A
-- second org is the only way one credential starts empty while the other
-- keeps its data.
--
-- THE META CONNECTION IS COPIED, NOT RETYPED. A fresh org has no
-- org_integrations row, and without one every Meta screen is dead: no Pages
-- list, no publish target, no ad-account sync. The INSERT ... SELECT below
-- carries the verified token across in-place, so it never appears in a shell,
-- a transcript, or this file. Same token, same TEST project, same admin-only
-- RLS (#42) — but note it now exists in TWO rows, which is a real fact about
-- the blast radius if it is ever rotated: rotate both.
--
-- Idempotent: re-running reuses the org and leaves the integration alone.
--
-- Run:
--   npx supabase db query --linked -f scripts/provision-reviewer-sandbox.sql

DO $$
DECLARE
  v_demo uuid;
  v_new  uuid;
BEGIN
  -- Guard: the demo org's name is the TEST fingerprint. Absent on PROD, so an
  -- accidental PROD run is a no-op error rather than a new org in a customer
  -- tenant.
  SELECT id INTO v_demo FROM organizations WHERE name = 'Demo Builder Pvt Ltd' LIMIT 1;
  IF v_demo IS NULL THEN
    RAISE EXCEPTION 'Demo org not found — refusing to run (not the TEST project).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'reviewer@awaas.internal') THEN
    RAISE EXCEPTION 'reviewer@awaas.internal does not exist — this script provisions, it does not create users.';
  END IF;

  SELECT id INTO v_new FROM organizations WHERE name = 'AWAAS Review Sandbox' LIMIT 1;
  IF v_new IS NULL THEN
    INSERT INTO organizations (name, primary_city, secondary_city, brand_colors, tone_of_voice)
    VALUES ('AWAAS Review Sandbox', 'Bhubaneswar', 'Cuttack',
            '#1B2233, #2563EB, #FFFFFF', 'Professional & Premium')
    RETURNING id INTO v_new;
    RAISE NOTICE 'Created org %', v_new;
  ELSE
    RAISE NOTICE 'Reusing org %', v_new;
  END IF;

  -- Admin: the reviewer has to reach Settings -> Publishing (isAdmin-gated in
  -- the render) and org_integrations (admin-only RLS) to demonstrate the
  -- permissions. module_access is left alone — hasModuleAccess() short-circuits
  -- on admin, so it is dead weight for this account either way.
  UPDATE profiles
     SET org_id = v_new, role = 'admin', is_active = true
   WHERE email = 'reviewer@awaas.internal';

  IF NOT EXISTS (SELECT 1 FROM org_integrations WHERE org_id = v_new AND provider = 'meta') THEN
    INSERT INTO org_integrations (
      org_id, provider, meta_access_token, meta_app_id, meta_granted_scopes,
      meta_token_type, meta_user_id, meta_verified_at, token_expires_at,
      meta_ad_account_id, publish_page_id, publish_page_name,
      publish_ig_user_id, publish_ig_username, is_active, status
    )
    SELECT
      v_new, 'meta', meta_access_token, meta_app_id, meta_granted_scopes,
      meta_token_type, meta_user_id, meta_verified_at, token_expires_at,
      meta_ad_account_id, publish_page_id, publish_page_name,
      publish_ig_user_id, publish_ig_username, true, status
    FROM org_integrations
    WHERE org_id = v_demo AND provider = 'meta';
    RAISE NOTICE 'Copied the Meta connection to the new org';
  ELSE
    RAISE NOTICE 'Integration already present — left untouched';
  END IF;
END $$;

-- Confirm (no secrets): the reviewer now sits in an org with a live Meta
-- connection and ZERO projects.
SELECT
  p.email,
  p.role,
  o.name  AS org_name,
  (SELECT count(*) FROM projects  pr WHERE pr.org_id = o.id AND pr.is_active) AS active_projects,
  (SELECT count(*) FROM campaigns c  WHERE c.org_id  = o.id)                  AS campaigns,
  (i.meta_access_token IS NOT NULL)                                           AS has_token,
  i.meta_ad_account_id,
  i.publish_page_name,
  i.publish_ig_username
FROM profiles p
JOIN organizations o     ON o.id = p.org_id
LEFT JOIN org_integrations i ON i.org_id = o.id AND i.provider = 'meta'
WHERE p.email = 'reviewer@awaas.internal';

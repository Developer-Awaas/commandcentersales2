-- Seed one ADMIN user on the review org (TEST project AwaasSuite_CC_Test only).
-- RB-P4 STEP 4. Additive — creates ONE new auth user + promotes its
-- auto-created profile to admin on the review org. Touches no existing rows.
--
-- Run with the linked TEST CLI, substituting the two placeholders (the wrapper
-- pipeline does this into a temp file so the password never hits a transcript):
--   sed 's/__EMAIL__/.../; s/__PASSWORD__/.../' scripts/seed-review-admin.sql > /tmp/x.sql
--   npx supabase db query --linked -f /tmp/x.sql
--
-- Password hashing uses pgcrypto (crypt/gen_salt bf) — GoTrue-compatible. Empty
-- token strings avoid GoTrue's NULL-token login bug. email_confirmed_at is set
-- so the user can sign in immediately (no confirmation email).
--
-- Safety guard: refuses to run unless the TEST review org exists by name — this
-- fingerprint is absent on PROD, so an accidental PROD run is a no-op error.

DO $$
DECLARE
  v_org uuid;
  v_uid uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_org FROM organizations WHERE name = 'Demo Builder Pvt Ltd' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Review org "Demo Builder Pvt Ltd" not found — refusing to seed (not the TEST project).';
  END IF;

  -- auth.users has no plain UNIQUE(email) constraint usable by ON CONFLICT
  -- (uniqueness is enforced by a partial index), so guard with IF NOT EXISTS.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = '__EMAIL__') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      '__EMAIL__', crypt('__PASSWORD__', gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Saswat (Review Admin)"}'::jsonb
    );
  END IF;

  -- handle_new_user() auto-creates a bare profile (org_id NULL). Promote it to
  -- admin on the review org. The self-escalation guard only fires for
  -- auth.uid() = id; this runs as the DB role (auth.uid() NULL), so it's allowed.
  UPDATE profiles
     SET role = 'admin', org_id = v_org, full_name = 'Saswat (Review Admin)'
   WHERE email = '__EMAIL__';
END $$;

-- Confirm (no secrets): the promoted profile.
SELECT p.email, p.role, p.org_id, o.name AS org_name
FROM profiles p JOIN organizations o ON o.id = p.org_id
WHERE p.email = '__EMAIL__';

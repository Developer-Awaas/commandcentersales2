-- Promote the Meta App Review account to admin on the review org.
-- TEST-only (AwaasSuite_CC_Test). Additive to ONE existing profile row.
--
-- Why: meta-review@awaas.world was created as role='member', and a member
-- cannot perform three of the six R-A review beats — the Publishing section is
-- admin-gated in the render (SettingsPage.tsx), meta-publish-targets 403s a
-- non-admin for every action (index.ts:70-73), and org_integrations is
-- admin-only RLS since bug #42. Meta's reviewer follows written steps with
-- this account, so it has to be able to reach those screens.
--
-- The self-escalation trigger on profiles only fires for auth.uid() = id; this
-- runs as the DB role (auth.uid() NULL), so the UPDATE is permitted — the same
-- mechanism scripts/seed-review-admin.sql already relies on.
--
-- Safety guard: refuses unless the TEST review org exists by name. That
-- fingerprint is absent on PROD, so an accidental PROD run is a no-op error.
--
-- Run:
--   sed 's/__PASSWORD__/.../' scripts/promote-meta-reviewer.sql > /tmp/x.sql
--   npx supabase db query --linked -f /tmp/x.sql

DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organizations WHERE name = 'Demo Builder Pvt Ltd' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Review org "Demo Builder Pvt Ltd" not found — refusing to run (not the TEST project).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'meta-review@awaas.world') THEN
    RAISE EXCEPTION 'meta-review@awaas.world does not exist — this script promotes, it does not create.';
  END IF;

  -- Role only. module_access is deliberately untouched: hasModuleAccess()
  -- short-circuits on role==='admin' (access.ts:35), so the column is dead
  -- weight for an admin, and rewriting it would discard whatever was
  -- deliberately granted to this account as a member.
  UPDATE profiles
     SET role = 'admin', org_id = v_org, is_active = true
   WHERE email = 'meta-review@awaas.world';

  -- Fresh password so the credentials handed to Meta are known-good. bcrypt
  -- via pgcrypto, GoTrue-compatible, same as seed-review-admin.sql.
  UPDATE auth.users
     SET encrypted_password = crypt('__PASSWORD__', gen_salt('bf')),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         updated_at = now()
   WHERE email = 'meta-review@awaas.world';
END $$;

-- Confirm (no secrets): the promoted profile alongside its peers.
SELECT p.email, p.role, p.is_active, o.name AS org_name
FROM profiles p JOIN organizations o ON o.id = p.org_id
WHERE o.name = 'Demo Builder Pvt Ltd'
ORDER BY p.email;

-- ============================================================
-- RB-MO STEP 7 — a connection has a STATUS, not just a boolean.
--
-- is_active conflated two very different things: "the user turned this off"
-- and "the sync hit an auth error and disabled it". The consequences of that
-- conflation are on record: when Neelachala Homes' token died on 2026-07-20
-- the sync set is_active=false, and because the org loop filters on
-- is_active=true, the row then vanished from the loop entirely — no error, no
-- `skipped`, no log line of ANY kind for a month. Silence that looked like
-- "nothing to do" was actually "a customer's integration is broken".
--
--   active   — usable; last verification passed
--   invalid  — a token we cannot use (dead app / foreign app / revoked).
--              Still visited by the sync so it can RECOVER on reconnect.
--   disabled — deliberately switched off by a human. Not visited.
--
-- Existing rows: is_active=true -> 'active', is_active=false -> 'invalid'.
-- That backfill is a judgement call and worth stating: every is_active=false
-- row today was auto-disabled by the sync's auth-error path (the UI has no
-- off switch), so 'invalid' is the accurate reading, not a guess.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_integrations' AND column_name='status') THEN
    ALTER TABLE org_integrations ADD COLUMN status text NOT NULL DEFAULT 'active';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='org_integrations_status_check') THEN
    ALTER TABLE org_integrations
      ADD CONSTRAINT org_integrations_status_check
      CHECK (status IN ('active','invalid','disabled'));
  END IF;
END $$;

UPDATE org_integrations
   SET status = CASE WHEN is_active THEN 'active' ELSE 'invalid' END
 WHERE status = 'active' AND is_active = false;

COMMENT ON COLUMN org_integrations.status IS
  'active | invalid | disabled. invalid = token unusable (dead/foreign/revoked) but still re-checked each sync so it can recover; disabled = deliberately off, never visited. Distinguishing these is what stopped a broken integration from silently vanishing from the sync loop.';

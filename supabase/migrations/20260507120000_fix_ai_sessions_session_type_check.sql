-- Replace the existing CHECK constraint on ai_sessions.session_type.
--
-- Background: the live DB has a CHECK on session_type that does not include
-- 'quick_generate_senior' (added for Flow 3 — Quick Senior / Aanya path).
-- Inserts from src/pages/Strategy.tsx:403 fail with PostgreSQL 23514 on every
-- generation. This migration drops the existing constraint (whatever its name)
-- and recreates it with the full set of session_type values currently emitted
-- by the application.
--
-- The original constraint was added outside this repo's migration history
-- (likely via Supabase Dashboard), so we discover its name dynamically rather
-- than hardcoding it.

DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'ai_sessions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%session_type%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ai_sessions DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE ai_sessions
  ADD CONSTRAINT ai_sessions_session_type_check
  CHECK (session_type IN (
    'quick_generate',
    'quick_generate_senior',
    'full_strategy',
    'creative',
    'ad_review',
    'ad_config',
    'analysis',
    'organic'
  ));

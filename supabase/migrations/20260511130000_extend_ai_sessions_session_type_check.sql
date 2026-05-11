-- Extend the existing CHECK constraint on ai_sessions.session_type to include 'smm_analysis'.
--
-- Background: 20260507120000 added a CHECK with 8 session_type values currently emitted
-- by the app. SMMAnalyzer.tsx was using session_type = 'smm_analysis' (bypassing the
-- logAiSession helper which would have made it visible to the earlier sweep). Inserts
-- failed with PostgreSQL 23514 (check_violation).
--
-- This migration mirrors 20260507120000's pattern exactly: dynamically discover whatever
-- CHECK constraint references session_type (regardless of current name) and drop it,
-- then re-add the constraint with the full set of 9 session_type values now emitted
-- by the application.

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
    'organic',
    'smm_analysis'
  ));

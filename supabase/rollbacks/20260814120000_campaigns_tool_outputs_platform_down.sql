-- ============================================================
-- DOWN for 20260814120000_campaigns_tool_outputs_platform.sql
--
-- NOT auto-applied — supabase/rollbacks/ is outside the CLI's migration scan
-- on purpose. Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260814120000_campaigns_tool_outputs_platform_down.sql
--
-- ASYMMETRIC — READ BEFORE RUNNING.
--
-- tool_outputs.platform is dropped: the UP created it, so removing it returns
-- the table to its prior shape exactly.
--
-- campaigns.platform is NOT dropped. The UP did not create it — it has existed
-- since 20260409123924 — so dropping it here would destroy a column the UP
-- never added. This releases the constraint and restores the '' default, which
-- is as far back as it is safe to go automatically.
--
-- What this CANNOT undo: the UP normalised existing values in place
-- ('Meta Ads Manager' → 'meta', 'AiSensy' → 'meta', '' → NULL). The original
-- display strings are not recoverable from anywhere. In practice nothing is
-- lost — CTWA-ness lives in campaigns.ad_type and the display strings were
-- never authoritative — but a rollback expecting the literal old text back
-- will not get it. Restore from a backup if that text is genuinely needed.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='campaigns_platform_check') THEN
    ALTER TABLE campaigns DROP CONSTRAINT campaigns_platform_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tool_outputs_platform_check') THEN
    ALTER TABLE tool_outputs DROP CONSTRAINT tool_outputs_platform_check;
  END IF;
END $$;

-- Restore the pre-UP default so inserts that omit the column behave as before.
ALTER TABLE campaigns ALTER COLUMN platform SET DEFAULT '';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tool_outputs' AND column_name='platform') THEN
    ALTER TABLE tool_outputs DROP COLUMN platform;
  END IF;
END $$;

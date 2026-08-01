-- ============================================================
-- DOWN migration for 20260731130000_tool_outputs_add_monitor_tools.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260731130000_tool_outputs_add_monitor_tools_down.sql
--
-- Reverts the tool CHECK to the pre-CC-P4 set. Only safe if no rows use the
-- 'performance'/'smm_analysis' tools yet — a DELETE guard prevents silently
-- orphaning them (a CHECK can't be re-narrowed while violating rows exist).
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tool_outputs WHERE tool IN ('performance', 'smm_analysis')) THEN
    RAISE WARNING 'tool_outputs has performance/smm_analysis rows — NOT re-narrowing the CHECK. Remove or migrate those rows first.';
  ELSE
    ALTER TABLE tool_outputs DROP CONSTRAINT IF EXISTS tool_outputs_tool_check;
    ALTER TABLE tool_outputs ADD CONSTRAINT tool_outputs_tool_check
      CHECK (tool IN ('strategy', 'ad_config', 'ad_creatives', 'ad_review', 'smm_planner', 'smm_creatives'));
  END IF;
END $$;

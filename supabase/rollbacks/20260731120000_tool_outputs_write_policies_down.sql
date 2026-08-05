-- ============================================================
-- DOWN migration for 20260731120000_tool_outputs_write_policies.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260731120000_tool_outputs_write_policies_down.sql
--
-- Removes the client write policies, reverting tool_outputs to
-- SELECT-only (the broken CC-P3 state). Only useful if the write path is
-- ever intentionally moved server-side (service-role only) — otherwise
-- running this re-breaks the History save path.
-- ============================================================

DROP POLICY IF EXISTS "Org members can insert their tool outputs" ON tool_outputs;
DROP POLICY IF EXISTS "Org members can update their tool outputs" ON tool_outputs;
DROP POLICY IF EXISTS "Org members can delete their tool outputs" ON tool_outputs;

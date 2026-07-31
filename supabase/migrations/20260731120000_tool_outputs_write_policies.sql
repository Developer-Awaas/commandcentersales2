-- ============================================================
-- Fix a real production bug shipped in CC-P3 (20260730130000): tool_outputs
-- had RLS enabled but ONLY a SELECT policy — modeled on agent_interactions,
-- which is service-role-write-only. But tool_outputs is written CLIENT-SIDE
-- by an authenticated user (src/lib/history-service.ts's saveToolOutput /
-- markStatus / deleteToolOutput, called from StrategyGenerator, AdConfig,
-- AdReview). With RLS on and no INSERT/UPDATE/DELETE policy, every one of
-- those writes is silently denied — the entire History save path has been
-- broken in production since CC-P3 merged.
--
-- The unit tests never caught it (they mock the Supabase client, so RLS
-- never runs); the Playwright e2e caught it on its first real authenticated
-- run against PROD.
--
-- Fix: add the standard org-scoped INSERT/UPDATE/DELETE policies for
-- `authenticated`, matching how every other client-written table in this
-- schema is gated (e.g. creative_assets, which has all four and whose
-- client inserts work). The service-role write path (the weekly
-- history-retention-sweep) is unaffected either way — it bypasses RLS.
-- ============================================================

DROP POLICY IF EXISTS "Org members can insert their tool outputs" ON tool_outputs;
CREATE POLICY "Org members can insert their tool outputs"
  ON tool_outputs FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_current_user_org_id());

DROP POLICY IF EXISTS "Org members can update their tool outputs" ON tool_outputs;
CREATE POLICY "Org members can update their tool outputs"
  ON tool_outputs FOR UPDATE
  TO authenticated
  USING (org_id = get_current_user_org_id())
  WITH CHECK (org_id = get_current_user_org_id());

DROP POLICY IF EXISTS "Org members can delete their tool outputs" ON tool_outputs;
CREATE POLICY "Org members can delete their tool outputs"
  ON tool_outputs FOR DELETE
  TO authenticated
  USING (org_id = get_current_user_org_id());

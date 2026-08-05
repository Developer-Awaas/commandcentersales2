-- ============================================================
-- CC-P4 Steps 3+4: the Performance Monitor and SMM Monitor save their
-- analyses to tool_outputs with new tool values — 'performance' (ads
-- domain, per-ad performance analysis + weekly report) and 'smm_analysis'
-- (social domain, SMM analysis over a date window). Extend the tool CHECK
-- to allow them. domain CHECK ('ads'/'social') is unchanged.
--
-- Both new tools land in this one migration so Step 4 needs no second one.
-- ============================================================

ALTER TABLE tool_outputs DROP CONSTRAINT IF EXISTS tool_outputs_tool_check;
ALTER TABLE tool_outputs ADD CONSTRAINT tool_outputs_tool_check
  CHECK (tool IN ('strategy', 'ad_config', 'ad_creatives', 'ad_review', 'smm_planner', 'smm_creatives', 'performance', 'smm_analysis'));

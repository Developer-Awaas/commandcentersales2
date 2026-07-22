-- ============================================================
-- Fix a stale key name in profiles.module_access's default value.
--
-- src/lib/access.ts's PAGE_TO_MODULE map has required the key
-- 'strategy_quick' (for both the 'strategy' and 'leadgen-v2' pages)
-- since the very first commit that introduced access.ts
-- (48551f0, "extract access logic + fix ACCESS_MAP granular keys +
-- Sidebar module_access gating") — this was never a later rename that
-- broke something that used to work. The profiles table's
-- module_access DEFAULT (set even earlier, in the original
-- 20260409085002 migration) has always listed the old key 'strategy'
-- instead, which access.ts's hasModuleAccess() never checks for. Any
-- non-admin ('role' defaults to 'member') new signup has silently had
-- Strategy/LeadGen-V2 hidden from nav since access.ts shipped, despite
-- 'strategy' appearing to be granted in their module_access array.
--
-- Found while investigating why a freshly-created review-build
-- reviewer account (role='member') couldn't see Strategy/creative
-- generation at all.
--
-- Fix is purely additive: ADD 'strategy_quick' wherever 'strategy' is
-- present (both the column default, for future signups, and a
-- backfill for existing rows). Does not remove 'strategy' — keeping
-- both is harmless (the array can hold unused entries; hasModuleAccess
-- only ever checks for the presence of the keys it needs) and avoids
-- destructively rewriting a column an admin may have already
-- customized for a specific member.
--
-- Deliberately NOT addressed here: 9 other modules
-- (ai_sessions/brand_kit/campaign_wizard/campaigns/content_library/
-- smm_analyzer/smm_calendar/smm_creatives/smm_planner) that access.ts
-- also gates but which have never been in this default at all, for
-- any role, since each was added after the original 2026-04-09
-- migration. That's a separate, ambiguous product question (should a
-- brand-new member get these by default, or should an admin grant them
-- explicitly?) rather than a confirmed bug — 'strategy_quick' is
-- fixed here specifically because 'strategy' being present under the
-- wrong name is unambiguously a naming-mismatch defect, not a policy
-- choice.
-- ============================================================

ALTER TABLE profiles ALTER COLUMN module_access SET DEFAULT ARRAY[
  'dashboard','projects','strategy','strategy_quick','ad_config','creatives',
  'ad_review','analyzer','organic','notifications','reports','settings'
];

UPDATE profiles
SET module_access = array_append(module_access, 'strategy_quick')
WHERE 'strategy' = ANY(module_access)
  AND NOT ('strategy_quick' = ANY(module_access));

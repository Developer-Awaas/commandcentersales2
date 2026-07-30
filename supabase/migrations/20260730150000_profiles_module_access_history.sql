-- ============================================================
-- Add history_ads/history_social to profiles.module_access, additive +
-- backfilled — same treatment as 20260722120000's strategy_quick fix
-- (bug #43), applied here proactively rather than reactively: minting a
-- brand-new module key without backfilling existing rows would silently
-- lock every current non-admin user out of the new History nav item the
-- moment access.ts starts checking for it (admins bypass module_access
-- entirely — see access.ts's hasModuleAccess — so this only matters for
-- 'member' role).
--
-- Rejected alternative (reusing an existing key like 'campaigns' for
-- History's gate): creates accidental coupling — toggling Campaigns
-- access would silently hide/show History too, and vice versa. A new,
-- backfilled key is cleaner and matches the one precedent this codebase
-- already has for exactly this situation.
-- ============================================================

ALTER TABLE profiles ALTER COLUMN module_access SET DEFAULT ARRAY[
  'dashboard','projects','strategy','strategy_quick','ad_config','creatives',
  'ad_review','analyzer','organic','notifications','reports','settings',
  'history_ads','history_social'
];

UPDATE profiles
SET module_access = array_append(module_access, 'history_ads')
WHERE NOT ('history_ads' = ANY(module_access));

UPDATE profiles
SET module_access = array_append(module_access, 'history_social')
WHERE NOT ('history_social' = ANY(module_access));

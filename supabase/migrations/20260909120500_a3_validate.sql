-- A3: validate the act_ format CHECKs added NOT VALID by
-- 20260909120000_t5m_surface_partition.sql. Kept separate so a violating
-- legacy row fails this file alone, not the surface partition.
-- Pre-flight on CC-TEST: 0 violating rows in either table. Re-count on PROD
-- before applying there (Phase 7).
--
-- Fix-forward only. No down migration.

ALTER TABLE org_integrations VALIDATE CONSTRAINT org_integrations_ad_account_format_check;
ALTER TABLE projects         VALIDATE CONSTRAINT projects_ad_account_format_check;

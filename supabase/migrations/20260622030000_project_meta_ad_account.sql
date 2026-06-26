-- Per-project Meta ad account ID.
-- Token stays org-level in org_integrations; each project can specify its own
-- Meta ad account to sync from. If none are set, the sync falls back to the
-- org-level meta_ad_account_id in org_integrations (backward compatible).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS meta_ad_account_id text;

-- Tag campaign_metrics rows with the project they were synced for.
-- NULL = org-level fallback sync (no per-project account configured at that time).
ALTER TABLE campaign_metrics
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_metrics_project
  ON campaign_metrics (org_id, project_id);

-- Future: multi-account manager (Phase 2 of Meta integration scaling)
-- When one org runs 10+ projects across separate ad accounts, create a new
-- org_ad_accounts table (org_id, account_id, label, project_ids uuid[]) and
-- a junction table mapping projects to accounts. The meta_ad_account_id column
-- on projects becomes a cached denormalization of that junction. Migration will
-- need to: (1) create org_ad_accounts, (2) backfill from projects.meta_ad_account_id,
-- (3) optionally drop projects.meta_ad_account_id in favour of the FK.
-- Do NOT implement until volume justifies it; keep this comment as a pointer.

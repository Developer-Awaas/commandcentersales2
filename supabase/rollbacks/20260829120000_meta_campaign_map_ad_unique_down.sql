-- ============================================================
-- DOWN for 20260829120000_meta_campaign_map_ad_unique.sql
--
-- NOT auto-applied. Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260829120000_meta_campaign_map_ad_unique_down.sql
--
-- Dropping this index loses nothing but the guarantee. No rows are deleted:
-- the wider index from 20260819120000 still enforces
-- (org_id, coalesce(meta_ad_id,''), meta_campaign_id), so the table keeps its
-- original uniqueness rule.
--
-- What DOES break: crm-map-ingest's upsert names these two columns as its
-- ON CONFLICT target, and Postgres infers a conflict target only from a
-- matching index. With the index gone every ingest call fails with
-- "42P10: there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — loudly, not silently. Undeploy the function or re-create
-- the index.
-- ============================================================

DROP INDEX IF EXISTS meta_campaign_map_org_ad_idx;

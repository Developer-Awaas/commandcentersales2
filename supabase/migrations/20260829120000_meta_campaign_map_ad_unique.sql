-- ============================================================
-- RB-M1 STEP 2 — one mapping row per (org, ad).
--
-- The locked crm-map-ingest contract is "idempotent upsert keyed on ad_id":
-- re-sending a batch must update the row it already wrote, never add a second.
-- The index from 20260819120000 does not express that. It keys on
-- (org_id, coalesce(meta_ad_id,''), meta_campaign_id), so the SAME ad arriving
-- with a different campaign_id — a re-parented ad, or a resend that omits the
-- optional campaign_id — lands as a second, contradictory row mapping one ad
-- to two projects. Nothing downstream could tell which one is current.
--
-- Two reasons this is an index and not a check inside the function:
--   1. ON CONFLICT infers its arbiter from an index, and inference is
--      syntactic. (org_id, meta_ad_id, meta_campaign_id) does NOT match an
--      index built over coalesce(meta_ad_id,''), verified live:
--        ERROR 42P10: there is no unique or exclusion constraint matching the
--        ON CONFLICT specification
--      So without a plain-column index the upsert has no legal arbiter at all
--      and the alternative is a racy read-then-write in TypeScript.
--   2. The guarantee then holds for every future writer, not just this one.
--
-- ADDITIVE. The 20260819120000 index stays and still governs campaign-level
-- rows (meta_ad_id NULL), which this index cannot: SQL NULLs are distinct, so
-- unlimited campaign-level rows remain legal here — exactly the division of
-- labour intended. For ad-level rows this index is strictly stricter, and the
-- two can never disagree: a row can only violate the older index by reusing an
-- (org, ad) pair, which this one already forbids.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS meta_campaign_map_org_ad_idx
  ON meta_campaign_map (org_id, meta_ad_id);

COMMENT ON INDEX meta_campaign_map_org_ad_idx IS
  'One mapping row per (org, ad). Conflict arbiter for crm-map-ingest''s upsert — inference needs plain columns, which the coalesce() index cannot provide. Campaign-level rows (meta_ad_id NULL) are unconstrained here by design and governed by meta_campaign_map_unique_idx.';

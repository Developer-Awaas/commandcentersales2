-- DOWN for 20260828130000_published_assets.sql. Manual only:
--   supabase db query --linked -f supabase/rollbacks/20260828130000_published_assets_down.sql
--
-- DESTRUCTIVE: this discards the record of every post this product made,
-- including the live ones that are still on a real Page. The posts themselves
-- are unaffected — only our ability to say we made them. Export first if the
-- publish history matters:
--   supabase db query --linked "copy (select * from published_assets) to stdout with csv header"

DROP TABLE IF EXISTS published_assets;

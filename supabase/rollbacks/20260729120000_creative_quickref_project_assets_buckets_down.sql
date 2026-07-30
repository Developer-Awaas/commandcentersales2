-- ============================================================
-- DOWN migration for 20260729120000_creative_quickref_project_assets_buckets.sql
--
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260729120000_creative_quickref_project_assets_buckets_down.sql
--
-- Does NOT drop the buckets themselves (would destroy any objects
-- already uploaded into them) — only removes the policies this
-- migration added. Drop buckets manually via the Dashboard if you
-- are certain they hold no data you need.
-- ============================================================

DROP POLICY IF EXISTS "authenticated read creative-assets" ON storage.objects;
DROP POLICY IF EXISTS "authenticated upload creative-assets" ON storage.objects;
DROP POLICY IF EXISTS "authenticated update creative-assets" ON storage.objects;

DROP POLICY IF EXISTS "authenticated read quick-references" ON storage.objects;
DROP POLICY IF EXISTS "authenticated upload quick-references" ON storage.objects;
DROP POLICY IF EXISTS "authenticated update quick-references" ON storage.objects;

DROP POLICY IF EXISTS "authenticated read project-assets" ON storage.objects;
DROP POLICY IF EXISTS "authenticated upload project-assets" ON storage.objects;
DROP POLICY IF EXISTS "authenticated update project-assets" ON storage.objects;

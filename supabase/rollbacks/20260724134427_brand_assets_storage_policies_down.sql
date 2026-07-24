-- Run manually: supabase db query --linked -f supabase/rollbacks/20260724134427_brand_assets_storage_policies_down.sql
-- WARNING: dropping these breaks every client-side image upload
-- (Quick Generate, Creatives page) immediately.

DROP POLICY IF EXISTS "authenticated read brand-assets" ON storage.objects;
DROP POLICY IF EXISTS "authenticated upload brand-assets" ON storage.objects;
DROP POLICY IF EXISTS "authenticated update brand-assets" ON storage.objects;

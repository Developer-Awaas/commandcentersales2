-- ============================================================
-- Bucket + RLS parity for creative-assets, quick-references,
-- project-assets — same class of gap as brand-assets
-- (20260724134427_brand_assets_storage_policies.sql): buckets
-- referenced by client-side/Edge Function code but never
-- captured in a migration, likely created manually via
-- Dashboard on whichever environment this was originally tested
-- against. PROD never had them at all (confirmed via
-- `select id, name, public from storage.buckets` returning only
-- brand-assets).
--
-- Bucket usage confirmed via grep before writing this:
--   creative-assets  — generate-creatives Edge Function upload +
--                       getPublicUrl (service-role, but the
--                       bucket must still exist and be public for
--                       the returned URL to resolve)
--   quick-references — ReferenceImagePack.tsx client-side upload
--                       with the user's own session (RLS-governed,
--                       not service-role — needs real policies)
--   project-assets   — legacy bucket; ProjectAssetsTab.tsx now
--                       writes new uploads to
--                       brand-assets/project-assets/, this bucket
--                       is kept only so the delete fallback for
--                       pre-migration rows still resolves
--
-- All three set public=true, matching brand-assets — every write
-- path calls getPublicUrl() and expects it to resolve without a
-- signed URL.
--
-- Policy shape is an exact copy of brand-assets' 3 policies
-- (read/upload/update, bucket-scoped only — no path/org
-- enforcement in storage.objects RLS today, consistent with the
-- existing pattern). No delete policy, matching brand-assets,
-- which also has none.
-- ============================================================

insert into storage.buckets (id, name, public)
values
  ('creative-assets', 'creative-assets', true),
  ('quick-references', 'quick-references', true),
  ('project-assets', 'project-assets', true)
on conflict (id) do nothing;

DO $$ BEGIN
  DROP POLICY IF EXISTS "authenticated read creative-assets" ON storage.objects;
  CREATE POLICY "authenticated read creative-assets"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'creative-assets');

  DROP POLICY IF EXISTS "authenticated upload creative-assets" ON storage.objects;
  CREATE POLICY "authenticated upload creative-assets"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'creative-assets');

  DROP POLICY IF EXISTS "authenticated update creative-assets" ON storage.objects;
  CREATE POLICY "authenticated update creative-assets"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'creative-assets');
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "authenticated read quick-references" ON storage.objects;
  CREATE POLICY "authenticated read quick-references"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'quick-references');

  DROP POLICY IF EXISTS "authenticated upload quick-references" ON storage.objects;
  CREATE POLICY "authenticated upload quick-references"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'quick-references');

  DROP POLICY IF EXISTS "authenticated update quick-references" ON storage.objects;
  CREATE POLICY "authenticated update quick-references"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'quick-references');
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "authenticated read project-assets" ON storage.objects;
  CREATE POLICY "authenticated read project-assets"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'project-assets');

  DROP POLICY IF EXISTS "authenticated upload project-assets" ON storage.objects;
  CREATE POLICY "authenticated upload project-assets"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'project-assets');

  DROP POLICY IF EXISTS "authenticated update project-assets" ON storage.objects;
  CREATE POLICY "authenticated update project-assets"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'project-assets');
END $$;

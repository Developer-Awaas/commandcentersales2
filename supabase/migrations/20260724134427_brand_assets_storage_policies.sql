-- storage.objects RLS policies for the 'brand-assets' bucket.
--
-- Same class of gap as aanya_training_creatives / creative_assets.creative_id
-- / the pg_cron extension (bug #44): PROD has these 3 policies via manual
-- Dashboard setup, never captured in any migration. Client-side image
-- generation (uploadGeminiImageToSupabase, gemini-service.ts — Quick
-- Generate and the Creatives page) uploads with the user's own session,
-- RLS-governed, not the service-role client. Any environment built purely
-- from migration replay (CC-TEST) had ZERO storage.objects policies at all
-- — confirmed via `select * from pg_policies where schemaname='storage'
-- and tablename='objects'` returning 0 rows — so every such upload failed
-- with "new row violates row-level security policy", masked in earlier
-- verification because that only ever used the service-role key (bypasses
-- RLS entirely).
--
-- Exact match to PROD's existing policies (confirmed via
-- `supabase db query --linked` against mpvdpdxzqnidwyihyhbn), not a new
-- design — this migration documents/replicates what's already live, same
-- treatment as every other bootstrap migration this session.

DO $$ BEGIN
  DROP POLICY IF EXISTS "authenticated read brand-assets" ON storage.objects;
  CREATE POLICY "authenticated read brand-assets"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'brand-assets');

  DROP POLICY IF EXISTS "authenticated upload brand-assets" ON storage.objects;
  CREATE POLICY "authenticated upload brand-assets"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'brand-assets');

  DROP POLICY IF EXISTS "authenticated update brand-assets" ON storage.objects;
  CREATE POLICY "authenticated update brand-assets"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'brand-assets');
END $$;

-- DOWN for 20260917121000_t010_awaas_data_pool_rls.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- ⚠️ RE-OPENS T-010 for this table. Emergency use only; replace again at once.
BEGIN;

DROP POLICY IF EXISTS "Allow select awaas_data_pool" ON awaas_data_pool;
CREATE POLICY "Allow anon insert awaas_data_pool" ON awaas_data_pool
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow anon select awaas_data_pool" ON awaas_data_pool
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon update awaas_data_pool" ON awaas_data_pool
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can read awaas pool" ON awaas_data_pool
  FOR SELECT TO authenticated USING (true);

COMMIT;

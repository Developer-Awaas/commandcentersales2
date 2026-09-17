-- T-010 (P0) 2/3: awaas_data_pool was readable, insertable and updatable by
-- anon, and readable across orgs by any signed-in user. Cross-customer reads
-- contradict the k-anonymity rule and have no caller. Remaining shape:
--   SELECT  own org  (src/pages/Reports.tsx:442, filters on own org)
--   INSERT  own org  ("Users can insert own org awaas data", kept;
--                     src/pages/Reports.tsx:428)
--   no UPDATE / DELETE (no caller)
--
-- Down: supabase/rollbacks/20260917121000_t010_awaas_data_pool_rls_down.sql

DROP POLICY IF EXISTS "Allow anon insert awaas_data_pool" ON awaas_data_pool;
DROP POLICY IF EXISTS "Allow anon select awaas_data_pool" ON awaas_data_pool;
DROP POLICY IF EXISTS "Allow anon update awaas_data_pool" ON awaas_data_pool;
DROP POLICY IF EXISTS "Authenticated users can read awaas pool" ON awaas_data_pool;

DROP POLICY IF EXISTS "Allow select awaas_data_pool" ON awaas_data_pool;
CREATE POLICY "Allow select awaas_data_pool" ON awaas_data_pool
  FOR SELECT TO authenticated
  USING (org_id = get_current_user_org_id());

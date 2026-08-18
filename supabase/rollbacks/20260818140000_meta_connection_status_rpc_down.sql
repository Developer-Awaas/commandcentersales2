-- DOWN for 20260818140000_meta_connection_status_rpc.sql
-- Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260818140000_meta_connection_status_rpc_down.sql
--
-- Dropping this returns non-admins to seeing "Connect Meta" on Performance
-- Monitor even when the connection is healthy, because org_integrations is
-- admin-only. Only drop this alongside reverting the client to read the table
-- directly (which only works for admins).
DROP FUNCTION IF EXISTS public.meta_connection_status();

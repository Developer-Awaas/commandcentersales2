-- DOWN for 20260820120000_oauth_session_consumed_at.sql
-- Apply manually:
--   supabase db query --linked -f supabase/rollbacks/20260820120000_oauth_session_consumed_at_down.sql
--
-- Reverting this returns all three failure modes (replayed / forged / expired)
-- to sharing one message. It also requires reverting consumeOAuthFlowSession to
-- DELETE on use, or consumed rows will accumulate with nothing sweeping them
-- and every replay will read as a valid session.
ALTER TABLE oauth_flow_sessions DROP COLUMN IF EXISTS consumed_at;
DROP INDEX IF EXISTS oauth_flow_sessions_expires_idx;

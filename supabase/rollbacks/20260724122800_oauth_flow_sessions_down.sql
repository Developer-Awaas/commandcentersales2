-- Run manually: supabase db query --linked -f supabase/rollbacks/20260724122800_oauth_flow_sessions_down.sql
-- WARNING: only run if reverting the whole PKCE/server-authoritative OAuth
-- fix — this drops the table backing every in-flight Canva connect attempt.

drop index if exists idx_oauth_flow_sessions_expires_at;
drop table if exists public.oauth_flow_sessions;

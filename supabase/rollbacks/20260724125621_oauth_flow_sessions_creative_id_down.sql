-- Run manually: supabase db query --linked -f supabase/rollbacks/20260724125621_oauth_flow_sessions_creative_id_down.sql
ALTER TABLE public.oauth_flow_sessions DROP COLUMN IF EXISTS creative_id;

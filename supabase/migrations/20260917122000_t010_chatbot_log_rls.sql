-- T-010 (P0) 3/3: chatbot_log was readable, insertable and updatable by anon
-- — anyone with the anon key could read every org's chat text. The org-scoped
-- "Allow insert chatbot_log" / "Allow select chatbot_log" policies already
-- cover the only callers (src/lib/chatbot-service.ts:30 count, :167 insert).
-- No user_id = auth.uid() rule: user_id is client-supplied text (T-011).
--
-- Down: supabase/rollbacks/20260917122000_t010_chatbot_log_rls_down.sql

DROP POLICY IF EXISTS "Allow anon insert for chatbot logs" ON chatbot_log;
DROP POLICY IF EXISTS "Allow anon select for chatbot logs" ON chatbot_log;
DROP POLICY IF EXISTS "Allow anon update chatbot_log" ON chatbot_log;

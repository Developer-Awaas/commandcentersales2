-- DOWN for 20260917122000_t010_chatbot_log_rls.sql
-- Lives in supabase/rollbacks/ so the CLI never auto-applies it.
-- Apply manually: supabase db query --linked -f supabase/rollbacks/<this file>
-- ⚠️ RE-OPENS T-010 for this table. Emergency use only; replace again at once.
BEGIN;

CREATE POLICY "Allow anon insert for chatbot logs" ON chatbot_log
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon select for chatbot logs" ON chatbot_log
  FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon update chatbot_log" ON chatbot_log
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

COMMIT;

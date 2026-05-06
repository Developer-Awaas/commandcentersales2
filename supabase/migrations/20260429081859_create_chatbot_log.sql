/*
  # Create chatbot_log table

  1. New Tables
    - `chatbot_log` - stores AI chatbot conversation messages for analytics
      - `id` (uuid, primary key)
      - `org_id` (text) - organization identifier
      - `user_id` (text) - user identifier
      - `page_context` (text) - which page the user was on
      - `data_context` (text, nullable) - serialized page data at time of message
      - `user_message` (text) - what the user asked
      - `bot_response` (text) - what the AI replied
      - `tokens_used` (int) - token count for analytics
      - `created_at` (timestamptz) - when message was sent

  2. Security
    - Enable RLS with anon insert allowed (dev mode, no auth enforcement)
*/

CREATE TABLE IF NOT EXISTS chatbot_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL DEFAULT '',
  user_id text NOT NULL DEFAULT 'dev-user-001',
  page_context text NOT NULL DEFAULT '',
  data_context text,
  user_message text NOT NULL DEFAULT '',
  bot_response text NOT NULL DEFAULT '',
  tokens_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chatbot_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert for chatbot logs"
  ON chatbot_log FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon select for chatbot logs"
  ON chatbot_log FOR SELECT
  TO anon
  USING (true);

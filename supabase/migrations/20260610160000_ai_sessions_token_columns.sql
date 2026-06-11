-- Add per-call token tracking and Gemini image count to ai_sessions.
-- claude_input_tokens  : tokens in the Claude request (system + user prompt)
-- claude_output_tokens : tokens in Claude's response
-- gemini_images_generated : number of images Gemini Imagen successfully returned
-- tokens_used stays as the legacy total (input + output) for backwards compat with Reports.

ALTER TABLE ai_sessions
  ADD COLUMN IF NOT EXISTS claude_input_tokens   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claude_output_tokens  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gemini_images_generated integer NOT NULL DEFAULT 0;

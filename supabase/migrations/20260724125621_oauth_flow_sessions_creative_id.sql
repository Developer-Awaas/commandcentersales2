-- Correlation state needs to carry WHICH creative triggered the OAuth
-- flow (canva-open-editor's cold-start fallback), so the return landing
-- page can auto-resume opening that specific creative's Canva editor
-- instead of leaving the user to click "Edit in Canva" again manually.
-- Null when the flow was initiated from the generic "Connect Canva"
-- button (no specific creative in context).

ALTER TABLE public.oauth_flow_sessions
  ADD COLUMN IF NOT EXISTS creative_id uuid REFERENCES creative_assets(id) ON DELETE CASCADE;

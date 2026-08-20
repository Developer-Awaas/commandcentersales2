-- ============================================================
-- P2.15 — tell "already used" apart from "never existed".
--
-- consumeOAuthFlowSession DELETED the row as it resolved it. Single-use is the
-- right security property, but deletion destroys the evidence of WHY a later
-- lookup misses: a replayed callback, a forged state, and an expired session
-- all become "row not found" and shared one message —
--   "OAuth flow session not found — expired, already used, or invalid state"
-- — which is three different bugs wearing one face.
--
-- That cost a real diagnosis: a Meta connect on 2026-08-20 SUCCEEDED (long-
-- lived USER token stored at 10:20:11, all eight scopes granted) and the user
-- was still shown a failure page, because a second hit — browser prefetch, the
-- #_=_ fragment navigation Facebook appends, or a plain reload — arrived after
-- the row was gone and rendered the generic error.
--
-- Marking consumed instead of deleting keeps single-use intact (a consumed row
-- is refused) while making the second hit distinguishable, so it can say
-- "already completed" and point at Settings rather than crying failure over a
-- connection that works.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_flow_sessions' AND column_name='consumed_at') THEN
    ALTER TABLE oauth_flow_sessions ADD COLUMN consumed_at timestamptz;
  END IF;
END $$;

-- Rows are no longer deleted on use, so they need a sweep. Opportunistic
-- cleanup runs in meta-oauth-start; this index keeps it cheap.
CREATE INDEX IF NOT EXISTS oauth_flow_sessions_expires_idx
  ON oauth_flow_sessions (expires_at);

COMMENT ON COLUMN oauth_flow_sessions.consumed_at IS
  'When this single-use nonce was redeemed. NOT NULL = already used; a replayed callback is refused but can now say "already completed" instead of "invalid state". Rows are swept by expiry, not deleted on use.';

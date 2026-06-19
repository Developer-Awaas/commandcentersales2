-- Phase 5: Realtime turn tracking, conversation history, and approved-decision memory.
--
-- Three tables:
--   agent_turns   — one row per aarav-orchestrate invocation; Realtime source
--                   for live delegation-status chips in the UI.
--   agent_messages — durable per-turn conversation record (user + aarav roles).
--   agent_memory  — approved campaign decisions; org+project scoped for recall.
--
-- All three: RLS SELECT for authenticated users (org-scoped); writes are
-- service-role only (enforced by absence of any authenticated INSERT/UPDATE
-- policy — the admin client in aarav-orchestrate always uses the service role).

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_turns
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_turns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    uuid        REFERENCES projects(id) ON DELETE SET NULL,
  session_id    text        NOT NULL,
  -- pending → working (chain running) → awaiting_user (ready for review)
  -- → approved / ready_to_launch (after Approve) → failed
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                              'pending','working','awaiting_user',
                              'approved','ready_to_launch','failed'
                            )),
  -- {"arjun":"pending|working|done|failed", "aanya":..., "diya":...}
  -- Updated after each specialist so Realtime subscribers see incremental progress.
  delegations   jsonb       NOT NULL DEFAULT '{"arjun":"pending","aanya":"pending","diya":"pending"}',
  canvas        jsonb,       -- AaravCanvas once chain finishes
  message       text,        -- Aarav's response text
  awaiting_user boolean     NOT NULL DEFAULT false,
  -- Non-null means Approve was called — idempotency sentinel for handleApprove.
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_turns_org_session ON agent_turns(org_id, session_id);
CREATE INDEX IF NOT EXISTS idx_agent_turns_updated     ON agent_turns(updated_at);

-- Auto-maintain updated_at so Realtime payloads always carry the freshest timestamp.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_agent_turns_updated_at'
  ) THEN
    CREATE FUNCTION set_agent_turns_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $fn$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'agent_turns_set_updated_at'
  ) THEN
    CREATE TRIGGER agent_turns_set_updated_at
      BEFORE UPDATE ON agent_turns
      FOR EACH ROW EXECUTE FUNCTION set_agent_turns_updated_at();
  END IF;
END $$;

ALTER TABLE agent_turns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_turns_org_select" ON agent_turns;
CREATE POLICY "agent_turns_org_select" ON agent_turns
  FOR SELECT TO authenticated
  USING (org_id = get_current_user_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_messages
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid        REFERENCES projects(id) ON DELETE SET NULL,
  session_id      text        NOT NULL,
  turn_id         uuid        REFERENCES agent_turns(id) ON DELETE SET NULL,
  role            text        NOT NULL CHECK (role IN ('user', 'aarav')),
  content         text        NOT NULL,
  -- Canvas snapshot so the record is self-contained for future recall queries.
  canvas_snapshot jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_org_session ON agent_messages(org_id, session_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_turn        ON agent_messages(turn_id);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_messages_org_select" ON agent_messages;
CREATE POLICY "agent_messages_org_select" ON agent_messages
  FOR SELECT TO authenticated
  USING (org_id = get_current_user_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_memory
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_memory (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         uuid        REFERENCES projects(id) ON DELETE SET NULL,
  turn_id            uuid        REFERENCES agent_turns(id) ON DELETE SET NULL,
  -- Enum guard for future memory categories beyond approved campaigns.
  memory_type        text        NOT NULL DEFAULT 'approved_campaign'
                                 CHECK (memory_type IN ('approved_campaign')),
  strategy           jsonb,       -- Arjun's StrategyConfig (with any user edits applied)
  selected_creatives jsonb,       -- the CreativeVariant(s) the user chose to approve
  brand_verdict      jsonb,       -- Diya's BrandVerdict for this batch
  -- One-liner for future similarity queries (no pgvector needed yet).
  summary            text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_org_project ON agent_memory(org_id, project_id);

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_memory_org_select" ON agent_memory;
CREATE POLICY "agent_memory_org_select" ON agent_memory
  FOR SELECT TO authenticated
  USING (org_id = get_current_user_org_id());

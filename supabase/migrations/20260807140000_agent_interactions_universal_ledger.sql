-- Universal cost ledger: extend agent_interactions to be the single row-per-
-- external-API-call ledger for EVERY provider call in the app, not just the
-- LeadGen-V2 agent pipeline. No parallel tables (the old ai_sessions token
-- log stays for the legacy Strategy/Creatives session view, but cost/usd
-- attribution now lives here for everything).
--
-- Additive only (never destructive). New columns are all nullable so existing
-- agent-pipeline inserts (aarav-orchestrate/specialists) keep working
-- untouched — those rows attribute via `agent`; new non-agent rows attribute
-- via `feature` + `provider`. The Usage surface coalesces feature = COALESCE(feature, agent).
--
-- Backfill nothing — new writes only (existing rows keep NULL in the new columns).

-- 1) agent becomes nullable-with-meaning: a NULL agent means "not an Aarav
--    specialist call" (a client Claude/image call, a cron, etc.) and `feature`
--    carries the attribution instead.
DO $$ BEGIN
  ALTER TABLE agent_interactions ALTER COLUMN agent DROP NOT NULL;
  ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_agent_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_agent_check
    CHECK (agent IS NULL OR agent IN ('aarav', 'arjun', 'aanya', 'diya', 'kavya', 'dhruv'));
END $$;

-- 2) New attribution + accounting columns (all nullable, additive).
--    cost_usd also becomes nullable so an unknown-model call logs the row with
--    a genuine NULL cost (spec: "unknown model -> log with cost NULL + warn,
--    never silently skip the row") rather than a misleading 0. Readers COALESCE.
DO $$ BEGIN
  ALTER TABLE agent_interactions ALTER COLUMN cost_usd DROP NOT NULL;
  ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS provider text;
  ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS call_type text;
  ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS feature text;
  ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
  ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS image_count integer;
  ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS unit_cost_usd numeric(10, 6);
END $$;

-- Constrain the two low-cardinality enum-ish columns (NULL always allowed).
DO $$ BEGIN
  ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_provider_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_provider_check
    CHECK (provider IS NULL OR provider IN ('anthropic', 'openai', 'gemini'));
  ALTER TABLE agent_interactions DROP CONSTRAINT IF EXISTS agent_interactions_call_type_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_call_type_check
    CHECK (call_type IS NULL OR call_type IN ('text', 'image_gen', 'image_edit', 'vision'));
END $$;

-- feature is queried in the Usage surface's "by feature" aggregate over a
-- month window; org_id + created_at are already indexed, so a composite that
-- covers the common (org, created_at, feature) grouping keeps those reads
-- index-only without a second scan.
CREATE INDEX IF NOT EXISTS idx_agent_interactions_org_created_feature
  ON agent_interactions (org_id, created_at, feature);

-- 3) Client write path. Until now rows were written ONLY by the service role
--    (aarav-orchestrate) and RLS had a SELECT-only policy. Client-side calls
--    (ai-service.ts / gemini-service.ts) now log their own cost rows the same
--    way ai_sessions is already client-written — so authenticated users need an
--    org-scoped INSERT policy (same shape ai_sessions/tool_outputs already have).
--    user_id must be the caller's own (or NULL for a service context); org_id
--    must be the caller's org. Cannot forge another org's rows.
DROP POLICY IF EXISTS "Org members insert their own agent interactions" ON agent_interactions;
CREATE POLICY "Org members insert their own agent interactions"
  ON agent_interactions FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = get_current_user_org_id()
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

-- 4) Server-side chatbot daily cap (STEP 4). SECURITY DEFINER so the COUNT is
--    computed in Postgres over the caller's own org (never a client-trusted
--    number) — strictly better than the bypassable localStorage 30/day. Returns
--    true when the caller is UNDER the cap (ok to proceed).
CREATE OR REPLACE FUNCTION check_daily_feature_cap(p_feature text, p_cap integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := get_current_user_org_id();
  v_count integer;
BEGIN
  IF v_org IS NULL THEN
    RETURN false;
  END IF;
  SELECT count(*) INTO v_count
  FROM agent_interactions
  WHERE org_id = v_org
    AND feature = p_feature
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  RETURN v_count < p_cap;
END;
$$;

REVOKE ALL ON FUNCTION check_daily_feature_cap(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION check_daily_feature_cap(text, integer) TO authenticated;

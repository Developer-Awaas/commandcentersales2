/*
  # Fix RLS policies for v2.1 orphan tables (pre-pilot Phase 1)

  ## Problem
  Same as 20260411070209_fix_rls_for_anon_dev_access: the app uses the anon key
  without auth context for many app-data writes. Tables added after that migration
  (or never migrated at all via tracked SQL) have RLS enabled but no anon-compatible
  policies, blocking INSERT/UPDATE/DELETE with code 42501.

  ## Confirmed broken at runtime
  - smm_metrics: "new row violates row-level security policy for table smm_metrics"

  ## Likely broken (same pattern, scoped from grep of src/)
  - smm_calendar, events_calendar, wizard_sessions, awaas_data_pool, chatbot_log,
    competitors, creatives, organic_plans, organizations, project_assets,
    targeting_keywords, brand_kits, project_design_systems

  ## SELECT-only
  - lead_funnel (no writes from code; just needs anon read access)

  ## Explicitly excluded
  - profiles (security-critical identity table; needs auth.uid()-based policies,
    not blanket anon. Treat any profile RLS issue as a separate fix.)

  ## Pattern
  - Each table block wrapped in DO $$ BEGIN ... EXCEPTION WHEN undefined_table THEN NULL END $$
    so missing tables don't abort the migration (some may not exist yet — Bolt-rendered
    schema may have diverged from tracked migrations).
  - ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent (re-enable is a no-op).
  - DROP POLICY IF EXISTS for both the old "*_org_isolation" name (from the dropped
    pattern) and the names we're about to create, so the migration is re-runnable.
  - CREATE POLICY scoped to {anon, authenticated} with USING/CHECK = true, mirroring
    the existing 20260411070209 fix migration's pattern exactly.
*/

-- smm_metrics (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE smm_metrics ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "smm_metrics_org_isolation" ON smm_metrics;
  DROP POLICY IF EXISTS "Allow anon select smm_metrics" ON smm_metrics;
  DROP POLICY IF EXISTS "Allow anon insert smm_metrics" ON smm_metrics;
  DROP POLICY IF EXISTS "Allow anon update smm_metrics" ON smm_metrics;
  CREATE POLICY "Allow anon select smm_metrics" ON smm_metrics FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert smm_metrics" ON smm_metrics FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update smm_metrics" ON smm_metrics FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- smm_calendar (SELECT, INSERT, UPDATE, DELETE)
DO $$
BEGIN
  ALTER TABLE smm_calendar ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "smm_calendar_org_isolation" ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon select smm_calendar" ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon insert smm_calendar" ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon update smm_calendar" ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon delete smm_calendar" ON smm_calendar;
  CREATE POLICY "Allow anon select smm_calendar" ON smm_calendar FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert smm_calendar" ON smm_calendar FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update smm_calendar" ON smm_calendar FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow anon delete smm_calendar" ON smm_calendar FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- events_calendar (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE events_calendar ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "events_calendar_org_isolation" ON events_calendar;
  DROP POLICY IF EXISTS "Allow anon select events_calendar" ON events_calendar;
  DROP POLICY IF EXISTS "Allow anon insert events_calendar" ON events_calendar;
  DROP POLICY IF EXISTS "Allow anon update events_calendar" ON events_calendar;
  CREATE POLICY "Allow anon select events_calendar" ON events_calendar FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert events_calendar" ON events_calendar FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update events_calendar" ON events_calendar FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- wizard_sessions (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE wizard_sessions ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "wizard_sessions_org_isolation" ON wizard_sessions;
  DROP POLICY IF EXISTS "Allow anon select wizard_sessions" ON wizard_sessions;
  DROP POLICY IF EXISTS "Allow anon insert wizard_sessions" ON wizard_sessions;
  DROP POLICY IF EXISTS "Allow anon update wizard_sessions" ON wizard_sessions;
  CREATE POLICY "Allow anon select wizard_sessions" ON wizard_sessions FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert wizard_sessions" ON wizard_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update wizard_sessions" ON wizard_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- awaas_data_pool (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE awaas_data_pool ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "awaas_data_pool_org_isolation" ON awaas_data_pool;
  DROP POLICY IF EXISTS "Allow anon select awaas_data_pool" ON awaas_data_pool;
  DROP POLICY IF EXISTS "Allow anon insert awaas_data_pool" ON awaas_data_pool;
  DROP POLICY IF EXISTS "Allow anon update awaas_data_pool" ON awaas_data_pool;
  CREATE POLICY "Allow anon select awaas_data_pool" ON awaas_data_pool FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert awaas_data_pool" ON awaas_data_pool FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update awaas_data_pool" ON awaas_data_pool FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- chatbot_log (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE chatbot_log ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "chatbot_log_org_isolation" ON chatbot_log;
  DROP POLICY IF EXISTS "Allow anon select chatbot_log" ON chatbot_log;
  DROP POLICY IF EXISTS "Allow anon insert chatbot_log" ON chatbot_log;
  DROP POLICY IF EXISTS "Allow anon update chatbot_log" ON chatbot_log;
  CREATE POLICY "Allow anon select chatbot_log" ON chatbot_log FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert chatbot_log" ON chatbot_log FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update chatbot_log" ON chatbot_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- competitors (SELECT, INSERT, UPDATE, DELETE)
DO $$
BEGIN
  ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "competitors_org_isolation" ON competitors;
  DROP POLICY IF EXISTS "Allow anon select competitors" ON competitors;
  DROP POLICY IF EXISTS "Allow anon insert competitors" ON competitors;
  DROP POLICY IF EXISTS "Allow anon update competitors" ON competitors;
  DROP POLICY IF EXISTS "Allow anon delete competitors" ON competitors;
  CREATE POLICY "Allow anon select competitors" ON competitors FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert competitors" ON competitors FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update competitors" ON competitors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow anon delete competitors" ON competitors FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- creatives (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE creatives ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "creatives_org_isolation" ON creatives;
  DROP POLICY IF EXISTS "Allow anon select creatives" ON creatives;
  DROP POLICY IF EXISTS "Allow anon insert creatives" ON creatives;
  DROP POLICY IF EXISTS "Allow anon update creatives" ON creatives;
  CREATE POLICY "Allow anon select creatives" ON creatives FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert creatives" ON creatives FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update creatives" ON creatives FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- organic_plans (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE organic_plans ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "organic_plans_org_isolation" ON organic_plans;
  DROP POLICY IF EXISTS "Allow anon select organic_plans" ON organic_plans;
  DROP POLICY IF EXISTS "Allow anon insert organic_plans" ON organic_plans;
  DROP POLICY IF EXISTS "Allow anon update organic_plans" ON organic_plans;
  CREATE POLICY "Allow anon select organic_plans" ON organic_plans FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert organic_plans" ON organic_plans FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update organic_plans" ON organic_plans FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- organizations (SELECT, INSERT, UPDATE)
-- NOTE: organizations carries org identity. Anon-write is acceptable for the
-- pilot dev pattern but should be replaced with auth.uid()-scoped policies
-- before any multi-tenant production deployment.
DO $$
BEGIN
  ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "organizations_org_isolation" ON organizations;
  DROP POLICY IF EXISTS "Allow anon select organizations" ON organizations;
  DROP POLICY IF EXISTS "Allow anon insert organizations" ON organizations;
  DROP POLICY IF EXISTS "Allow anon update organizations" ON organizations;
  CREATE POLICY "Allow anon select organizations" ON organizations FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert organizations" ON organizations FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update organizations" ON organizations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- project_assets (SELECT, INSERT, UPDATE, DELETE)
DO $$
BEGIN
  ALTER TABLE project_assets ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "project_assets_org_isolation" ON project_assets;
  DROP POLICY IF EXISTS "Allow anon select project_assets" ON project_assets;
  DROP POLICY IF EXISTS "Allow anon insert project_assets" ON project_assets;
  DROP POLICY IF EXISTS "Allow anon update project_assets" ON project_assets;
  DROP POLICY IF EXISTS "Allow anon delete project_assets" ON project_assets;
  CREATE POLICY "Allow anon select project_assets" ON project_assets FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert project_assets" ON project_assets FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update project_assets" ON project_assets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow anon delete project_assets" ON project_assets FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- targeting_keywords (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE targeting_keywords ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "targeting_keywords_org_isolation" ON targeting_keywords;
  DROP POLICY IF EXISTS "Allow anon select targeting_keywords" ON targeting_keywords;
  DROP POLICY IF EXISTS "Allow anon insert targeting_keywords" ON targeting_keywords;
  DROP POLICY IF EXISTS "Allow anon update targeting_keywords" ON targeting_keywords;
  CREATE POLICY "Allow anon select targeting_keywords" ON targeting_keywords FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert targeting_keywords" ON targeting_keywords FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update targeting_keywords" ON targeting_keywords FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- brand_kits (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "brand_kits_org_isolation" ON brand_kits;
  DROP POLICY IF EXISTS "Allow anon select brand_kits" ON brand_kits;
  DROP POLICY IF EXISTS "Allow anon insert brand_kits" ON brand_kits;
  DROP POLICY IF EXISTS "Allow anon update brand_kits" ON brand_kits;
  CREATE POLICY "Allow anon select brand_kits" ON brand_kits FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert brand_kits" ON brand_kits FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update brand_kits" ON brand_kits FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- project_design_systems (SELECT, INSERT, UPDATE)
DO $$
BEGIN
  ALTER TABLE project_design_systems ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "project_design_systems_org_isolation" ON project_design_systems;
  DROP POLICY IF EXISTS "Allow anon select project_design_systems" ON project_design_systems;
  DROP POLICY IF EXISTS "Allow anon insert project_design_systems" ON project_design_systems;
  DROP POLICY IF EXISTS "Allow anon update project_design_systems" ON project_design_systems;
  CREATE POLICY "Allow anon select project_design_systems" ON project_design_systems FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert project_design_systems" ON project_design_systems FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update project_design_systems" ON project_design_systems FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- lead_funnel (SELECT only)
DO $$
BEGIN
  ALTER TABLE lead_funnel ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "lead_funnel_org_isolation" ON lead_funnel;
  DROP POLICY IF EXISTS "Allow anon select lead_funnel" ON lead_funnel;
  CREATE POLICY "Allow anon select lead_funnel" ON lead_funnel FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

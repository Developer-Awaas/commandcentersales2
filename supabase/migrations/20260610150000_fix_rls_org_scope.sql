-- ============================================================
-- SECURITY: Replace all open USING(true) RLS policies with
-- org_id-scoped policies, and block profile privilege escalation.
--
-- Also removes anon-role access from all data tables — only
-- authenticated users should reach org data.
-- ============================================================

-- Helper: returns the org_id for the currently authenticated user.
-- SECURITY DEFINER so it can read profiles even when the caller's
-- SELECT policy only covers their own row.
CREATE OR REPLACE FUNCTION get_current_user_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- 1. PROFILES — admin visibility + privilege escalation guard
-- ============================================================

-- Drop existing policies (replaced below)
DROP POLICY IF EXISTS "Users can view own profile"     ON profiles;
DROP POLICY IF EXISTS "Users can update own profile"   ON profiles;
DROP POLICY IF EXISTS "Admins can update org profiles" ON profiles;
DROP POLICY IF EXISTS "Org members can view org profiles" ON profiles;

-- All org members can see every profile in their org (needed by UserManagement)
CREATE POLICY "Org members can view org profiles"
  ON profiles FOR SELECT TO authenticated
  USING (org_id = get_current_user_org_id());

-- Users can update their own non-security fields (trigger below blocks role/module_access)
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Admins can update any profile in their org (for UserManagement page)
CREATE POLICY "Admins can update org profiles"
  ON profiles FOR UPDATE TO authenticated
  USING (
    org_id = get_current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (org_id = get_current_user_org_id());

-- ── Privilege escalation trigger ──────────────────────────────
-- Blocks any user from changing their OWN role, module_access,
-- daily_ai_limit, or org_id via the client (anon key).
-- Admin-to-other-user updates (NEW.id != auth.uid()) are allowed
-- and are already org-scoped by the policy above.
CREATE OR REPLACE FUNCTION prevent_self_privilege_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id = auth.uid() THEN
    IF (NEW.role           IS DISTINCT FROM OLD.role           OR
        NEW.module_access  IS DISTINCT FROM OLD.module_access  OR
        NEW.daily_ai_limit IS DISTINCT FROM OLD.daily_ai_limit OR
        NEW.org_id         IS DISTINCT FROM OLD.org_id) THEN
      RAISE EXCEPTION 'Cannot modify your own role, permissions, or org membership';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_privilege_escalation ON profiles;
CREATE TRIGGER trg_prevent_self_privilege_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_self_privilege_escalation();

-- ============================================================
-- 2. ORGANIZATIONS — scope to own org only
-- ============================================================
DROP POLICY IF EXISTS "Allow anon select organizations" ON organizations;
DROP POLICY IF EXISTS "Allow anon insert organizations" ON organizations;
DROP POLICY IF EXISTS "Allow anon update organizations" ON organizations;

CREATE POLICY "Allow select organizations"
  ON organizations FOR SELECT TO authenticated
  USING (id = get_current_user_org_id());

CREATE POLICY "Allow update organizations"
  ON organizations FOR UPDATE TO authenticated
  USING (id = get_current_user_org_id())
  WITH CHECK (id = get_current_user_org_id());

-- ============================================================
-- 3. CORE TABLES (projects, campaigns, daily_metrics, etc.)
-- ============================================================

DO $$ BEGIN

  -- projects
  DROP POLICY IF EXISTS "Allow anon select projects"  ON projects;
  DROP POLICY IF EXISTS "Allow anon insert projects"  ON projects;
  DROP POLICY IF EXISTS "Allow anon update projects"  ON projects;
  DROP POLICY IF EXISTS "Allow anon delete projects"  ON projects;
  CREATE POLICY "Allow select projects" ON projects FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert projects" ON projects FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update projects" ON projects FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow delete projects" ON projects FOR DELETE TO authenticated
    USING (org_id = get_current_user_org_id());

  -- campaigns
  DROP POLICY IF EXISTS "Allow anon select campaigns"  ON campaigns;
  DROP POLICY IF EXISTS "Allow anon insert campaigns"  ON campaigns;
  DROP POLICY IF EXISTS "Allow anon update campaigns"  ON campaigns;
  DROP POLICY IF EXISTS "Allow anon delete campaigns"  ON campaigns;
  CREATE POLICY "Allow select campaigns" ON campaigns FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert campaigns" ON campaigns FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update campaigns" ON campaigns FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow delete campaigns" ON campaigns FOR DELETE TO authenticated
    USING (org_id = get_current_user_org_id());

  -- daily_metrics
  DROP POLICY IF EXISTS "Allow anon select daily_metrics"  ON daily_metrics;
  DROP POLICY IF EXISTS "Allow anon insert daily_metrics"  ON daily_metrics;
  DROP POLICY IF EXISTS "Allow anon update daily_metrics"  ON daily_metrics;
  CREATE POLICY "Allow select daily_metrics" ON daily_metrics FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert daily_metrics" ON daily_metrics FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update daily_metrics" ON daily_metrics FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- notifications (scoped to user AND org)
  DROP POLICY IF EXISTS "Allow anon select notifications"  ON notifications;
  DROP POLICY IF EXISTS "Allow anon insert notifications"  ON notifications;
  DROP POLICY IF EXISTS "Allow anon update notifications"  ON notifications;
  CREATE POLICY "Allow select notifications" ON notifications FOR SELECT TO authenticated
    USING (user_id = auth.uid());
  CREATE POLICY "Allow insert notifications" ON notifications FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update notifications" ON notifications FOR UPDATE TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

  -- ai_sessions
  DROP POLICY IF EXISTS "Allow anon select ai_sessions"  ON ai_sessions;
  DROP POLICY IF EXISTS "Allow anon insert ai_sessions"  ON ai_sessions;
  DROP POLICY IF EXISTS "Allow anon update ai_sessions"  ON ai_sessions;
  CREATE POLICY "Allow select ai_sessions" ON ai_sessions FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert ai_sessions" ON ai_sessions FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update ai_sessions" ON ai_sessions FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- activity_log
  DROP POLICY IF EXISTS "Allow anon select activity_log"  ON activity_log;
  DROP POLICY IF EXISTS "Allow anon insert activity_log"  ON activity_log;
  CREATE POLICY "Allow select activity_log" ON activity_log FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert activity_log" ON activity_log FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());

  -- targeting_keywords
  DROP POLICY IF EXISTS "Allow anon select targeting_keywords"  ON targeting_keywords;
  DROP POLICY IF EXISTS "Allow anon insert targeting_keywords"  ON targeting_keywords;
  DROP POLICY IF EXISTS "Allow anon update targeting_keywords"  ON targeting_keywords;
  DROP POLICY IF EXISTS "Allow anon delete targeting_keywords"  ON targeting_keywords;
  CREATE POLICY "Allow select targeting_keywords" ON targeting_keywords FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert targeting_keywords" ON targeting_keywords FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update targeting_keywords" ON targeting_keywords FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow delete targeting_keywords" ON targeting_keywords FOR DELETE TO authenticated
    USING (org_id = get_current_user_org_id());

  -- chatbot_log (org_id is text — cast for comparison)
  DROP POLICY IF EXISTS "Allow anon select chatbot_log"  ON chatbot_log;
  DROP POLICY IF EXISTS "Allow anon insert chatbot_log"  ON chatbot_log;
  CREATE POLICY "Allow select chatbot_log" ON chatbot_log FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id()::text);
  CREATE POLICY "Allow insert chatbot_log" ON chatbot_log FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id()::text);

EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ============================================================
-- 4. INTEGRATION TABLES
-- ============================================================

DO $$ BEGIN

  -- campaign_metrics
  DROP POLICY IF EXISTS "Allow anon select campaign_metrics"  ON campaign_metrics;
  DROP POLICY IF EXISTS "Allow anon insert campaign_metrics"  ON campaign_metrics;
  DROP POLICY IF EXISTS "Allow anon update campaign_metrics"  ON campaign_metrics;
  CREATE POLICY "Allow select campaign_metrics" ON campaign_metrics FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert campaign_metrics" ON campaign_metrics FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update campaign_metrics" ON campaign_metrics FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- creative_assets
  DROP POLICY IF EXISTS "Allow anon select creative_assets"  ON creative_assets;
  DROP POLICY IF EXISTS "Allow anon insert creative_assets"  ON creative_assets;
  DROP POLICY IF EXISTS "Allow anon update creative_assets"  ON creative_assets;
  CREATE POLICY "Allow select creative_assets" ON creative_assets FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert creative_assets" ON creative_assets FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update creative_assets" ON creative_assets FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- org_integrations
  DROP POLICY IF EXISTS "Allow anon select org_integrations"  ON org_integrations;
  DROP POLICY IF EXISTS "Allow anon insert org_integrations"  ON org_integrations;
  DROP POLICY IF EXISTS "Allow anon update org_integrations"  ON org_integrations;
  CREATE POLICY "Allow select org_integrations" ON org_integrations FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert org_integrations" ON org_integrations FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update org_integrations" ON org_integrations FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- org_user_integrations (per-user OAuth tokens — scoped to user AND org)
  DROP POLICY IF EXISTS "Allow anon select org_user_integrations"  ON org_user_integrations;
  DROP POLICY IF EXISTS "Allow anon insert org_user_integrations"  ON org_user_integrations;
  DROP POLICY IF EXISTS "Allow anon update org_user_integrations"  ON org_user_integrations;
  CREATE POLICY "Allow select org_user_integrations" ON org_user_integrations FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id() AND user_id = auth.uid());
  CREATE POLICY "Allow insert org_user_integrations" ON org_user_integrations FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id() AND user_id = auth.uid());
  CREATE POLICY "Allow update org_user_integrations" ON org_user_integrations FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id() AND user_id = auth.uid())
    WITH CHECK (org_id = get_current_user_org_id() AND user_id = auth.uid());

  -- integration_sync_log (read-only from client; writes via edge functions with service role)
  DROP POLICY IF EXISTS "Allow anon select integration_sync_log"  ON integration_sync_log;
  DROP POLICY IF EXISTS "Allow anon insert integration_sync_log"  ON integration_sync_log;
  CREATE POLICY "Allow select integration_sync_log" ON integration_sync_log FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());

EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ============================================================
-- 5. BOLT/SMM TABLES
-- ============================================================

DO $$ BEGIN

  -- competitors
  DROP POLICY IF EXISTS "Allow anon select competitors"  ON competitors;
  DROP POLICY IF EXISTS "Allow anon insert competitors"  ON competitors;
  DROP POLICY IF EXISTS "Allow anon update competitors"  ON competitors;
  DROP POLICY IF EXISTS "Allow anon delete competitors"  ON competitors;
  CREATE POLICY "Allow select competitors" ON competitors FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert competitors" ON competitors FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update competitors" ON competitors FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow delete competitors" ON competitors FOR DELETE TO authenticated
    USING (org_id = get_current_user_org_id());

  -- brand_kits
  DROP POLICY IF EXISTS "Allow anon select brand_kits"  ON brand_kits;
  DROP POLICY IF EXISTS "Allow anon insert brand_kits"  ON brand_kits;
  DROP POLICY IF EXISTS "Allow anon update brand_kits"  ON brand_kits;
  CREATE POLICY "Allow select brand_kits" ON brand_kits FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert brand_kits" ON brand_kits FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update brand_kits" ON brand_kits FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- lead_funnel
  DROP POLICY IF EXISTS "Allow anon select lead_funnel"  ON lead_funnel;
  DROP POLICY IF EXISTS "Allow anon insert lead_funnel"  ON lead_funnel;
  DROP POLICY IF EXISTS "Allow anon update lead_funnel"  ON lead_funnel;
  CREATE POLICY "Allow select lead_funnel" ON lead_funnel FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert lead_funnel" ON lead_funnel FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update lead_funnel" ON lead_funnel FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- organic_plans
  DROP POLICY IF EXISTS "Allow anon select organic_plans"  ON organic_plans;
  DROP POLICY IF EXISTS "Allow anon insert organic_plans"  ON organic_plans;
  DROP POLICY IF EXISTS "Allow anon update organic_plans"  ON organic_plans;
  CREATE POLICY "Allow select organic_plans" ON organic_plans FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert organic_plans" ON organic_plans FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update organic_plans" ON organic_plans FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- events_calendar
  DROP POLICY IF EXISTS "Allow anon select events_calendar"  ON events_calendar;
  DROP POLICY IF EXISTS "Allow anon insert events_calendar"  ON events_calendar;
  DROP POLICY IF EXISTS "Allow anon update events_calendar"  ON events_calendar;
  CREATE POLICY "Allow select events_calendar" ON events_calendar FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert events_calendar" ON events_calendar FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update events_calendar" ON events_calendar FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- smm_calendar
  DROP POLICY IF EXISTS "Allow anon select smm_calendar"  ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon insert smm_calendar"  ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon update smm_calendar"  ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon delete smm_calendar"  ON smm_calendar;
  CREATE POLICY "Allow select smm_calendar" ON smm_calendar FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert smm_calendar" ON smm_calendar FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update smm_calendar" ON smm_calendar FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow delete smm_calendar" ON smm_calendar FOR DELETE TO authenticated
    USING (org_id = get_current_user_org_id());

  -- smm_metrics
  DROP POLICY IF EXISTS "Allow anon select smm_metrics"  ON smm_metrics;
  DROP POLICY IF EXISTS "Allow anon insert smm_metrics"  ON smm_metrics;
  DROP POLICY IF EXISTS "Allow anon update smm_metrics"  ON smm_metrics;
  CREATE POLICY "Allow select smm_metrics" ON smm_metrics FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert smm_metrics" ON smm_metrics FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update smm_metrics" ON smm_metrics FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- wizard_sessions
  DROP POLICY IF EXISTS "Allow anon select wizard_sessions"  ON wizard_sessions;
  DROP POLICY IF EXISTS "Allow anon insert wizard_sessions"  ON wizard_sessions;
  DROP POLICY IF EXISTS "Allow anon update wizard_sessions"  ON wizard_sessions;
  CREATE POLICY "Allow select wizard_sessions" ON wizard_sessions FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert wizard_sessions" ON wizard_sessions FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update wizard_sessions" ON wizard_sessions FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- project_assets
  DROP POLICY IF EXISTS "Allow anon select project_assets"  ON project_assets;
  DROP POLICY IF EXISTS "Allow anon insert project_assets"  ON project_assets;
  DROP POLICY IF EXISTS "Allow anon update project_assets"  ON project_assets;
  DROP POLICY IF EXISTS "Allow anon delete project_assets"  ON project_assets;
  CREATE POLICY "Allow select project_assets" ON project_assets FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert project_assets" ON project_assets FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update project_assets" ON project_assets FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow delete project_assets" ON project_assets FOR DELETE TO authenticated
    USING (org_id = get_current_user_org_id());

  -- project_design_systems
  DROP POLICY IF EXISTS "Allow anon select project_design_systems"  ON project_design_systems;
  DROP POLICY IF EXISTS "Allow anon insert project_design_systems"  ON project_design_systems;
  DROP POLICY IF EXISTS "Allow anon update project_design_systems"  ON project_design_systems;
  CREATE POLICY "Allow select project_design_systems" ON project_design_systems FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert project_design_systems" ON project_design_systems FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update project_design_systems" ON project_design_systems FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- benchmarks
  DROP POLICY IF EXISTS "Allow anon select benchmarks"  ON benchmarks;
  DROP POLICY IF EXISTS "Allow anon insert benchmarks"  ON benchmarks;
  DROP POLICY IF EXISTS "Allow anon update benchmarks"  ON benchmarks;
  CREATE POLICY "Allow select benchmarks" ON benchmarks FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert benchmarks" ON benchmarks FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update benchmarks" ON benchmarks FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- creatives
  DROP POLICY IF EXISTS "Allow anon select creatives"  ON creatives;
  DROP POLICY IF EXISTS "Allow anon insert creatives"  ON creatives;
  DROP POLICY IF EXISTS "Allow anon update creatives"  ON creatives;
  CREATE POLICY "Allow select creatives" ON creatives FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert creatives" ON creatives FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update creatives" ON creatives FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

  -- creative_performance
  DROP POLICY IF EXISTS "Allow anon select creative_performance"  ON creative_performance;
  DROP POLICY IF EXISTS "Allow anon insert creative_performance"  ON creative_performance;
  DROP POLICY IF EXISTS "Allow anon update creative_performance"  ON creative_performance;
  CREATE POLICY "Allow select creative_performance" ON creative_performance FOR SELECT TO authenticated
    USING (org_id = get_current_user_org_id());
  CREATE POLICY "Allow insert creative_performance" ON creative_performance FOR INSERT TO authenticated
    WITH CHECK (org_id = get_current_user_org_id());
  CREATE POLICY "Allow update creative_performance" ON creative_performance FOR UPDATE TO authenticated
    USING (org_id = get_current_user_org_id()) WITH CHECK (org_id = get_current_user_org_id());

EXCEPTION WHEN undefined_table THEN NULL;
END $$;

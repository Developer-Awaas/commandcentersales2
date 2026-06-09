/*
  # Create tables missing from tracked migrations

  These tables existed only in the live Supabase project (created by the
  Bolt scaffolding tool without generating migration files). This migration
  makes the schema portable and runnable from a clean Supabase project.

  Tables added (all use IF NOT EXISTS — safe to re-run):
    competitors, brand_kits, lead_funnel, organic_plans, events_calendar,
    smm_calendar, smm_metrics, wizard_sessions, project_assets,
    project_design_systems, benchmarks, creatives, creative_performance

  RLS: all tables follow the project pattern —
    anon + authenticated can SELECT / INSERT / UPDATE (org_id filtering done
    in application layer, not DB layer, for the pilot phase).
    DELETE only on tables where the app performs deletes.
*/

-- ─────────────────────────────────────────────
-- competitors
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid,
  name       text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select competitors"  ON competitors;
  DROP POLICY IF EXISTS "Allow anon insert competitors"  ON competitors;
  DROP POLICY IF EXISTS "Allow anon update competitors"  ON competitors;
  DROP POLICY IF EXISTS "Allow anon delete competitors"  ON competitors;
  CREATE POLICY "Allow anon select competitors"  ON competitors FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert competitors"  ON competitors FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update competitors"  ON competitors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow anon delete competitors"  ON competitors FOR DELETE TO anon, authenticated USING (true);
END $$;

-- ─────────────────────────────────────────────
-- brand_kits  (one row per org)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_kits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid UNIQUE,
  primary_color       text DEFAULT '#1B4332',
  secondary_color     text DEFAULT '#2DD4A8',
  accent_color        text DEFAULT '#FFFFFF',
  text_color          text DEFAULT '#111827',
  background_color    text DEFAULT '#F9FAFB',
  primary_font        text DEFAULT 'Inter',
  secondary_font      text DEFAULT 'Inter',
  display_font        text DEFAULT 'Inter',
  tagline             text DEFAULT '',
  brand_voice         text DEFAULT '',
  brand_story         text DEFAULT '',
  logo_color_url      text DEFAULT '',
  logo_white_url      text DEFAULT '',
  logo_dark_url       text DEFAULT '',
  design_aesthetic    text DEFAULT 'premium_minimal'
                      CHECK (design_aesthetic IN (
                        'premium_minimal','luxury_opulent','warm_aspirational',
                        'contemporary_urban','custom'
                      )),
  cultural_motifs     text[] DEFAULT ARRAY[]::text[],
  reference_brands    text[] DEFAULT ARRAY[]::text[],
  default_languages   text[] DEFAULT ARRAY['en']::text[],
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select brand_kits" ON brand_kits;
  DROP POLICY IF EXISTS "Allow anon insert brand_kits" ON brand_kits;
  DROP POLICY IF EXISTS "Allow anon update brand_kits" ON brand_kits;
  CREATE POLICY "Allow anon select brand_kits" ON brand_kits FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert brand_kits" ON brand_kits FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update brand_kits" ON brand_kits FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- lead_funnel  (weekly funnel metrics)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_funnel (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid,
  week_start  date NOT NULL DEFAULT CURRENT_DATE,
  total_leads int  DEFAULT 0,
  contacted   int  DEFAULT 0,
  sv_done     int  DEFAULT 0,
  booked      int  DEFAULT 0
);

ALTER TABLE lead_funnel ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select lead_funnel" ON lead_funnel;
  DROP POLICY IF EXISTS "Allow anon insert lead_funnel" ON lead_funnel;
  DROP POLICY IF EXISTS "Allow anon update lead_funnel" ON lead_funnel;
  CREATE POLICY "Allow anon select lead_funnel" ON lead_funnel FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert lead_funnel" ON lead_funnel FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update lead_funnel" ON lead_funnel FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- organic_plans  (AI-generated weekly social plans)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organic_plans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid,
  week_start date NOT NULL DEFAULT CURRENT_DATE,
  status     text DEFAULT 'draft'
             CHECK (status IN ('draft','published')),
  plan_data  jsonb DEFAULT '{}'::jsonb,
  pillars    jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE organic_plans ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select organic_plans" ON organic_plans;
  DROP POLICY IF EXISTS "Allow anon insert organic_plans" ON organic_plans;
  DROP POLICY IF EXISTS "Allow anon update organic_plans" ON organic_plans;
  CREATE POLICY "Allow anon select organic_plans" ON organic_plans FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert organic_plans" ON organic_plans FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update organic_plans" ON organic_plans FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- events_calendar  (holidays, festivals, custom)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events_calendar (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid,
  name            text NOT NULL DEFAULT '',
  date            date NOT NULL DEFAULT CURRENT_DATE,
  type            text DEFAULT 'custom'
                  CHECK (type IN ('holiday','festival','custom')),
  include_in_plan boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE events_calendar ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select events_calendar" ON events_calendar;
  DROP POLICY IF EXISTS "Allow anon insert events_calendar" ON events_calendar;
  DROP POLICY IF EXISTS "Allow anon update events_calendar" ON events_calendar;
  CREATE POLICY "Allow anon select events_calendar" ON events_calendar FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert events_calendar" ON events_calendar FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update events_calendar" ON events_calendar FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- smm_calendar  (scheduled social posts)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS smm_calendar (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid,
  post_date   date NOT NULL DEFAULT CURRENT_DATE,
  post_time   time DEFAULT '09:00',
  platform    text DEFAULT 'instagram'
              CHECK (platform IN ('instagram','facebook','both')),
  post_type   text DEFAULT 'static'
              CHECK (post_type IN ('reel','carousel','static','story','video')),
  category    text DEFAULT '',
  topic       text DEFAULT '',
  caption_en  text DEFAULT '',
  caption_od  text DEFAULT '',
  hashtags    text[] DEFAULT ARRAY[]::text[],
  nano_prompt text DEFAULT '',
  reel_script text DEFAULT '',
  status      text DEFAULT 'planned'
              CHECK (status IN ('planned','created','posted','skipped')),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE smm_calendar ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select smm_calendar" ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon insert smm_calendar" ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon update smm_calendar" ON smm_calendar;
  DROP POLICY IF EXISTS "Allow anon delete smm_calendar" ON smm_calendar;
  CREATE POLICY "Allow anon select smm_calendar" ON smm_calendar FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert smm_calendar" ON smm_calendar FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update smm_calendar" ON smm_calendar FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow anon delete smm_calendar" ON smm_calendar FOR DELETE TO anon, authenticated USING (true);
END $$;

-- ─────────────────────────────────────────────
-- smm_metrics  (daily social platform snapshots)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS smm_metrics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid,
  platform         text NOT NULL
                   CHECK (platform IN ('instagram','facebook')),
  date             date NOT NULL DEFAULT CURRENT_DATE,
  followers        int  DEFAULT 0,
  posts_published  int  DEFAULT 0,
  avg_reach        numeric DEFAULT 0,
  avg_likes        numeric DEFAULT 0,
  avg_comments     numeric DEFAULT 0,
  avg_saves        numeric DEFAULT 0,
  avg_shares       numeric DEFAULT 0,
  engagement_rate  numeric DEFAULT 0,
  profile_visits   int  DEFAULT 0,
  website_clicks   int  DEFAULT 0,
  follower_growth  int  DEFAULT 0,
  data_source      text DEFAULT 'manual'
                   CHECK (data_source IN ('manual','api_extracted')),
  created_at       timestamptz DEFAULT now(),
  UNIQUE (org_id, platform, date)
);

ALTER TABLE smm_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select smm_metrics" ON smm_metrics;
  DROP POLICY IF EXISTS "Allow anon insert smm_metrics" ON smm_metrics;
  DROP POLICY IF EXISTS "Allow anon update smm_metrics" ON smm_metrics;
  CREATE POLICY "Allow anon select smm_metrics" ON smm_metrics FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert smm_metrics" ON smm_metrics FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update smm_metrics" ON smm_metrics FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- wizard_sessions  (Campaign Wizard multi-step state)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wizard_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid,
  status       text DEFAULT 'in_progress'
               CHECK (status IN ('in_progress','completed','abandoned')),
  current_step int  DEFAULT 1,
  step_data    jsonb DEFAULT '{}'::jsonb,
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE wizard_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select wizard_sessions" ON wizard_sessions;
  DROP POLICY IF EXISTS "Allow anon insert wizard_sessions" ON wizard_sessions;
  DROP POLICY IF EXISTS "Allow anon update wizard_sessions" ON wizard_sessions;
  CREATE POLICY "Allow anon select wizard_sessions" ON wizard_sessions FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert wizard_sessions" ON wizard_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update wizard_sessions" ON wizard_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- project_assets  (reference images per project)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid REFERENCES projects(id) ON DELETE CASCADE,
  org_id        uuid,
  asset_type    text DEFAULT 'other'
                CHECK (asset_type IN (
                  'project_logo','hero_exterior','hero_night',
                  'interior_living','interior_kitchen','interior_bedroom','interior_bathroom',
                  'amenity_gym','amenity_terrace','amenity_garden','amenity_lobby',
                  'amenity_pool','amenity_clubhouse',
                  'floor_plan','site_plan','location_map',
                  'lifestyle_family','lifestyle_couple','lifestyle_individual',
                  'construction_progress','walkthrough_still','mood_reference','other'
                )),
  asset_url     text DEFAULT '',
  thumbnail_url text DEFAULT '',
  title         text DEFAULT '',
  description   text DEFAULT '',
  is_primary    boolean DEFAULT false,
  display_order int     DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE project_assets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select project_assets" ON project_assets;
  DROP POLICY IF EXISTS "Allow anon insert project_assets" ON project_assets;
  DROP POLICY IF EXISTS "Allow anon update project_assets" ON project_assets;
  DROP POLICY IF EXISTS "Allow anon delete project_assets" ON project_assets;
  CREATE POLICY "Allow anon select project_assets" ON project_assets FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert project_assets" ON project_assets FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update project_assets" ON project_assets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow anon delete project_assets" ON project_assets FOR DELETE TO anon, authenticated USING (true);
END $$;

-- ─────────────────────────────────────────────
-- project_design_systems  (learned creative DNA)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_design_systems (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                   uuid UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  org_id                       uuid,
  best_performing_angles       jsonb DEFAULT '[]'::jsonb,
  best_performing_compositions jsonb DEFAULT '[]'::jsonb,
  best_performing_color_treatments jsonb DEFAULT '[]'::jsonb,
  best_performing_copy_angles  jsonb DEFAULT '[]'::jsonb,
  best_performing_lighting_styles  jsonb DEFAULT '[]'::jsonb,
  underperforming_patterns     jsonb DEFAULT '[]'::jsonb,
  total_creatives_analyzed     int  DEFAULT 0,
  total_campaigns_analyzed     int  DEFAULT 0,
  confidence_level             text DEFAULT 'insufficient'
                               CHECK (confidence_level IN (
                                 'insufficient','low','medium','high','very_high'
                               )),
  dna_summary                  text DEFAULT '',
  last_recomputed_at           timestamptz,
  updated_at                   timestamptz DEFAULT now()
);

ALTER TABLE project_design_systems ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select project_design_systems" ON project_design_systems;
  DROP POLICY IF EXISTS "Allow anon insert project_design_systems" ON project_design_systems;
  DROP POLICY IF EXISTS "Allow anon update project_design_systems" ON project_design_systems;
  CREATE POLICY "Allow anon select project_design_systems" ON project_design_systems FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert project_design_systems" ON project_design_systems FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update project_design_systems" ON project_design_systems FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- benchmarks  (KPI benchmarks per org/project)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS benchmarks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  metric_name   text NOT NULL DEFAULT '',
  current_value numeric DEFAULT 0,
  avg_7d        numeric DEFAULT 0,
  avg_14d       numeric DEFAULT 0,
  trend         text DEFAULT '→'
                CHECK (trend IN ('up','down','→')),
  status        text DEFAULT '',
  date          date DEFAULT CURRENT_DATE
);

ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select benchmarks" ON benchmarks;
  DROP POLICY IF EXISTS "Allow anon insert benchmarks" ON benchmarks;
  DROP POLICY IF EXISTS "Allow anon update benchmarks" ON benchmarks;
  CREATE POLICY "Allow anon select benchmarks" ON benchmarks FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert benchmarks" ON benchmarks FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update benchmarks" ON benchmarks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- creatives  (AI-generated ad creative records)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creatives (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid,
  project_id          uuid REFERENCES projects(id) ON DELETE SET NULL,
  variant             text DEFAULT '',
  angle               text DEFAULT '',
  format              text DEFAULT '',
  headline            text DEFAULT '',
  primary_text        text DEFAULT '',
  primary_text_odia   text DEFAULT '',
  nano_prompt         text DEFAULT '',
  nano_prompt_story   text DEFAULT '',
  platform_used       text DEFAULT '',
  review_score        numeric DEFAULT 0,
  status              text DEFAULT 'draft'
                      CHECK (status IN ('draft','active','retired')),
  ctr                 numeric DEFAULT 0,
  cpl                 numeric DEFAULT 0,
  retirement_reason   text DEFAULT '',
  design_dna_tags     jsonb DEFAULT '{}'::jsonb,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE creatives ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select creatives" ON creatives;
  DROP POLICY IF EXISTS "Allow anon insert creatives" ON creatives;
  DROP POLICY IF EXISTS "Allow anon update creatives" ON creatives;
  CREATE POLICY "Allow anon select creatives" ON creatives FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert creatives" ON creatives FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update creatives" ON creatives FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- ─────────────────────────────────────────────
-- creative_performance  (metrics linked to creatives)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_performance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id         uuid REFERENCES creatives(id) ON DELETE CASCADE,
  campaign_id         uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  project_id          uuid REFERENCES projects(id) ON DELETE SET NULL,
  org_id              uuid,
  total_spend         numeric DEFAULT 0,
  total_impressions   int     DEFAULT 0,
  total_clicks        int     DEFAULT 0,
  total_leads         int     DEFAULT 0,
  total_conversions   int     DEFAULT 0,
  cpl                 numeric DEFAULT 0,
  ctr                 numeric DEFAULT 0,
  cpm                 numeric DEFAULT 0,
  conversion_rate     numeric DEFAULT 0,
  performance_score   numeric DEFAULT 0,
  performance_tier    text DEFAULT 'insufficient_data'
                      CHECK (performance_tier IN (
                        'top_25','middle_50','bottom_25','insufficient_data'
                      )),
  design_dna_snapshot jsonb DEFAULT '{}'::jsonb,
  period_start        date,
  period_end          date,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE creative_performance ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon select creative_performance" ON creative_performance;
  DROP POLICY IF EXISTS "Allow anon insert creative_performance" ON creative_performance;
  DROP POLICY IF EXISTS "Allow anon update creative_performance" ON creative_performance;
  CREATE POLICY "Allow anon select creative_performance" ON creative_performance FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon insert creative_performance" ON creative_performance FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Allow anon update creative_performance" ON creative_performance FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

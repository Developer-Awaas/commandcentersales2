-- ============================================================
-- Bootstrap aanya_training_creatives.
--
-- This table exists on prod but was created directly via the
-- Supabase dashboard/API, never through a migration (see
-- 20260613000000_aanya_training_rls.sql's header + CLAUDE.md
-- bug #29). Replaying the full migration history against a
-- fresh project fails at that RLS-fix migration because the
-- table it ALTERs was never CREATEd anywhere in history.
--
-- CREATE TABLE IF NOT EXISTS is a no-op against prod (table
-- already exists there) and creates the real table on any
-- fresh project, so replay works end-to-end going forward.
-- Column shape sourced from the hand-written
-- supabase/functions/_shared/database.types.ts Row type and
-- docs/aanya-memory-schema.md (both already treated as the
-- source of truth elsewhere in this repo for this table).
-- RLS is deliberately left disabled here — 20260613000000/
-- 20260613100000 enable it and create policies, matching the
-- real historical sequence (created without proper RLS, fixed
-- afterward).
-- ============================================================

CREATE TABLE IF NOT EXISTS aanya_training_creatives (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES projects(id) ON DELETE SET NULL,
  image_url          text NOT NULL,
  storage_path       text NOT NULL,
  source             text NOT NULL
                       CHECK (source IN ('own_ad', 'competitor', 'industry_reference', 'winning_template')),
  platform           text,
  performance_tier   text NOT NULL DEFAULT 'reference_only'
                       CHECK (performance_tier IN ('top_performer', 'good_performer', 'average', 'underperformer', 'reference_only')),
  cpl                numeric,
  ctr                numeric,
  notes              text,
  vision_analysis    jsonb,
  extracted_patterns jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aanya_training_creatives_org_id
  ON aanya_training_creatives (org_id);

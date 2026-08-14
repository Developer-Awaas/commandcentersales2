-- ============================================================
-- P2.13 PART C — record which ad platform an output was authored for,
-- in ONE normalised vocabulary: 'meta' | 'google'.
--
-- The app has always let the user pick an ad platform, and that choice has
-- always changed what gets generated (copy limits, field names, CTA
-- vocabulary). tool_outputs never recorded it at all, so a saved strategy
-- could not be told apart from one written for a different platform.
--
-- IMPORTANT — campaigns.platform is NOT a new column. It has existed since
-- 20260409123924 as `text DEFAULT ''` and is already written by Strategy.tsx
-- and CampaignWizard.tsx with display strings: '', 'Meta', 'Meta Ads Manager',
-- 'AiSensy'. Adding the CHECK without normalising those first would fail
-- against every existing row. So this migration normalises in place, THEN
-- constrains. Sequence matters; do not reorder.
--
-- Why mapping 'AiSensy' → 'meta' loses nothing: a Click-to-WhatsApp ad IS a
-- Meta ad bought in Meta Ads Manager, and the CTWA-ness of a campaign is
-- already recorded independently in campaigns.ad_type (DEFAULT 'CTWA',
-- migration 20260609150000). The platform column was answering two questions
-- at once; ad_type keeps the second answer.
--
-- '' → NULL because empty string is the column's old DEFAULT, i.e. "nobody
-- said", which is genuinely unknown — not Meta. Readers must treat NULL as
-- "not recorded" and never assume a platform from it.
--
-- 'aisensy' is deliberately absent from the CHECK: the selectors no longer
-- offer it, so no code path can produce it, and allowing it would preserve a
-- value nothing writes. The CTWA rendering scaffolding stays in the client
-- (see StrategyResult.tsx) for when CTWA is modelled as a Meta ad TYPE.
--
-- DOWN migration lives in supabase/rollbacks/ (never auto-applied).
-- ============================================================

-- 1. tool_outputs.platform — genuinely new, additive, nullable. Existing rows
--    predate it and their platform is unknown; a backfill would invent history.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tool_outputs' AND column_name='platform') THEN
    ALTER TABLE tool_outputs ADD COLUMN platform text;
  END IF;
END $$;

-- 2. campaigns.platform — pre-existing. Create only if somehow absent, then
--    normalise every legacy value into the new vocabulary.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='campaigns' AND column_name='platform') THEN
    ALTER TABLE campaigns ADD COLUMN platform text;
  END IF;
END $$;

-- Drop the '' default first: it would keep injecting a value the CHECK rejects
-- on every future insert that omits the column.
ALTER TABLE campaigns ALTER COLUMN platform DROP DEFAULT;

-- Mirrors normalizeAdPlatform() in src/lib/ad-platform.ts. Anything
-- unrecognised becomes NULL ("not recorded") rather than being guessed at.
UPDATE campaigns SET platform =
  CASE
    WHEN platform IS NULL THEN NULL
    WHEN btrim(platform) = '' THEN NULL
    WHEN lower(platform) LIKE '%google%' THEN 'google'
    WHEN lower(platform) LIKE '%meta%'
      OR lower(platform) LIKE '%aisensy%'
      OR lower(platform) LIKE '%whatsapp%' THEN 'meta'
    ELSE NULL
  END
WHERE platform IS DISTINCT FROM 'meta' AND platform IS DISTINCT FROM 'google';

-- 3. Constraints last, so a re-run over a partially-applied state converges.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='campaigns_platform_check') THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_platform_check
      CHECK (platform IS NULL OR platform IN ('meta','google'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tool_outputs_platform_check') THEN
    ALTER TABLE tool_outputs
      ADD CONSTRAINT tool_outputs_platform_check
      CHECK (platform IS NULL OR platform IN ('meta','google'));
  END IF;
END $$;

COMMENT ON COLUMN campaigns.platform IS
  'Ad platform: meta | google. NULL = not recorded (never assume meta). CTWA-ness lives in ad_type, not here.';
COMMENT ON COLUMN tool_outputs.platform IS
  'Ad platform this output was generated for: meta | google. NULL = not recorded, or a social-domain tool with no ad platform.';

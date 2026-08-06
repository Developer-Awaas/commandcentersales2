-- ============================================================
-- Fix 3 (RB-P2) — repopulate competitor-stripped zones with OUR values.
--
-- Replicate mode strips the reference ad's competitor IDENTITY (logo, brand
-- name, QR, their phone) but PRESERVES the price-callout and contact-strip
-- ZONES, repopulating them (as editable text-overlay layers) with this
-- project's / org's own values. Two new sources for those values:
--
-- 1. projects.price_display — free-text price shown on the creative when the
--    strategy/brief ad_copy carries no price (e.g. "₹1.14 Cr onwards").
-- 2. brand_kits.whatsapp_number + phone_display — the contact strip's values.
--    (logo is already brand-kit-sourced.)
--
-- All three additive + nullable — no destructive change, no backfill.
-- DOWN migration in supabase/rollbacks/ (never auto-applied).
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='price_display') THEN
    ALTER TABLE projects ADD COLUMN price_display text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brand_kits' AND column_name='whatsapp_number') THEN
    ALTER TABLE brand_kits ADD COLUMN whatsapp_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brand_kits' AND column_name='phone_display') THEN
    ALTER TABLE brand_kits ADD COLUMN phone_display text;
  END IF;
END $$;

-- ============================================================
-- DOWN migration for 20260806120000_price_display_brand_contact.sql
-- Run manually: supabase db query --linked -f supabase/rollbacks/20260806120000_price_display_brand_contact_down.sql
-- Drops the three additive nullable columns (no data backfill to preserve).
-- ============================================================

ALTER TABLE projects   DROP COLUMN IF EXISTS price_display;
ALTER TABLE brand_kits DROP COLUMN IF EXISTS whatsapp_number;
ALTER TABLE brand_kits DROP COLUMN IF EXISTS phone_display;

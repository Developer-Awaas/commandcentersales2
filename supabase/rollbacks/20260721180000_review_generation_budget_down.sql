-- Run manually: supabase db query --linked -f supabase/rollbacks/20260721180000_review_generation_budget_down.sql
-- review-build only — safe to drop, this table holds no tenant data.
DROP FUNCTION IF EXISTS increment_review_image_budget(numeric);
DROP TABLE IF EXISTS review_generation_budget;

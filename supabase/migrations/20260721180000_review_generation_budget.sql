-- ============================================================
-- review-build only: server-enforced image generation budget.
--
-- Single-row counter (id fixed at 1) so it survives Edge Function
-- cold starts, unlike aanya.ts's in-memory BudgetTracker (per-
-- invocation, per-interaction cost ceiling — a different, smaller
-- concern this does NOT replace).
--
-- Hard stop at 300 images: at GPT-Image-1 'high' quality (the only
-- quality this app ever actually requests — confirmed via grep, every
-- real call site hardcodes 'high'), image-provider.ts's own
-- OPENAI_IMAGE_COST_USD.high = $0.167/image, so 300 * $0.167 ≈ $50.10.
--
-- increment_review_image_budget() does the check-and-increment as one
-- atomic UPDATE ... WHERE image_count < image_limit RETURNING — the
-- row lock this acquires serializes concurrent callers, so two
-- simultaneous requests can never both squeak through past the limit.
-- ============================================================

CREATE TABLE IF NOT EXISTS review_generation_budget (
  id                  integer PRIMARY KEY DEFAULT 1,
  image_count         integer NOT NULL DEFAULT 0,
  estimated_cost_usd  numeric(10,4) NOT NULL DEFAULT 0,
  image_limit         integer NOT NULL DEFAULT 300,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_generation_budget_single_row CHECK (id = 1)
);

INSERT INTO review_generation_budget (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE review_generation_budget ENABLE ROW LEVEL SECURITY;
-- No policies — service-role only (bypasses RLS). Not org-scoped: this
-- is a single global deployment counter, not per-tenant data.

CREATE OR REPLACE FUNCTION increment_review_image_budget(p_cost_usd numeric)
RETURNS TABLE(new_count integer, was_allowed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE review_generation_budget
  SET image_count = image_count + 1,
      estimated_cost_usd = estimated_cost_usd + p_cost_usd,
      updated_at = now()
  WHERE id = 1 AND image_count < image_limit
  RETURNING image_count INTO v_count;

  IF v_count IS NULL THEN
    RETURN QUERY SELECT rgb.image_count, false FROM review_generation_budget rgb WHERE rgb.id = 1;
  ELSE
    RETURN QUERY SELECT v_count, true;
  END IF;
END;
$$;

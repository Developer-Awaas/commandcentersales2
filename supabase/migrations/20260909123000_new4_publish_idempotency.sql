-- NEW-4 (schema half): a publish carries a client-generated idempotency key,
-- so a retried or double-clicked publish resolves to the row already written
-- instead of a second Meta post. Nullable: rows before NEW-4 and callers not
-- yet sending a key are unaffected; the partial unique index only binds keys
-- that are present. The writer change is Ph4 (meta-publish is FROZEN).
--
-- Fix-forward only. No down migration.

ALTER TABLE published_assets
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_published_assets_idempotency_key
  ON published_assets (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

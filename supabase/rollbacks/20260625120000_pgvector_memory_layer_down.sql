-- ============================================================
-- DOWN migration for 20260625120000_pgvector_memory_layer.sql
--
-- Run this to fully reverse the pgvector memory layer.
-- Drops in strict dependency order:
--   functions first (they reference memory_scope in signatures)
--   table next (uses memory_scope column)
--   enum last
--
-- Does NOT touch agent_memory — that table is unrelated.
-- Does NOT drop the vector extension — it may be used elsewhere.
-- ============================================================

-- 1. Functions (reference memory_scope in param / return types)
DROP FUNCTION IF EXISTS match_memory_chunks(
  vector(1024), text, memory_scope, uuid, int
);
DROP FUNCTION IF EXISTS touch_memory_chunks(uuid[]);

-- 2. Table (has memory_scope column; FK to agent_memory drops automatically)
DROP TABLE IF EXISTS agent_memory_chunks;

-- 3. Enum (nothing references it now)
DROP TYPE IF EXISTS memory_scope;

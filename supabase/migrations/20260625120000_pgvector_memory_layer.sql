-- ============================================================
-- pgvector memory layer — agent_memory_chunks
--
-- Adds semantic + hybrid search on top of the approved-campaign
-- memory system.  agent_memory (the CHECK-constrained domain
-- object) is NOT touched.  Phase B will project approved campaign
-- decisions into this table.
--
-- Invariant: embedding column is vector(1024) — sized for
-- text-embedding-3-small with dimensions:1024 truncation.
-- This matches Voyage AI native dimensions, so a provider swap
-- needs no re-index.
-- ============================================================

-- 1. pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Scope enum
CREATE TYPE memory_scope AS ENUM (
  'decision',
  'project',
  'builder',
  'domain',
  'shared',
  'agent'
);

-- 3. Table
CREATE TABLE agent_memory_chunks (
  id               uuid         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           uuid         NOT NULL,
  project_id       uuid         NULL,
  scope            memory_scope NOT NULL,
  agent_name       text         NULL,
  content          text         NOT NULL,
  embedding        vector(1024) NULL,               -- nullable = fail-soft writes
  salience         real         NOT NULL DEFAULT 0.5
                                CHECK (salience BETWEEN 0 AND 1),
  access_count     int          NOT NULL DEFAULT 0,
  last_accessed_at timestamptz  NULL,
  expires_at       timestamptz  NULL,               -- TTL; callers filter, DB does not enforce
  source_memory_id uuid         NULL
                                REFERENCES agent_memory(id) ON DELETE SET NULL,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

-- 4. Indexes

-- Semantic: approximate nearest-neighbour cosine search on embeddings (HNSW)
CREATE INDEX agent_memory_chunks_embedding_hnsw_idx
  ON agent_memory_chunks USING hnsw (embedding vector_cosine_ops);

-- Lexical: full-text keyword search on content
CREATE INDEX agent_memory_chunks_content_gin_idx
  ON agent_memory_chunks USING gin (to_tsvector('english', content));

-- Btree: org + scope lookups, org + project lookups, recency ordering
CREATE INDEX agent_memory_chunks_org_scope_idx    ON agent_memory_chunks (org_id, scope);
CREATE INDEX agent_memory_chunks_org_project_idx  ON agent_memory_chunks (org_id, project_id);
CREATE INDEX agent_memory_chunks_org_created_idx  ON agent_memory_chunks (org_id, created_at DESC);

-- 5. RLS — org-isolation, same convention as all other tables
ALTER TABLE agent_memory_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can manage their memory chunks"
  ON agent_memory_chunks FOR ALL TO authenticated
  USING     (org_id = get_current_user_org_id())
  WITH CHECK (org_id = get_current_user_org_id());

-- ============================================================
-- 6. RPC: match_memory_chunks
--
--    Hybrid scorer combining three signals:
--      hybrid_score = 0.65 * cosine_similarity
--                   + 0.20 * recency_score
--                   + 0.15 * ts_rank
--
--    cosine_similarity = 1 - (embedding <=> query_embedding)
--    recency_score     = exp( -ln(2) * age_s / halflife_s )
--                        (half-life = 30 days — see CONFIGURABLE CONSTANT)
--    ts_rank           = lexical rank of content against query_text
--
--    Rows where embedding IS NULL are skipped (can't score semantically).
--
--    SECURITY INVOKER: RLS applies automatically — no chunk from
--    another org can be returned.  The explicit org_id filter is
--    belt-and-suspenders and enables the (org_id, scope) index.
-- ============================================================

CREATE OR REPLACE FUNCTION match_memory_chunks(
  query_embedding vector(1024),
  query_text      text,
  filter_scope    memory_scope DEFAULT NULL,   -- NULL = all scopes
  filter_project  uuid         DEFAULT NULL,
  match_count     int          DEFAULT 10
)
RETURNS TABLE (
  id           uuid,
  content      text,
  scope        memory_scope,
  agent_name   text,
  salience     real,
  similarity   real,
  hybrid_score real,
  created_at   timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- CONFIGURABLE CONSTANT: recency half-life in seconds (currently 30 days).
  -- A chunk written 30 days ago contributes exp(-ln 2) ≈ 0.5× relative to
  -- a chunk written now.  Tune without touching the weight formula above.
  WITH params(halflife_s) AS (
    SELECT (30.0 * 24 * 60 * 60)::float8
  ),
  scored AS (
    SELECT
      c.id,
      c.content,
      c.scope,
      c.agent_name,
      c.salience,
      (1.0 - (c.embedding <=> query_embedding))::real AS similarity,
      (
          0.65 * (1.0 - (c.embedding <=> query_embedding))
        + 0.20 * exp(-ln(2) * EXTRACT(EPOCH FROM (now() - c.created_at)) / p.halflife_s)
        + 0.15 * ts_rank(
                   to_tsvector('english', c.content),
                   plainto_tsquery('english', query_text)
                 )
      )::real AS hybrid_score,
      c.created_at
    FROM agent_memory_chunks c
    CROSS JOIN params p
    WHERE
      c.embedding IS NOT NULL                                        -- skip unembedded rows
      AND c.org_id = get_current_user_org_id()                      -- explicit + RLS double-guard
      AND (filter_scope   IS NULL OR c.scope      = filter_scope)
      AND (filter_project IS NULL OR c.project_id = filter_project)
  )
  SELECT id, content, scope, agent_name, salience, similarity, hybrid_score, created_at
  FROM   scored
  ORDER  BY hybrid_score DESC
  LIMIT  match_count;
$$;

-- ============================================================
-- 7. RPC: touch_memory_chunks
--
--    Increment access counter and timestamp for a batch of chunks.
--    SECURITY INVOKER: the UPDATE is RLS-filtered — callers can
--    only touch chunks within their own org.
-- ============================================================

CREATE OR REPLACE FUNCTION touch_memory_chunks(chunk_ids uuid[])
RETURNS void
LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  UPDATE agent_memory_chunks
  SET
    access_count     = access_count + 1,
    last_accessed_at = now()
  WHERE id = ANY(chunk_ids);
$$;

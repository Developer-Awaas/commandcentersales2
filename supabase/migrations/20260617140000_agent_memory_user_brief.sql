-- Add user_brief to agent_memory so the original campaign brief is stored
-- directly on the approved-decision row, rather than only being recoverable
-- by joining back through agent_messages.
--
-- Why store it here: at recall time (future "another like that" feature), the
-- query pattern is: find the most similar prior approved campaign → embed the
-- brief for pgvector similarity search. Having the brief on agent_memory avoids
-- a cross-table join every time a recall query runs, and makes backfilling
-- embeddings straightforward (SELECT id, user_brief FROM agent_memory WHERE
-- user_brief IS NOT NULL AND embedding IS NULL).
--
-- GIN full-text index on (user_brief || summary) enables ILIKE / tsvector
-- search before pgvector is added (Phase 6+).

ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS user_brief text;

-- Full-text search index covering both brief and summary for ILIKE queries
-- until a vector column is added.
CREATE INDEX IF NOT EXISTS idx_agent_memory_fts
  ON agent_memory
  USING gin(
    to_tsvector('english',
      coalesce(user_brief, '') || ' ' || coalesce(summary, '')
    )
  );

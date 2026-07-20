/**
 * agent-memory.ts — read/write helpers for agent_memory_chunks.
 *
 * Three functions:
 *   writeMemory            — embed + insert; fail-soft on embedding failure (writes NULL).
 *   retrieveMemory         — embed query, call match_memory_chunks RPC, touch returned ids.
 *   projectApprovedCampaign — Phase B2 stub; NOT called or tested in B1.
 *
 * Callers pass in the Supabase client — use the authenticated client so RLS is
 * exercised; use the admin (service-role) client only for background jobs that
 * run outside a user request context.
 *
 * CRITICAL: do NOT pass org_id to match_memory_chunks — the RPC is SECURITY
 * INVOKER and get_current_user_org_id() handles tenancy automatically. Passing
 * org_id would fail the call (it is not in the RPC signature).
 */

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { embed } from './embedding-provider.ts'

export type MemoryScope = 'decision' | 'project' | 'builder' | 'domain' | 'shared' | 'agent'

// ─── writeMemory ──────────────────────────────────────────────────────────────

export interface WriteMemoryInput {
  supabase: SupabaseClient<any>
  org_id: string
  project_id?: string
  scope: MemoryScope
  agent_name?: string
  content: string
  salience?: number
  source_memory_id?: string
}

export interface MemoryChunkRow {
  id: string
  org_id: string
  project_id: string | null
  scope: MemoryScope
  agent_name: string | null
  content: string
  // Supabase/PostgREST returns vector columns as a string e.g. "[0.1,...]" or null
  embedding: string | number[] | null
  salience: number
  access_count: number
  last_accessed_at: string | null
  expires_at: string | null
  source_memory_id: string | null
  created_at: string
}

export async function writeMemory(input: WriteMemoryInput): Promise<MemoryChunkRow> {
  const {
    supabase,
    org_id,
    project_id,
    scope,
    agent_name,
    content,
    salience = 0.5,
    source_memory_id,
  } = input

  // Embed content — fail-soft: never lose the write if embedding fails.
  let embeddingVec: number[] | null = null
  try {
    embeddingVec = await embed(content, 'document')
  } catch (err) {
    console.error(
      'writeMemory: embedding failed (inserting NULL embedding) —',
      err instanceof Error ? err.message : String(err),
    )
  }

  const insertPayload: Record<string, unknown> = {
    org_id,
    scope,
    content,
    salience,
    embedding: embeddingVec,  // number[] or null; PostgREST handles vector cast
  }
  if (project_id !== undefined) insertPayload.project_id = project_id
  if (agent_name !== undefined) insertPayload.agent_name = agent_name
  if (source_memory_id !== undefined) insertPayload.source_memory_id = source_memory_id

  const { data, error } = await supabase
    .from('agent_memory_chunks')
    .insert(insertPayload)
    .select()
    .single()

  if (error) throw new Error(`writeMemory insert failed: ${error.message}`)
  return data as MemoryChunkRow
}

// ─── retrieveMemory ───────────────────────────────────────────────────────────

export interface RetrieveMemoryInput {
  supabase: SupabaseClient<any>
  query_text: string
  filter_scope?: MemoryScope
  filter_project?: string
  match_count?: number
}

export interface MemoryHit {
  id: string
  content: string
  scope: MemoryScope
  agent_name: string | null
  salience: number
  similarity: number
  hybrid_score: number
  created_at: string
}

export async function retrieveMemory(input: RetrieveMemoryInput): Promise<MemoryHit[]> {
  const { supabase, query_text, filter_scope, filter_project, match_count = 10 } = input

  const vec = await embed(query_text, 'query')

  // Build RPC args — only include optional filters when provided.
  // CRITICAL: do NOT include org_id — it is not in the RPC signature.
  const rpcArgs: Record<string, unknown> = {
    query_embedding: vec,   // number[] — PostgREST handles vector(1024) cast
    query_text,
    match_count,
  }
  if (filter_scope !== undefined) rpcArgs.filter_scope = filter_scope
  if (filter_project !== undefined) rpcArgs.filter_project = filter_project

  const { data, error } = await supabase.rpc('match_memory_chunks', rpcArgs)
  if (error) throw new Error(`retrieveMemory rpc failed: ${error.message}`)

  const hits = (data ?? []) as MemoryHit[]

  // Touch returned ids — fire-and-forget; a failure here is non-fatal.
  const ids = hits.map((h) => h.id)
  if (ids.length > 0) {
    supabase
      .rpc('touch_memory_chunks', { chunk_ids: ids })
      .then(({ error: te }: { error: { message: string } | null }) => {
        if (te) console.warn('touch_memory_chunks failed (non-fatal):', te.message)
      })
  }

  return hits
}

// ─── projectApprovedCampaign ──────────────────────────────────────────────────

/**
 * Projects an approved campaign decision from agent_memory into agent_memory_chunks
 * so it participates in semantic + hybrid retrieval.
 *
 * Tenancy invariant: org_id and project_id are derived by SELECT-ing the
 * source agent_memory row — never accepted as parameters. The caller (which
 * runs as service-role and therefore bypasses RLS) has no influence over which
 * org the chunk is written to. One source of truth; no spoofable parameter hop.
 *
 * Call as fire-and-forget from handleApprove — a chunk-write failure must
 * never fail the approve action. writeMemory itself is fail-soft on embedding
 * (inserts NULL embedding rather than losing the row entirely).
 */
export async function projectApprovedCampaign(
  supabase: SupabaseClient<any>,
  sourceMemoryId: string,
): Promise<void> {
  // Derive tenancy from the DB row — this SELECT is the verification step.
  const { data: memRow, error: fetchErr } = await supabase
    .from('agent_memory')
    .select('id, org_id, project_id, summary, strategy, user_brief')
    .eq('id', sourceMemoryId)
    .single()

  if (fetchErr || !memRow) {
    throw new Error(
      `projectApprovedCampaign: could not fetch agent_memory row (id=${sourceMemoryId}) — ${fetchErr?.message ?? 'not found'}`,
    )
  }

  const row = memRow as {
    id: string
    org_id: string
    project_id: string | null
    summary: string | null
    strategy: unknown
    user_brief: string | null
  }

  // Idempotency guard — must come before writeMemory (and therefore before
  // embed()) so a second call neither inserts a duplicate nor burns an
  // embedding API call on a no-op write.
  const { data: existing, error: dupErr } = await supabase
    .from('agent_memory_chunks')
    .select('id')
    .eq('source_memory_id', sourceMemoryId)
    .maybeSingle()

  if (dupErr) {
    throw new Error(`projectApprovedCampaign: idempotency check failed — ${dupErr.message}`)
  }
  if (existing) return  // already projected; nothing to do

  // Build a rich content string so both the FTS and semantic components of
  // the hybrid scorer have signal. Order matters: user brief first (most
  // conversational, highest recall signal), then the formal decision summary,
  // then structured strategy JSON for keyword coverage.
  const parts: string[] = []
  if (row.user_brief) parts.push(`Brief: ${row.user_brief}`)
  if (row.summary)    parts.push(`Decision: ${row.summary}`)
  if (row.strategy)   parts.push(`Strategy: ${JSON.stringify(row.strategy)}`)
  const content = parts.join('\n') || `Approved campaign — ${sourceMemoryId}`

  await writeMemory({
    supabase,
    org_id:           row.org_id,
    project_id:       row.project_id ?? undefined,
    scope:            'decision',
    agent_name:       'aarav',
    content,
    salience:         0.7,
    source_memory_id: sourceMemoryId,
  })
}

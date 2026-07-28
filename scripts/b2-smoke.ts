/**
 * Phase B2 Smoke Test — gate-5: projectApprovedCampaign idempotency + field contract.
 *
 * Asserts:
 *   1. Call #1 inserts exactly one agent_memory_chunks row with correct field
 *      values (scope, salience, agent_name, org_id, project_id,
 *      source_memory_id, embedding IS NOT NULL).
 *   2. Call #2 is idempotent: count stays 1 AND the surviving chunk's id is
 *      identical to call #1's id (stable id proves early-return, not
 *      delete-then-reinsert).
 *   3. Negative: bogus UUID (non-existent agent_memory row) throws and writes
 *      zero chunks.
 *   4. Read-only invariant: agent_memory row is unchanged after projection.
 *
 * Client: explicit service-role adminClient only — projectApprovedCampaign is
 * the service-role path. Testing under an authenticated JWT would let RLS mask
 * whether the in-code org_id derivation is correct (see task brief STEP 1).
 * No auth user, no profile, no JWT needed.
 *
 * Required env vars:
 *   SUPABASE_URL              (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY            — text-embedding-3-small; tiny §6.4 spend (~3 embeds)
 *
 * Run:
 *   deno run --allow-net --allow-env scripts/b2-smoke.ts
 *
 * Exit 0 = gate-5 GREEN. Exit 1 = failure (cleanup still runs via finally).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { projectApprovedCampaign } from '../supabase/functions/_shared/agent-memory.ts'

// ─── Env ───────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OPENAI_KEY   = Deno.env.get('OPENAI_API_KEY') ?? ''

const missing: string[] = []
if (!SUPABASE_URL) missing.push('SUPABASE_URL or VITE_SUPABASE_URL')
if (!SERVICE_KEY)  missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!OPENAI_KEY)   missing.push('OPENAI_API_KEY')

if (missing.length > 0) {
  console.error('[B2 SMOKE] ✗ Missing required env vars:')
  missing.forEach((v) => console.error(`  - ${v}`))
  Deno.exit(1)
}

// ─── Admin client (service-role — RLS bypassed on writes) ──────────────────────

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Sentinel identifiers ──────────────────────────────────────────────────────

const RUN_SUFFIX          = Date.now()
const SENTINEL_ORG_ID     = crypto.randomUUID()
const SENTINEL_PROJECT_ID = crypto.randomUUID()
let   SENTINEL_MEMORY_ID  = ''   // assigned after agent_memory INSERT

// ─── Assertion helper ──────────────────────────────────────────────────────────

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${label}`)
  console.log(`  ✓ ${label}`)
}

// deepEqual normalises object key order before comparing — necessary because
// PostgreSQL jsonb returns keys alphabetically sorted, while JS JSON.stringify
// preserves insertion order, making a direct string comparison fail on identical
// data. Arrays are compared index-for-index (jsonb preserves array element order).
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || a === null || b === null || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const aa = a as unknown[]; const bb = b as unknown[]
    if (aa.length !== bb.length) return false
    return aa.every((v, i) => deepEqual(v, bb[i]))
  }
  const aKeys = Object.keys(a as object).sort()
  const bKeys = Object.keys(b as object).sort()
  if (aKeys.join('\0') !== bKeys.join('\0')) return false
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  )
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────
//
// Reverse-FK order. CRITICAL: chunk count verified BEFORE deleting agent_memory.
// agent_memory_chunks.source_memory_id has ON DELETE SET NULL — if agent_memory
// is deleted first, any surviving chunks are orphaned (source_memory_id → NULL)
// and the WHERE source_memory_id = SENTINEL_MEMORY_ID count silently returns 0,
// hiding the accretion. Verify while the FK still points.

async function cleanup(): Promise<void> {
  console.log('\n[CLEANUP] Starting...')

  // 1. Delete sentinel chunks (targeted — no broad scope/agent filter).
  if (SENTINEL_MEMORY_ID) {
    const { error: chunkDelErr } = await adminClient
      .from('agent_memory_chunks')
      .delete()
      .eq('source_memory_id', SENTINEL_MEMORY_ID)
    if (chunkDelErr) {
      console.warn('[CLEANUP] chunk delete error (non-fatal):', chunkDelErr.message)
    } else {
      console.log('[CLEANUP] ✓ Deleted chunks WHERE source_memory_id = sentinel')
    }

    // 2. Verify chunk count NOW — before agent_memory delete nulls the FK.
    const { count: chunkCount, error: countErr } = await adminClient
      .from('agent_memory_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('source_memory_id', SENTINEL_MEMORY_ID)
    if (countErr) {
      console.error('[CLEANUP] ✗ Count query failed:', countErr.message)
    } else if (chunkCount === 0) {
      console.log('[CLEANUP] ✓ Sentinel chunk count = 0')
    } else {
      console.error(`[CLEANUP] ✗ FAILED — ${chunkCount} sentinel chunk(s) still exist`)
    }

    // 3. Delete sentinel agent_memory row by captured id (not by org/project/scope).
    const { error: memDelErr } = await adminClient
      .from('agent_memory')
      .delete()
      .eq('id', SENTINEL_MEMORY_ID)
    if (memDelErr) {
      console.warn('[CLEANUP] agent_memory delete error (non-fatal):', memDelErr.message)
    } else {
      console.log('[CLEANUP] ✓ Deleted agent_memory row')
    }
  }

  // 4. Delete sentinel project by captured id.
  const { error: projDelErr } = await adminClient
    .from('projects')
    .delete()
    .eq('id', SENTINEL_PROJECT_ID)
  if (projDelErr) {
    console.warn('[CLEANUP] project delete error (non-fatal):', projDelErr.message)
  } else {
    console.log('[CLEANUP] ✓ Deleted sentinel project')
  }

  // 5. Delete sentinel org by captured id (CASCADE covers any residual rows).
  const { error: orgDelErr } = await adminClient
    .from('organizations')
    .delete()
    .eq('id', SENTINEL_ORG_ID)
  if (orgDelErr) {
    console.warn('[CLEANUP] org delete error (non-fatal):', orgDelErr.message)
  } else {
    console.log('[CLEANUP] ✓ Deleted sentinel org')
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

let passed = false

try {
  // ── STEP 2: Sentinel fixtures ─────────────────────────────────────────────
  //
  // FK chain: organizations ← projects ← agent_memory.
  // Insert in dependency order; capture every id.

  console.log('[STEP 2] Seeding sentinel fixtures...')

  const { error: orgErr } = await adminClient
    .from('organizations')
    .insert({ id: SENTINEL_ORG_ID, name: `B2_SENTINEL_ORG_${RUN_SUFFIX}` })
  if (orgErr) throw new Error(`Setup: org insert failed — ${orgErr.message}`)
  console.log(`[STEP 2] ✓ Sentinel org:     ${SENTINEL_ORG_ID}`)

  const { error: projErr } = await adminClient
    .from('projects')
    .insert({
      id:     SENTINEL_PROJECT_ID,
      org_id: SENTINEL_ORG_ID,
      name:   `B2_SENTINEL_PROJECT_${RUN_SUFFIX}`,
    })
  if (projErr) throw new Error(`Setup: project insert failed — ${projErr.message}`)
  console.log(`[STEP 2] ✓ Sentinel project: ${SENTINEL_PROJECT_ID}`)

  // Realistic strategy and summary — not empty. An empty sentinel exercises
  // the fallback path ("Approved campaign — <id>") rather than the real
  // content builder, so all three fields are populated.
  const SENTINEL_STRATEGY = {
    budget_split:  { meta: 70, google: 30 },
    targeting:     { location: 'Pune', age_range: '28-45', interests: ['real_estate', 'investment'] },
    placements:    ['facebook_feed', 'instagram_feed', 'instagram_reels'],
    expected_cpl:  1200,
    campaign_name: `B2 Sentinel — Neelachala Homes Launch ${RUN_SUFFIX}`,
  }
  const SENTINEL_SUMMARY   = `Approved 3BHK launch campaign for Neelachala Homes Pune (B2_SENTINEL_${RUN_SUFFIX})`
  const SENTINEL_USER_BRIEF = 'Generate Meta ads for a 3BHK residential project in Pune targeting IT professionals'

  const { data: memData, error: memErr } = await adminClient
    .from('agent_memory')
    .insert({
      org_id:       SENTINEL_ORG_ID,
      project_id:   SENTINEL_PROJECT_ID,
      memory_type:  'approved_campaign',
      strategy:     SENTINEL_STRATEGY,
      summary:      SENTINEL_SUMMARY,
      user_brief:   SENTINEL_USER_BRIEF,
    })
    .select('id')
    .single()
  if (memErr || !memData) throw new Error(`Setup: agent_memory insert failed — ${memErr?.message ?? 'no row'}`)
  SENTINEL_MEMORY_ID = (memData as { id: string }).id
  console.log(`[STEP 2] ✓ Sentinel agent_memory: ${SENTINEL_MEMORY_ID}`)

  // ── STEP 3: Call #1 + assert field contract ───────────────────────────────

  console.log('\n[STEP 3] Call #1 — projectApprovedCampaign...')
  await projectApprovedCampaign(adminClient, SENTINEL_MEMORY_ID)
  console.log('[STEP 3] Returned.')

  const { data: rows1, error: q1Err } = await adminClient
    .from('agent_memory_chunks')
    .select('id, scope, salience, agent_name, org_id, project_id, source_memory_id, embedding')
    .eq('source_memory_id', SENTINEL_MEMORY_ID)
  if (q1Err) throw new Error(`STEP 3: chunk query failed — ${q1Err.message}`)

  assert(rows1.length === 1, `exactly 1 chunk after call #1 (got ${rows1.length})`)

  const c1 = rows1[0] as {
    id: string
    scope: string
    salience: number
    agent_name: string
    org_id: string
    project_id: string
    source_memory_id: string
    embedding: unknown
  }
  const chunkId1 = c1.id

  console.log('[STEP 3] Field assertions:')
  assert(c1.scope            === 'decision',           `scope = 'decision'`)
  assert(Math.abs(c1.salience - 0.7) < 0.001,         `salience = 0.7 (got ${c1.salience})`)
  assert(c1.agent_name       === 'aarav',              `agent_name = 'aarav'`)
  assert(c1.org_id           === SENTINEL_ORG_ID,      `org_id = sentinel org (tenancy derived from DB)`)
  assert(c1.project_id       === SENTINEL_PROJECT_ID,  `project_id = sentinel project (tenancy derived from DB)`)
  assert(c1.source_memory_id === SENTINEL_MEMORY_ID,   `source_memory_id = sentinelMemoryId`)
  assert(c1.embedding !== null && c1.embedding !== undefined, `embedding IS NOT NULL (embed() ran successfully)`)

  // ── STEP 4a: Call #2 — idempotency ───────────────────────────────────────

  console.log('\n[STEP 4a] Call #2 — idempotency...')
  await projectApprovedCampaign(adminClient, SENTINEL_MEMORY_ID)
  console.log('[STEP 4a] Returned.')

  const { data: rows2, error: q2Err } = await adminClient
    .from('agent_memory_chunks')
    .select('id')
    .eq('source_memory_id', SENTINEL_MEMORY_ID)
  if (q2Err) throw new Error(`STEP 4a: chunk query failed — ${q2Err.message}`)

  console.log('[STEP 4a] Idempotency assertions:')
  assert(rows2.length === 1, `count still 1 after call #2 (got ${rows2.length})`)
  assert(
    (rows2[0] as { id: string }).id === chunkId1,
    `chunk id stable (id=${chunkId1}) — proves early-return, not delete-then-reinsert`,
  )

  // ── STEP 4b: Negative — bogus UUID writes nothing ─────────────────────────

  console.log('\n[STEP 4b] Negative — bogus (non-existent) UUID...')
  const bogusId = crypto.randomUUID()
  let bogusThrew = false
  let bogusMsg   = ''
  try {
    await projectApprovedCampaign(adminClient, bogusId)
  } catch (err) {
    bogusThrew = true
    bogusMsg = err instanceof Error ? err.message : String(err)
  }

  console.log('[STEP 4b] Negative assertions:')
  assert(bogusThrew, `bogus UUID throws (no-row guard in fetchErr || !memRow)`)
  assert(
    bogusMsg.includes('could not fetch agent_memory row'),
    `throw message identifies missing row (got: "${bogusMsg}")`,
  )

  const { data: bogusChunks, error: bogusQErr } = await adminClient
    .from('agent_memory_chunks')
    .select('id')
    .eq('source_memory_id', bogusId)
  if (bogusQErr) throw new Error(`STEP 4b: bogus chunk query failed — ${bogusQErr.message}`)
  assert(bogusChunks.length === 0, `bogus UUID wrote 0 chunks`)

  // ── STEP 5: Read-only invariant ───────────────────────────────────────────

  console.log('\n[STEP 5] Read-only invariant — agent_memory unchanged...')
  const { data: memAfter, error: reErr } = await adminClient
    .from('agent_memory')
    .select('org_id, project_id, summary, strategy, user_brief')
    .eq('id', SENTINEL_MEMORY_ID)
    .single()
  if (reErr || !memAfter) throw new Error(`STEP 5: re-select failed — ${reErr?.message ?? 'no row'}`)

  const ma = memAfter as {
    org_id: string; project_id: string
    summary: string; strategy: unknown; user_brief: string
  }
  assert(ma.org_id     === SENTINEL_ORG_ID,                           `agent_memory.org_id unchanged`)
  assert(ma.project_id === SENTINEL_PROJECT_ID,                       `agent_memory.project_id unchanged`)
  assert(ma.summary    === SENTINEL_SUMMARY,                          `agent_memory.summary unchanged`)
  assert(
    deepEqual(ma.strategy, SENTINEL_STRATEGY),
    `agent_memory.strategy unchanged (deep-equal, key-order-normalised)`,
  )
  assert(ma.user_brief === SENTINEL_USER_BRIEF,                       `agent_memory.user_brief unchanged`)

  // ── Result ────────────────────────────────────────────────────────────────

  passed = true
  console.log('\n[B2 SMOKE] ✓ GREEN — gate-5 passed')
  console.log('[B2 SMOKE] Checklist:')
  console.log(`  call #1 produced exactly 1 chunk           : YES (id=${chunkId1})`)
  console.log('  scope=decision, salience=0.7, name=aarav   : YES')
  console.log('  org_id + project_id derived from DB row    : YES')
  console.log('  embedding IS NOT NULL                      : YES')
  console.log('  call #2 count=1 AND id stable (early-exit) : YES')
  console.log('  bogus UUID throws + writes 0 chunks        : YES')
  console.log('  agent_memory unchanged (read-only)         : YES')

} catch (err) {
  console.error('\n[B2 SMOKE] ✗ RED —', err instanceof Error ? err.message : String(err))
} finally {
  await cleanup()
}

Deno.exit(passed ? 0 : 1)

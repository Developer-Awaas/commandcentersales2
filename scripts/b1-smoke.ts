/**
 * Phase B1 Smoke Test — proves writeMemory + retrieveMemory work end-to-end.
 *
 * Exercises the FULL round-trip under an AUTHENTICATED Supabase identity so
 * RLS WITH CHECK is exercised on the write, not just as service-role.
 *
 * Required env vars:
 *   SUPABASE_URL              (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY  — from Supabase dashboard → Settings → API
 *   SUPABASE_ANON_KEY          (or VITE_SUPABASE_ANON_KEY)
 *   OPENAI_API_KEY             — for text-embedding-3-small
 *
 * Run:
 *   deno run --allow-net --allow-env scripts/b1-smoke.ts
 *
 * Exit code 0 = B1 GREEN; exit code 1 = failure.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { writeMemory, retrieveMemory } from '../supabase/functions/_shared/agent-memory.ts'

// ─── Env ───────────────────────────────────────────────────────────────────

const SUPABASE_URL =
  Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY') ?? ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''

const missing: string[] = []
if (!SUPABASE_URL) missing.push('SUPABASE_URL or VITE_SUPABASE_URL')
if (!SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!ANON_KEY) missing.push('SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY')
if (!OPENAI_KEY) missing.push('OPENAI_API_KEY')

if (missing.length > 0) {
  console.error('[B1 SMOKE] ✗ Missing required env vars:')
  missing.forEach((v) => console.error(`  - ${v}`))
  Deno.exit(1)
}

// ─── Clients ───────────────────────────────────────────────────────────────

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Sentinel identifiers ──────────────────────────────────────────────────

const SENTINEL_ORG_ID = crypto.randomUUID()
const SENTINEL_EMAIL = `b1-smoke-${Date.now()}@sentinel.test.invalid`
const SENTINEL_PASS = `Smoke${Date.now()}Sentinel!`
// Unique content so the FTS portion of the hybrid score also fires.
const SENTINEL_CONTENT = `B1_SMOKE_SENTINEL unique test phrase ${crypto.randomUUID()}`
let SENTINEL_USER_ID = ''

// ─── Cleanup (always runs, even on failure) ────────────────────────────────

async function cleanup() {
  console.log('\n[CLEANUP] Starting...')

  // 1. Delete sentinel chunks (scoped to sentinel org for safety)
  const { error: chunkDelErr } = await adminClient
    .from('agent_memory_chunks')
    .delete()
    .like('content', 'B1_SMOKE_SENTINEL%')
    .eq('org_id', SENTINEL_ORG_ID)
  if (chunkDelErr) console.warn('[CLEANUP] chunk delete error (non-fatal):', chunkDelErr.message)

  // 2. Delete auth user (Supabase may cascade-delete the profile row)
  if (SENTINEL_USER_ID) {
    const { error: userDelErr } = await adminClient.auth.admin.deleteUser(SENTINEL_USER_ID)
    if (userDelErr) console.warn('[CLEANUP] auth user delete error (non-fatal):', userDelErr.message)
    // Belt-and-suspenders: explicit profile delete in case no cascade
    await adminClient.from('profiles').delete().eq('id', SENTINEL_USER_ID)
  }

  // 3. Delete sentinel org
  const { error: orgDelErr } = await adminClient
    .from('organizations')
    .delete()
    .eq('id', SENTINEL_ORG_ID)
  if (orgDelErr) console.warn('[CLEANUP] org delete error (non-fatal):', orgDelErr.message)

  // 4. Verify — count sentinel chunks that remain
  const { count, error: countErr } = await adminClient
    .from('agent_memory_chunks')
    .select('*', { count: 'exact', head: true })
    .like('content', 'B1_SMOKE_SENTINEL%')
    .eq('org_id', SENTINEL_ORG_ID)
  if (countErr) {
    console.error('[CLEANUP] count query failed:', countErr.message)
  } else {
    console.log(`[CLEANUP] Sentinel chunk count after cleanup: ${count}`)
    if (count === 0) {
      console.log('[CLEANUP] ✓ Sentinel count = 0')
    } else {
      console.error(`[CLEANUP] ✗ FAILED — ${count} sentinel chunk(s) remain`)
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

let passed = false

try {
  // ── SETUP ────────────────────────────────────────────────────────────────

  // 1. Create sentinel org (service-role bypasses org RLS)
  const { error: orgErr } = await adminClient
    .from('organizations')
    .insert({ id: SENTINEL_ORG_ID, name: 'B1 Smoke Sentinel Org' })
  if (orgErr) throw new Error(`Setup: org insert failed — ${orgErr.message}`)
  console.log(`[SETUP] Sentinel org created: ${SENTINEL_ORG_ID}`)

  // 2. Create sentinel auth user (email_confirm:true skips verification email)
  const { data: userResult, error: userErr } = await adminClient.auth.admin.createUser({
    email: SENTINEL_EMAIL,
    password: SENTINEL_PASS,
    email_confirm: true,
  })
  if (userErr || !userResult?.user) {
    throw new Error(`Setup: auth user creation failed — ${userErr?.message ?? 'no user returned'}`)
  }
  SENTINEL_USER_ID = userResult.user.id
  console.log(`[SETUP] Sentinel auth user created: ${SENTINEL_USER_ID}`)

  // 3. Upsert profile so get_current_user_org_id() returns SENTINEL_ORG_ID.
  //    Supabase's signup trigger may have auto-created a profile row; upsert
  //    handles both the auto-created and no-row cases.
  //    Service-role auth.uid()=null bypasses the self-escalation trigger.
  const { error: profileErr } = await adminClient
    .from('profiles')
    .upsert({ id: SENTINEL_USER_ID, org_id: SENTINEL_ORG_ID, role: 'member' })
  if (profileErr) throw new Error(`Setup: profile upsert failed — ${profileErr.message}`)
  console.log(`[SETUP] Profile set org_id=${SENTINEL_ORG_ID}`)

  // 4. Sign in as sentinel user to obtain an authenticated Supabase session.
  const { data: session, error: signInErr } = await anonClient.auth.signInWithPassword({
    email: SENTINEL_EMAIL,
    password: SENTINEL_PASS,
  })
  if (signInErr || !session?.session) {
    throw new Error(`Setup: sign-in failed — ${signInErr?.message ?? 'no session returned'}`)
  }
  console.log('[SETUP] Signed in as sentinel user (role=authenticated confirmed by JWT)')
  console.log(`[SETUP] JWT sub: ${session.session.user.id} (matches SENTINEL_USER_ID: ${session.session.user.id === SENTINEL_USER_ID})`)

  // The anonClient now carries the session JWT (sub=SENTINEL_USER_ID, role=authenticated).
  // All Supabase calls below go through this client — RLS sees the sentinel org.
  const authedClient = anonClient

  // ── ROUND-TRIP ───────────────────────────────────────────────────────────

  // Write
  console.log('\n[WRITE] Calling writeMemory (org_id=SENTINEL, scope=builder)...')
  const row = await writeMemory({
    supabase: authedClient,
    org_id: SENTINEL_ORG_ID,
    scope: 'builder',
    content: SENTINEL_CONTENT,
    salience: 0.8,
  })
  console.log(`[WRITE] Row inserted: id=${row.id}`)

  const embeddingNonNull = row.embedding !== null && row.embedding !== undefined
  console.log(`[WRITE] embedding non-null: ${embeddingNonNull ? '✓ YES' : '✗ NO'}`)
  if (!embeddingNonNull) {
    throw new Error(
      'FAIL: embedding is null — embed-on-write did not work (check OPENAI_API_KEY)',
    )
  }

  // Retrieve
  console.log('\n[RETRIEVE] Calling retrieveMemory...')
  const hits = await retrieveMemory({
    supabase: authedClient,
    query_text: SENTINEL_CONTENT,
    match_count: 5,
  })

  console.log(`[RETRIEVE] Got ${hits.length} hit(s)`)
  if (hits.length === 0) throw new Error('FAIL: no hits returned — RPC returned empty result set')

  const topHit = hits[0]
  const isTopHitSentinel = topHit.id === row.id
  console.log(`[RETRIEVE] #1 hit id       : ${topHit.id}`)
  console.log(`[RETRIEVE] #1 is sentinel  : ${isTopHitSentinel ? '✓ YES' : '✗ NO (wrong hit)'}`)
  console.log(`[RETRIEVE] #1 hybrid_score : ${topHit.hybrid_score}`)
  console.log(`[RETRIEVE] #1 similarity   : ${topHit.similarity}`)

  if (!isTopHitSentinel) {
    throw new Error(
      `FAIL: sentinel is not the #1 hit (got id=${topHit.id}, expected id=${row.id})`,
    )
  }

  passed = true
  console.log('\n[B1 SMOKE] ✓ GREEN — write→retrieve round-trip passed under authenticated role')
  console.log('[B1 SMOKE] Checklist:')
  console.log('  write returned non-null embedding : YES')
  console.log('  retrieve #1 hit was the sentinel  : YES')
  console.log(`  hybrid_score                      : ${topHit.hybrid_score}`)
  console.log('  probe ran as authenticated         : YES (signInWithPassword, no service-role for RW)')
} catch (err) {
  console.error('\n[B1 SMOKE] ✗ RED —', err instanceof Error ? err.message : String(err))
} finally {
  await cleanup()
}

Deno.exit(passed ? 0 : 1)

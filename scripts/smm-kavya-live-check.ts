/**
 * SMM Planner Prompt 0 — Part 2 live functional check.
 *
 * Runs one real Kavya turn per intent (plan / caption / reel) through the
 * deployed aarav-orchestrate Edge Function, under a throwaway NON-ADMIN
 * authenticated user (mirrors exactly what useAgentSession.ts does from the
 * browser — same Authorization header, same endpoint, same body shape).
 * Then reads back agent_turns / agent_messages / agent_interactions /
 * smm_calendar for the sentinel org as raw evidence, and cleans up.
 *
 * Required env vars:
 *   SUPABASE_URL              (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY         (or VITE_SUPABASE_ANON_KEY)
 *
 * Run:
 *   deno run --allow-net --allow-env scripts/smm-kavya-live-check.ts
 *
 * This hits the LIVE deployed function and spends real Anthropic credits
 * (one Sonnet call for 'plan', one Haiku call each for 'caption'/'reel').
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY') ?? ''

const missing: string[] = []
if (!SUPABASE_URL) missing.push('SUPABASE_URL or VITE_SUPABASE_URL')
if (!SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!ANON_KEY) missing.push('SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY')
if (missing.length > 0) {
  console.error('[SMM LIVE CHECK] ✗ Missing required env vars:')
  missing.forEach((v) => console.error(`  - ${v}`))
  Deno.exit(1)
}

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RUN_SUFFIX = Date.now()
const SENTINEL_ORG_ID = crypto.randomUUID()
const SENTINEL_EMAIL = `smm-live-check-${RUN_SUFFIX}@sentinel.test.invalid`
const SENTINEL_PASS = `Smoke${RUN_SUFFIX}Sentinel!`
const SESSION_ID = `smm-live-check-${RUN_SUFFIX}`
let SENTINEL_USER_ID = ''

const INTENTS: { intent: 'plan' | 'caption' | 'reel'; message: string }[] = [
  { intent: 'plan', message: 'Give me a monthly content calendar for Instagram and Facebook for our real estate project.' },
  { intent: 'caption', message: 'Write me an Instagram caption for a 3BHK launch offer.' },
  { intent: 'reel', message: 'Write a reel script idea showcasing our clubhouse amenities.' },
]

async function cleanup() {
  console.log('\n[CLEANUP] Starting...')
  const { error: calErr } = await adminClient.from('smm_calendar').delete().eq('org_id', SENTINEL_ORG_ID)
  if (calErr) console.warn('[CLEANUP] smm_calendar delete error (non-fatal):', calErr.message)

  const { error: msgErr } = await adminClient.from('agent_messages').delete().eq('org_id', SENTINEL_ORG_ID)
  if (msgErr) console.warn('[CLEANUP] agent_messages delete error (non-fatal):', msgErr.message)

  const { error: turnErr } = await adminClient.from('agent_turns').delete().eq('org_id', SENTINEL_ORG_ID)
  if (turnErr) console.warn('[CLEANUP] agent_turns delete error (non-fatal):', turnErr.message)

  const { error: intErr } = await adminClient.from('agent_interactions').delete().eq('org_id', SENTINEL_ORG_ID)
  if (intErr) console.warn('[CLEANUP] agent_interactions delete error (non-fatal):', intErr.message)

  if (SENTINEL_USER_ID) {
    const { error: userDelErr } = await adminClient.auth.admin.deleteUser(SENTINEL_USER_ID)
    if (userDelErr) console.warn('[CLEANUP] auth user delete error (non-fatal):', userDelErr.message)
    await adminClient.from('profiles').delete().eq('id', SENTINEL_USER_ID)
  }

  const { error: orgDelErr } = await adminClient.from('organizations').delete().eq('id', SENTINEL_ORG_ID)
  if (orgDelErr) console.warn('[CLEANUP] org delete error (non-fatal):', orgDelErr.message)

  console.log('[CLEANUP] Done.')
}

let allPassed = true

try {
  console.log('[SETUP] Creating sentinel org + non-admin user...')
  const { error: orgErr } = await adminClient
    .from('organizations')
    .insert({ id: SENTINEL_ORG_ID, name: `SMM Live Check Sentinel Org ${RUN_SUFFIX}` })
  if (orgErr) throw new Error(`Setup: org insert failed — ${orgErr.message}`)

  const { data: userResult, error: userErr } = await adminClient.auth.admin.createUser({
    email: SENTINEL_EMAIL,
    password: SENTINEL_PASS,
    email_confirm: true,
  })
  if (userErr || !userResult?.user) throw new Error(`Setup: user create failed — ${userErr?.message}`)
  SENTINEL_USER_ID = userResult.user.id

  const { error: profileErr } = await adminClient
    .from('profiles')
    .upsert({ id: SENTINEL_USER_ID, org_id: SENTINEL_ORG_ID, role: 'member' })
  if (profileErr) throw new Error(`Setup: profile upsert failed — ${profileErr.message}`)
  console.log(`[SETUP] Sentinel org=${SENTINEL_ORG_ID} user=${SENTINEL_USER_ID} (role=member, non-admin)`)

  const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({
    email: SENTINEL_EMAIL,
    password: SENTINEL_PASS,
  })
  if (signInErr || !signIn?.session) throw new Error(`Setup: sign-in failed — ${signInErr?.message}`)
  const accessToken = signIn.session.access_token
  console.log('[SETUP] Signed in as sentinel non-admin user.')

  const functionUrl = `${SUPABASE_URL}/functions/v1/aarav-orchestrate`

  for (const { intent, message } of INTENTS) {
    console.log(`\n=== INTENT: ${intent} ===`)
    console.log(`[REQUEST] message: "${message}"`)

    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ action: 'send_message', message, session_id: SESSION_ID }),
    })

    const status = res.status
    const json = await res.json().catch(() => null)
    console.log(`[RESPONSE] HTTP ${status}`)
    console.log(`[RESPONSE] body:`, JSON.stringify(json, null, 2))

    if (status !== 200) {
      allPassed = false
      console.error(`[FAIL] ${intent} — non-200 response`)
      continue
    }

    // Evidence: raw SELECT showing rows actually written, org-scoped.
    const { data: turns } = await adminClient
      .from('agent_turns')
      .select('*')
      .eq('org_id', SENTINEL_ORG_ID)
      .order('created_at', { ascending: false })
      .limit(1)
    console.log(`[DB] agent_turns (latest):`, JSON.stringify(turns, null, 2))

    const { data: messages } = await adminClient
      .from('agent_messages')
      .select('*')
      .eq('org_id', SENTINEL_ORG_ID)
      .order('created_at', { ascending: false })
      .limit(2)
    console.log(`[DB] agent_messages (latest 2):`, JSON.stringify(messages, null, 2))

    const { data: interactions } = await adminClient
      .from('agent_interactions')
      .select('*')
      .eq('org_id', SENTINEL_ORG_ID)
      .eq('agent', 'kavya')
      .order('created_at', { ascending: false })
      .limit(1)
    console.log(`[DB] agent_interactions (latest kavya row):`, JSON.stringify(interactions, null, 2))

    if (intent === 'plan') {
      const { data: calRows, count } = await adminClient
        .from('smm_calendar')
        .select('*', { count: 'exact' })
        .eq('org_id', SENTINEL_ORG_ID)
      console.log(`[DB] smm_calendar row count for sentinel org: ${count}`)
      console.log(`[DB] smm_calendar sample (first 2):`, JSON.stringify(calRows?.slice(0, 2), null, 2))
      if (!count || count === 0) {
        allPassed = false
        console.error('[FAIL] plan intent produced 0 smm_calendar rows')
      }
    }

    if (turns?.[0]?.status === 'failed') {
      allPassed = false
      console.error(`[FAIL] ${intent} — agent_turns.status = 'failed'`)
    }
  }

  console.log(allPassed ? '\n[SMM LIVE CHECK] ✓ All intents completed with row evidence' : '\n[SMM LIVE CHECK] ✗ One or more intents failed')
} catch (err) {
  allPassed = false
  console.error('\n[SMM LIVE CHECK] ✗ ERROR —', err instanceof Error ? err.message : String(err))
} finally {
  await cleanup()
}

Deno.exit(allPassed ? 0 : 1)

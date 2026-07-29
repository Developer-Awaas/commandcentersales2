/**
 * Diagnostic-only live check for "Ad Creatives page generation not working".
 * Runs ONE real default-path turn (send_message, non-Kavya/Dhruv intent) through
 * the deployed aarav-orchestrate Edge Function under a throwaway sentinel org+user,
 * mirroring exactly what useAgentSession.ts sends from the browser. Reads back
 * agent_turns/agent_interactions as raw evidence, then cleans up.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 * Run: deno run --allow-net --allow-env --env-file=.env.cc-test.local scripts/diag-ad-creatives-live-check.ts
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
  console.error('[DIAG] Missing required env vars:', missing.join(', '))
  Deno.exit(1)
}

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const RUN_SUFFIX = Date.now()
const SENTINEL_ORG_ID = crypto.randomUUID()
const SENTINEL_EMAIL = `ad-creatives-diag-${RUN_SUFFIX}@sentinel.test.invalid`
const SENTINEL_PASS = `Diag${RUN_SUFFIX}Sentinel!`
const SESSION_ID = `ad-creatives-diag-${RUN_SUFFIX}`
let SENTINEL_USER_ID = ''

async function cleanup() {
  console.log('\n[CLEANUP] Starting...')
  await adminClient.from('agent_interactions').delete().eq('org_id', SENTINEL_ORG_ID)
  await adminClient.from('agent_messages').delete().eq('org_id', SENTINEL_ORG_ID)
  await adminClient.from('agent_turns').delete().eq('org_id', SENTINEL_ORG_ID)
  if (SENTINEL_USER_ID) {
    await adminClient.auth.admin.deleteUser(SENTINEL_USER_ID)
    await adminClient.from('profiles').delete().eq('id', SENTINEL_USER_ID)
  }
  await adminClient.from('organizations').delete().eq('id', SENTINEL_ORG_ID)
  console.log('[CLEANUP] Done.')
}

try {
  console.log('[SETUP] Creating sentinel org + non-admin user (no brand_kit — tests Diya fail-soft flag path too)...')
  const { error: orgErr } = await adminClient.from('organizations').insert({ id: SENTINEL_ORG_ID, name: `AdCreatives Diag Sentinel Org ${RUN_SUFFIX}` })
  if (orgErr) throw new Error(`Setup: org insert failed — ${orgErr.message}`)

  const { data: userResult, error: userErr } = await adminClient.auth.admin.createUser({
    email: SENTINEL_EMAIL, password: SENTINEL_PASS, email_confirm: true,
  })
  if (userErr || !userResult?.user) throw new Error(`Setup: user create failed — ${userErr?.message}`)
  SENTINEL_USER_ID = userResult.user.id

  const { error: profileErr } = await adminClient.from('profiles').upsert({ id: SENTINEL_USER_ID, org_id: SENTINEL_ORG_ID, role: 'member', tier: 'profile_2' })
  if (profileErr) throw new Error(`Setup: profile upsert failed — ${profileErr.message}`)
  console.log(`[SETUP] org=${SENTINEL_ORG_ID} user=${SENTINEL_USER_ID}`)

  const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({ email: SENTINEL_EMAIL, password: SENTINEL_PASS })
  if (signInErr || !signIn?.session) throw new Error(`Setup: sign-in failed — ${signInErr?.message}`)
  const accessToken = signIn.session.access_token
  console.log('[SETUP] Signed in.')

  const functionUrl = `${SUPABASE_URL}/functions/v1/aarav-orchestrate`
  const message = 'Create a campaign for my new 2BHK apartment launch in Bhubaneswar, targeting young families.'
  console.log(`\n[REQUEST] action=send_message message="${message}"`)

  const start = Date.now()
  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY },
    body: JSON.stringify({ action: 'send_message', message, session_id: SESSION_ID }),
  })
  const elapsedMs = Date.now() - start
  const status = res.status
  const json = await res.json().catch(() => null)
  console.log(`[RESPONSE] HTTP ${status} in ${elapsedMs}ms`)
  console.log(`[RESPONSE] body:`, JSON.stringify(json, null, 2))

  const { data: turns } = await adminClient.from('agent_turns').select('*').eq('org_id', SENTINEL_ORG_ID).order('created_at', { ascending: false }).limit(1)
  console.log(`\n[DB] agent_turns (latest):`, JSON.stringify(turns, null, 2))

  const { data: interactions } = await adminClient.from('agent_interactions').select('*').eq('org_id', SENTINEL_ORG_ID).order('created_at', { ascending: false })
  console.log(`\n[DB] agent_interactions (all, this org):`, JSON.stringify(interactions, null, 2))
} catch (err) {
  console.error('[DIAG] ✗ Exception:', err instanceof Error ? err.message : err)
} finally {
  await cleanup()
}

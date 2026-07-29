/**
 * One-off diagnostic: verifies AgentRequest.variant_count=1 (testing-only)
 * actually reduces Aanya's default-path generation to a single angle.
 * Same sentinel-org/user pattern as diag-ad-creatives-live-check.ts.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const RUN_SUFFIX = Date.now()
const SENTINEL_ORG_ID = crypto.randomUUID()
const SENTINEL_EMAIL = `variant-count-diag-${RUN_SUFFIX}@sentinel.test.invalid`
const SENTINEL_PASS = `Diag${RUN_SUFFIX}Sentinel!`
let SENTINEL_USER_ID = ''

async function cleanup() {
  await adminClient.from('agent_interactions').delete().eq('org_id', SENTINEL_ORG_ID)
  await adminClient.from('agent_messages').delete().eq('org_id', SENTINEL_ORG_ID)
  await adminClient.from('agent_turns').delete().eq('org_id', SENTINEL_ORG_ID)
  if (SENTINEL_USER_ID) {
    await adminClient.auth.admin.deleteUser(SENTINEL_USER_ID)
    await adminClient.from('profiles').delete().eq('id', SENTINEL_USER_ID)
  }
  await adminClient.from('organizations').delete().eq('id', SENTINEL_ORG_ID)
}

try {
  await adminClient.from('organizations').insert({ id: SENTINEL_ORG_ID, name: `VariantCount Diag ${RUN_SUFFIX}` })
  const { data: userResult } = await adminClient.auth.admin.createUser({ email: SENTINEL_EMAIL, password: SENTINEL_PASS, email_confirm: true })
  SENTINEL_USER_ID = userResult!.user!.id
  await adminClient.from('profiles').upsert({ id: SENTINEL_USER_ID, org_id: SENTINEL_ORG_ID, role: 'member', tier: 'profile_2' })
  const { data: signIn } = await anonClient.auth.signInWithPassword({ email: SENTINEL_EMAIL, password: SENTINEL_PASS })
  const accessToken = signIn!.session!.access_token

  const start = Date.now()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/aarav-orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY },
    body: JSON.stringify({ action: 'send_message', message: 'Create a campaign for a 3BHK launch in Cuttack.', session_id: `variant-count-diag-${RUN_SUFFIX}`, variant_count: 1 }),
  })
  const elapsedMs = Date.now() - start
  const json = await res.json().catch(() => null)
  console.log(`[RESPONSE] HTTP ${res.status} in ${elapsedMs}ms`)
  console.log(`[RESPONSE] variants count: ${json?.canvas?.creatives?.length}`)
  console.log(`[RESPONSE] variant angles: ${JSON.stringify(json?.canvas?.creatives?.map((c: any) => c.angle))}`)
  if (res.status !== 200) console.log(`[RESPONSE] body:`, JSON.stringify(json, null, 2))
} catch (err) {
  console.error('[DIAG] Exception:', err instanceof Error ? err.message : err)
} finally {
  await cleanup()
}

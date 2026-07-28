import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ORG_ID = '1a0f7ac3-8053-4aee-824c-75f27681ce64'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
  email: 'reviewer@awaas.internal', password: Deno.env.get('REVIEWER_PASSWORD')!,
})
if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`)
const accessToken = signIn.session.access_token
console.log('[SMOKE] Signed in as reviewer.\n')

const functionUrl = `${SUPABASE_URL}/functions/v1/aarav-orchestrate`

async function callAarav(message: string, sessionId: string) {
  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY },
    body: JSON.stringify({ action: 'send_message', message, session_id: sessionId }),
  })
  const json = await res.json()
  return { status: res.status, json }
}

// 1. Kavya — plan (proves the F1 fix live)
console.log('=== Kavya: plan ===')
const plan = await callAarav('Give me a monthly content calendar for Instagram and Facebook.', 'smoke-kavya-plan')
console.log(`HTTP ${plan.status} | delegations: ${JSON.stringify(plan.json?.delegations)}`)
console.log(`message: ${plan.json?.message?.content}`)

// 2. Kavya — caption
console.log('\n=== Kavya: caption ===')
const caption = await callAarav('Write an Instagram caption for our 3BHK launch offer.', 'smoke-kavya-caption')
console.log(`HTTP ${caption.status} | delegations: ${JSON.stringify(caption.json?.delegations)}`)

// 3. Dhruv — reactive turn against real seeded metrics
console.log('\n=== Dhruv: reactive ===')
const dhruv = await callAarav('How are my campaigns performing this month?', 'smoke-dhruv')
console.log(`HTTP ${dhruv.status} | delegations: ${JSON.stringify(dhruv.json?.delegations)}`)
console.log(`message: ${dhruv.json?.message?.content?.slice(0, 300)}`)

// 4. Arjun -> Aanya — one full campaign turn (real image gen, consumes 3 of the 300 image budget)
console.log('\n=== Arjun -> Aanya: full campaign turn ===')
const campaign = await callAarav('Create a Meta ad campaign for our 3BHK project targeting IT professionals in Bhubaneswar.', 'smoke-campaign')
console.log(`HTTP ${campaign.status} | delegations: ${JSON.stringify(campaign.json?.delegations)}`)
console.log(`turn_id: ${campaign.json?.turn_id}`)
const variants = campaign.json?.canvas?.creatives
console.log(`creative variants returned: ${Array.isArray(variants) ? variants.length : 'n/a'}`)

// Evidence: image budget counter incremented
const { data: budget } = await admin.from('review_generation_budget').select('*').single()
console.log(`\n[EVIDENCE] review_generation_budget: ${JSON.stringify(budget)}`)

// Evidence: agent_interactions rows for this org today
const { data: interactions } = await admin.from('agent_interactions').select('agent, model, cost_usd, created_at')
  .eq('org_id', ORG_ID).order('created_at', { ascending: false }).limit(10)
console.log(`[EVIDENCE] latest agent_interactions:\n${JSON.stringify(interactions, null, 2)}`)

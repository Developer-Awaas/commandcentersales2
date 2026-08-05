/**
 * Internal test org seed — creates a single 'ZZ-INTERNAL-TEST' org + one
 * auth user on PROD, so manual/CI testing has a real org to write against
 * without ever touching a real customer's data.
 *
 * Idempotent: looks up the org by name and the user by email first, reuses
 * them instead of duplicating. Safe to re-run.
 *
 * DELIBERATELY THE OPPOSITE GUARD of scripts/seed-cc-test-demo.ts (which
 * refuses to run against anything but CC-TEST) — this script refuses to run
 * against anything but PROD, since the internal test org is meant to live
 * there permanently as a safe, always-available write target.
 *
 * No org_integrations row is created for this org — an internal test org
 * has no real Meta/Canva credentials to seed, and this script must never
 * become a place where real credentials get copied in from elsewhere.
 *
 * Required env vars:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)                — must contain the PROD project ref
 *   SUPABASE_SERVICE_ROLE_KEY
 *   INTERNAL_TEST_USER_EMAIL
 *   INTERNAL_TEST_USER_PASSWORD                        — generate randomly, never hand-type a real password
 *
 * Run:
 *   deno run --allow-net --allow-env --env-file=.env.internal-test.local scripts/seed-internal-test-org.ts
 *
 * Cleanup (if ever needed):
 *   DELETE FROM profiles WHERE org_id = (SELECT id FROM organizations WHERE name = 'ZZ-INTERNAL-TEST');
 *   DELETE FROM organizations WHERE name = 'ZZ-INTERNAL-TEST';
 *   -- then delete the auth user via the Dashboard or auth.admin.deleteUser()
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const USER_EMAIL = Deno.env.get('INTERNAL_TEST_USER_EMAIL') ?? ''
const USER_PASSWORD = Deno.env.get('INTERNAL_TEST_USER_PASSWORD') ?? ''

if (!SUPABASE_URL || !SERVICE_KEY || !USER_EMAIL || !USER_PASSWORD) {
  console.error('[SEED] Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_TEST_USER_EMAIL, INTERNAL_TEST_USER_PASSWORD')
  Deno.exit(1)
}

// Guard: this creates a permanent org + user and must only ever run against
// PROD (mpvdpdxzqnidwyihyhbn) — never CC-TEST, never a stray local project.
if (!SUPABASE_URL.includes('mpvdpdxzqnidwyihyhbn')) {
  console.error(`[SEED] Refusing to run — SUPABASE_URL (${SUPABASE_URL}) is not the PROD project.`)
  Deno.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ORG_NAME = 'ZZ-INTERNAL-TEST'

async function main() {
  // ── Org (idempotent lookup by name) ─────────────────────────────────────
  let orgId: string
  const { data: existingOrg } = await supabase
    .from('organizations').select('id').eq('name', ORG_NAME).maybeSingle()

  if (existingOrg) {
    orgId = existingOrg.id
    console.log(`[SEED] Reusing existing org: ${orgId}`)
  } else {
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name: ORG_NAME,
        primary_city: 'Bhubaneswar',
        secondary_city: 'Cuttack',
        tone_of_voice: 'Internal test fixture — not a real customer.',
      })
      .select('id').single()
    if (orgErr || !org) throw new Error(`org insert failed: ${orgErr?.message}`)
    orgId = org.id
    console.log(`[SEED] Created org: ${orgId}`)
  }

  // ── Auth user (idempotent lookup by email) ──────────────────────────────
  let userId: string
  const { data: existingUsers, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`)
  const existingUser = existingUsers.users.find((u) => u.email === USER_EMAIL)

  if (existingUser) {
    userId = existingUser.id
    console.log(`[SEED] Reusing existing user: ${userId}`)
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: USER_EMAIL,
      password: USER_PASSWORD,
      email_confirm: true,
    })
    if (createErr || !created.user) throw new Error(`createUser failed: ${createErr?.message}`)
    userId = created.user.id
    console.log(`[SEED] Created user: ${userId}`)
  }

  // handle_new_user() trigger auto-creates a profiles row on signup with
  // org_id NULL — link it to the test org here (idempotent upsert covers
  // both the fresh-create and reuse cases).
  const { error: profileErr } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      email: USER_EMAIL,
      full_name: 'ZZ Internal Test User',
      org_id: orgId,
      role: 'admin',
    }, { onConflict: 'id' })
  if (profileErr) throw new Error(`profile upsert failed: ${profileErr.message}`)
  console.log('[SEED] profile linked to org')

  console.log(`\n[SEED] Done. org_id=${orgId} user_id=${userId}`)
  console.log('[SEED] All future test writes should scope to this org_id.')
}

main().catch((err) => {
  console.error('[SEED] Failed:', err instanceof Error ? err.message : err)
  Deno.exit(1)
})

// Idempotent seed for the Playwright e2e run: ensures a single dedicated
// project ("ZZ-E2E Test Project") exists under the ZZ-INTERNAL-TEST org so
// the wizard's project dropdown always has something to select, and so
// cleanup-e2e.mjs has a precise, disposable scope (everything the test
// creates is reachable from this project's id). Runs with the service-role
// key (bypasses RLS) — same trust boundary as the isolation harness seed.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2E_ORG_ID — all required.
// E2E_ORG_ID has no default on purpose: the target org differs per
// environment (TEST on review-build, PROD on main), and a baked-in default
// would silently seed the wrong project's org when the variable is missing.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = process.env.E2E_ORG_ID?.trim();
export const E2E_PROJECT_NAME = 'ZZ-E2E Test Project';

if (!URL || !KEY) {
  console.error('seed-e2e: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}
if (!ORG_ID) {
  console.error(
    'seed-e2e: E2E_ORG_ID is empty or unset. Set it on the branch\'s GitHub ' +
    'environment (review-build = the TEST org, main = PROD ZZ-INTERNAL-TEST). ' +
    'Refusing to guess an org to write into.',
  );
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: existing, error: selErr } = await supabase
  .from('projects')
  .select('id')
  .eq('org_id', ORG_ID)
  .eq('name', E2E_PROJECT_NAME)
  .maybeSingle();
if (selErr) { console.error('seed-e2e: lookup failed:', selErr.message); process.exit(1); }

if (existing) {
  console.log(`seed-e2e: project already present (id=${existing.id})`);
  process.exit(0);
}

const { data: created, error: insErr } = await supabase
  .from('projects')
  .insert({
    org_id: ORG_ID,
    name: E2E_PROJECT_NAME,
    locality: 'Patia',
    city: 'Bhubaneswar',
    price_range_lacs: '55-75',
    units_remaining: 12,
    usps: 'Riverfront view, gated community, ready-to-move',
    is_active: true,
    priority: 'Medium',
    status: 'Active',
  })
  .select('id')
  .single();
if (insErr) { console.error('seed-e2e: insert failed:', insErr.message); process.exit(1); }

console.log(`seed-e2e: project created (id=${created.id})`);

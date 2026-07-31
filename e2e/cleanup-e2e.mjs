// Removes everything the Playwright e2e run created on PROD, scoped
// precisely to the dedicated "ZZ-E2E Test Project" under ZZ-INTERNAL-TEST
// (seed-e2e.mjs). Runs as an always() CI step so a mid-flow test failure
// never leaks campaigns / tool_outputs / creative_assets. The project row
// itself is intentionally KEPT (reused next run). Service-role key,
// bypasses RLS — same trust boundary as the isolation-harness cleanup.
//
// Deletion order matters: tool_outputs + creative_assets reference
// campaigns via campaign_id (ON DELETE SET NULL, so children aren't
// cascade-removed) — remove the children first, then the campaigns.
// Storage objects for deleted creative_assets are left behind (orphaned
// files cost space, not correctness — same philosophy as deleteToolOutput).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional E2E_ORG_ID.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = process.env.E2E_ORG_ID ?? '983c7c08-ffaf-402b-981a-a9cd22615cae';
const E2E_PROJECT_NAME = 'ZZ-E2E Test Project';

if (!URL || !KEY) {
  console.error('cleanup-e2e: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: project, error: projErr } = await supabase
  .from('projects')
  .select('id')
  .eq('org_id', ORG_ID)
  .eq('name', E2E_PROJECT_NAME)
  .maybeSingle();
if (projErr) { console.error('cleanup-e2e: project lookup failed:', projErr.message); process.exit(1); }
if (!project) { console.log('cleanup-e2e: no ZZ-E2E project — nothing to clean.'); process.exit(0); }

const projectId = project.id;

// Campaigns created by the wizard from this project.
const { data: campaigns } = await supabase.from('campaigns').select('id').eq('project_id', projectId);
const campaignIds = (campaigns ?? []).map((c) => c.id);

let removed = { tool_outputs: 0, creative_assets: 0, campaigns: 0 };

// tool_outputs: those tied to the test's campaigns, plus any standalone
// ones from the org left with campaign_id NULL (a strategy save that never
// reached campaign creation on a failed run) — scope the latter by org.
if (campaignIds.length > 0) {
  const { count } = await supabase.from('tool_outputs').delete({ count: 'exact' }).in('campaign_id', campaignIds);
  removed.tool_outputs += count ?? 0;
}
{
  const { count } = await supabase.from('tool_outputs').delete({ count: 'exact' }).eq('org_id', ORG_ID).is('campaign_id', null);
  removed.tool_outputs += count ?? 0;
}

// creative_assets scoped to the E2E project (covers every generated image).
{
  const { count } = await supabase.from('creative_assets').delete({ count: 'exact' }).eq('project_id', projectId);
  removed.creative_assets += count ?? 0;
}

if (campaignIds.length > 0) {
  const { count } = await supabase.from('campaigns').delete({ count: 'exact' }).in('id', campaignIds);
  removed.campaigns += count ?? 0;
}

console.log(`cleanup-e2e: removed ${removed.campaigns} campaign(s), ${removed.tool_outputs} tool_output(s), ${removed.creative_assets} creative_asset(s). Project ${projectId} kept.`);

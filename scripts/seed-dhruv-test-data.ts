/**
 * Seed script — generates 31 days of synthetic campaign_metrics for Dhruv testing.
 *
 * Run once against your local/staging Supabase:
 *   deno run --allow-net --allow-env scripts/seed-dhruv-test-data.ts
 *
 * Requires env vars (or .env.local):
 *   SUPABASE_URL=https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 *   SEED_ORG_ID=<your-org-uuid>
 *
 * Delete seed data when real Meta data starts flowing:
 *   DELETE FROM campaign_metrics WHERE campaign_id LIKE 'seed-%';
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ORG_ID       = Deno.env.get('SEED_ORG_ID')

if (!SUPABASE_URL || !SERVICE_KEY || !ORG_ID) {
  console.error('Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_ORG_ID')
  Deno.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// Three campaigns with different characteristics so alert detection fires
const CAMPAIGNS = [
  {
    id: 'seed-awareness-oasis2',
    name: 'Oasis 2 — Awareness',
    baseCpl: 320, baseSpend: 3000, baseLeads: 9,
    ctr: 0.028, frequency: 1.4,
  },
  {
    id: 'seed-consideration-oasis2',
    name: 'Oasis 2 — Consideration',
    baseCpl: 480, baseSpend: 2400, baseLeads: 5,
    ctr: 0.019, frequency: 2.1,
  },
  {
    id: 'seed-conversion-oasis2',
    name: 'Oasis 2 — Conversion',
    baseCpl: 750, baseSpend: 1500, baseLeads: 2,
    ctr: 0.011, frequency: 2.9,   // >2.5 → ad fatigue alert will fire
  },
]

function jitter(base: number, pct = 0.3): number {
  return base * (1 + (Math.random() - 0.5) * 2 * pct)
}

const rows = []

for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
  const date = new Date()
  date.setDate(date.getDate() - dayOffset)
  const dateStr = date.toISOString().split('T')[0]

  for (const camp of CAMPAIGNS) {
    // Simulate a CPL spike in the last 7 days for the awareness campaign
    const cplMultiplier = camp.id === 'seed-awareness-oasis2' && dayOffset < 7 ? 1.7 : 1.0
    const spend     = jitter(camp.baseSpend)
    const leads     = Math.max(1, Math.round(jitter(camp.baseLeads)))
    const cpl       = (spend / leads) * cplMultiplier
    const impressions = Math.round(spend / 0.05)  // rough CPM assumption
    const clicks    = Math.round(impressions * jitter(camp.ctr, 0.1))

    rows.push({
      org_id: ORG_ID,
      campaign_id: camp.id,
      campaign_name: camp.name,
      date_start: dateStr,
      date_stop: dateStr,
      spend: Math.round(spend * 100) / 100,
      leads,
      cpl: Math.round(cpl * 100) / 100,
      ctr: Math.round(jitter(camp.ctr, 0.1) * 1000000) / 1000000,
      frequency: Math.round(jitter(camp.frequency, 0.1) * 100) / 100,
      impressions,
      clicks,
      reach: Math.round(impressions * 0.7),
      platform: 'meta',
      synced_at: new Date().toISOString(),
    })
  }
}

console.log(`Inserting ${rows.length} rows for org ${ORG_ID}…`)
const { error } = await supabase.from('campaign_metrics').upsert(rows, {
  onConflict: 'org_id,campaign_id,date_start,date_stop,platform',
})

if (error) {
  console.error('Insert failed:', error.message)
  Deno.exit(1)
}

console.log(`✓ Seeded ${rows.length} rows across ${CAMPAIGNS.length} campaigns.`)
console.log('Expected alerts after buildMetricsContext():')
console.log('  • CPL spike (high) — seed-awareness-oasis2 (last 7d CPL ~1.7× the 30d avg)')
console.log('  • Ad fatigue (medium) — seed-conversion-oasis2 (frequency ~2.9)')
console.log('')
console.log('To remove seed data:')
console.log("  DELETE FROM campaign_metrics WHERE campaign_id LIKE 'seed-%';")

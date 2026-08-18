/**
 * CC-TEST demo org seed — Prompt B Stage 2 step 1.
 *
 * Seeds "Demo Builder Pvt Ltd", one Bhubaneswar project, and enough
 * campaigns/metrics/creatives/calendar content so every review-build page
 * (Dashboard, Strategy, Creatives, CampaignMetricsChart, SMM Calendar/
 * Planner/Analyzer, Organic) renders non-empty for a reviewer, before any
 * live agent call is made.
 *
 * DB-only — no dependency on which commit review-build eventually forks
 * from. Safe to re-run: looks up the org by name first and reuses it
 * instead of duplicating rows.
 *
 * Required env vars:
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   deno run --allow-net --allow-env --env-file=.env.cc-test.local scripts/seed-cc-test-demo.ts
 */

import { assertMetricSeedAllowed } from './lib/seed-guard.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[SEED] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  Deno.exit(1)
}

// Guard: this script writes real demo data and must never run against prod
// by a copy-pasted env file. yelmuykbqdyeikgbmkoq is CC-TEST.
if (!SUPABASE_URL.includes('yelmuykbqdyeikgbmkoq')) {
  console.error(`[SEED] Refusing to run — SUPABASE_URL (${SUPABASE_URL}) is not the CC-TEST project.`)
  Deno.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ORG_NAME = 'Demo Builder Pvt Ltd'

function jitter(base: number, pct = 0.25): number {
  return Math.round(base * (1 + (Math.random() - 0.5) * 2 * pct) * 100) / 100
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

function isoDaysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

// Storage buckets are never created by SQL migrations — a fresh project has
// zero. Found the hard way: Aanya's image-gen succeeded (billed) but every
// upload then failed because 'brand-assets' didn't exist. Idempotent:
// createBucket errors (harmlessly) if the bucket is already there.
const REQUIRED_BUCKETS = ['brand-assets', 'creative-assets', 'project-assets', 'quick-references']

async function ensureBuckets() {
  for (const name of REQUIRED_BUCKETS) {
    const { error } = await supabase.storage.createBucket(name, { public: true })
    if (error && !error.message.toLowerCase().includes('already exists')) {
      console.error(`[SEED] bucket ${name} creation error (non-fatal):`, error.message)
    } else {
      console.log(`[SEED] bucket ready: ${name}`)
    }
  }
}

async function main() {
  await ensureBuckets()

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
        brand_colors: '#1B4332, #2DD4A8, #FFFFFF',
        tone_of_voice: 'Professional & Premium',
      })
      .select('id').single()
    if (orgErr || !org) throw new Error(`org insert failed: ${orgErr?.message}`)
    orgId = org.id
    console.log(`[SEED] Created org: ${orgId}`)
  }

  // ── Brand kit (one per org) ──────────────────────────────────────────────
  await supabase.from('brand_kits').upsert({
    org_id: orgId,
    primary_color: '#1B4332',
    secondary_color: '#2DD4A8',
    accent_color: '#C9A150',
    tagline: 'Homes Built on Trust',
    brand_voice: 'Warm, aspirational, straightforward — no jargon.',
    brand_story: 'Demo Builder has delivered mid-premium residential projects across Bhubaneswar and Cuttack for over a decade.',
    design_aesthetic: 'warm_aspirational',
    default_languages: ['en', 'or'],
  }, { onConflict: 'org_id' })
  console.log('[SEED] brand_kits upserted')

  // ── Project ───────────────────────────────────────────────────────────────
  const { data: existingProject } = await supabase
    .from('projects').select('id').eq('org_id', orgId).eq('name', 'Ananta Enclave').maybeSingle()

  let projectId: string
  if (existingProject) {
    projectId = existingProject.id
    console.log(`[SEED] Reusing existing project: ${projectId}`)
  } else {
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({
        org_id: orgId,
        name: 'Ananta Enclave',
        locality: 'Patia',
        city: 'Bhubaneswar',
        total_units: 180,
        units_remaining: 62,
        price_min: 4500000,
        price_max: 8200000,
        price_range_lacs: '45-82',
        priority: 'High',
        is_active: true,
        status: 'Under Construction',
        unit_types: '2BHK, 3BHK',
        carpet_area_range: '850-1450 sqft',
        usps: 'Clubhouse with rooftop pool, 24x7 security, EV charging, 5-min from Patia IT hub',
        amenities: 'Clubhouse, swimming pool, gym, kids play area, landscaped gardens, EV charging',
        target_buyer: 'End-user',
        budget_segment: 'Mid-premium',
        rera_number: 'RERA/OD/2026/DEMO-001',
        nearest_landmarks: 'Patia IT hub, KIIT, DAV Public School',
        expected_possession: 'Dec 2027',
      })
      .select('id').single()
    if (projErr || !project) throw new Error(`project insert failed: ${projErr?.message}`)
    projectId = project.id
    console.log(`[SEED] Created project: ${projectId}`)
  }

  // ── Campaigns (3, matching seed-dhruv-test-data.ts's alert-triggering shape) ──
  const campaignDefs = [
    { name: 'Ananta Enclave — Awareness', funnel_stage: 'TOFU', platform: 'meta', baseCpl: 320, baseSpend: 3000, baseLeads: 9, ctr: 0.028, frequency: 1.4 },
    { name: 'Ananta Enclave — Consideration', funnel_stage: 'MOFU', platform: 'meta', baseCpl: 480, baseSpend: 2400, baseLeads: 5, ctr: 0.019, frequency: 2.1 },
    { name: 'Ananta Enclave — Conversion', funnel_stage: 'BOFU', platform: 'meta', baseCpl: 750, baseSpend: 1500, baseLeads: 2, ctr: 0.011, frequency: 2.6 },
  ]

  const campaignIds: string[] = []
  for (const c of campaignDefs) {
    const { data: existingCamp } = await supabase
      .from('campaigns').select('id').eq('org_id', orgId).eq('name', c.name).maybeSingle()
    if (existingCamp) {
      campaignIds.push(existingCamp.id)
      continue
    }
    const { data: camp, error: campErr } = await supabase
      .from('campaigns')
      .insert({
        org_id: orgId,
        project_id: projectId,
        name: c.name,
        campaign_name: c.name,
        platform: c.platform,
        status: 'active',
        funnel_stage: c.funnel_stage,
        ad_type: 'CTWA',
        objective: c.funnel_stage === 'TOFU' ? 'Awareness' : c.funnel_stage === 'MOFU' ? 'Traffic' : 'Messages',
        creative_status: 'ready',
        budget: { daily: c.baseSpend / 30, currency: 'INR' },
      })
      .select('id').single()
    if (campErr || !camp) throw new Error(`campaign insert failed: ${campErr?.message}`)
    campaignIds.push(camp.id)
  }
  console.log(`[SEED] ${campaignIds.length} campaigns ready`)

  // ── daily_metrics + campaign_metrics — 30 days per campaign ──────────────
  const dailyRows = []
  const campMetricRows = []
  for (let i = 0; i < campaignDefs.length; i++) {
    const c = campaignDefs[i]
    const campaignId = campaignIds[i]
    for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
      const date = isoDaysAgo(dayOffset)
      const spend = jitter(c.baseSpend / 30)
      const leads = Math.max(0, Math.round(jitter(c.baseLeads / 30, 0.5)))
      const impressions = Math.round(jitter(8000))
      const clicks = Math.round(impressions * c.ctr)
      dailyRows.push({
        org_id: orgId, project_id: projectId, campaign_id: campaignId, date,
        spend, leads, impressions, clicks,
        cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : c.baseCpl,
        ctr: c.ctr, frequency: c.frequency, reach: Math.round(impressions * 0.7),
        results: leads, conversions: Math.round(leads * 0.3), data_source: 'seed',
      })
      campMetricRows.push({
        org_id: orgId, project_id: projectId,
        campaign_id: `seed-${campaignId}`, campaign_name: c.name,
        ad_account_id: 'act_seed_demo', date_start: date, date_stop: date,
        impressions, clicks, reach: Math.round(impressions * 0.7), spend,
        ctr: c.ctr, frequency: c.frequency, leads,
        cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
        platform: 'meta',
      })
    }
  }
  const { error: dmErr } = await supabase.from('daily_metrics').insert(dailyRows)
  if (dmErr) console.error('[SEED] daily_metrics insert error (non-fatal):', dmErr.message)
  else console.log(`[SEED] ${dailyRows.length} daily_metrics rows inserted`)

  // Refuses unless this org is allowlisted (or SEED_ALLOW_ORG names it).
  // Fake ad metrics in the org a Meta reviewer logs into are indistinguishable
  // from real synced ones in every UI that reads this table.
  assertMetricSeedAllowed(orgId)
  const { error: cmErr } = await supabase.from('campaign_metrics').upsert(campMetricRows, {
    onConflict: 'org_id,campaign_id,date_start,date_stop,platform',
  })
  if (cmErr) console.error('[SEED] campaign_metrics insert error (non-fatal):', cmErr.message)
  else console.log(`[SEED] ${campMetricRows.length} campaign_metrics rows inserted`)

  // ── benchmarks ────────────────────────────────────────────────────────────
  const benchmarkRows = [
    { org_id: orgId, project_id: projectId, metric_name: 'CPL', current_value: 410, avg_7d: 395, avg_14d: 430, trend: 'down', status: 'good' },
    { org_id: orgId, project_id: projectId, metric_name: 'CTR', current_value: 0.021, avg_7d: 0.019, avg_14d: 0.018, trend: 'up', status: 'good' },
    { org_id: orgId, project_id: projectId, metric_name: 'Frequency', current_value: 2.3, avg_7d: 2.1, avg_14d: 1.9, trend: 'up', status: 'watch' },
  ]
  const { error: benchErr } = await supabase.from('benchmarks').insert(benchmarkRows)
  if (benchErr) console.error('[SEED] benchmarks insert error (non-fatal):', benchErr.message)
  else console.log(`[SEED] ${benchmarkRows.length} benchmarks rows inserted`)

  // ── lead_funnel — 4 weeks ─────────────────────────────────────────────────
  const funnelRows = [0, 1, 2, 3].map((w) => ({
    org_id: orgId, project_id: projectId,
    week_start: isoDaysAgo(w * 7 + 3),
    total_leads: 20 - w * 2, contacted: 16 - w * 2, sv_done: 8 - w, booked: 2,
  }))
  const { error: funnelErr } = await supabase.from('lead_funnel').insert(funnelRows)
  if (funnelErr) console.error('[SEED] lead_funnel insert error (non-fatal):', funnelErr.message)
  else console.log(`[SEED] ${funnelRows.length} lead_funnel rows inserted`)

  // ── creatives (3, one per angle, tied to the project) ────────────────────
  const creativeRows = [
    { variant: 'A', angle: 'value', headline: 'Own a 3BHK in Patia from ₹45L', cta: 'Book a Site Visit', status: 'active' },
    { variant: 'B', angle: 'lifestyle', headline: 'Rooftop Pool Views Every Evening', cta: 'Schedule a Tour', status: 'active' },
    { variant: 'C', angle: 'amenity', headline: '24x7 Security, EV Charging, Clubhouse — All Included', cta: 'Get Brochure', status: 'draft' },
  ].map((c) => ({
    org_id: orgId, project_id: projectId,
    variant: c.variant, angle: c.angle, format: '1:1',
    headline: c.headline, cta: c.cta,
    primary_text: `${c.headline}. ${c.cta} today at Ananta Enclave, Patia.`,
    platform_used: 'meta', status: c.status,
    ctr: jitter(0.02), cpl: jitter(450),
  }))
  const { error: creativeErr } = await supabase.from('creatives').insert(creativeRows)
  if (creativeErr) console.error('[SEED] creatives insert error (non-fatal):', creativeErr.message)
  else console.log(`[SEED] ${creativeRows.length} creatives rows inserted`)

  // ── events_calendar — Odisha-relevant upcoming festivals ─────────────────
  const eventRows = [
    { name: 'Rath Yatra', date: isoDaysFromNow(18), type: 'festival' },
    { name: 'Nuakhai', date: isoDaysFromNow(45), type: 'festival' },
    { name: 'Diwali', date: isoDaysFromNow(90), type: 'festival' },
    { name: 'Site Visit Weekend', date: isoDaysFromNow(10), type: 'custom' },
  ].map((e) => ({ org_id: orgId, ...e, include_in_plan: true }))
  const { error: eventErr } = await supabase.from('events_calendar').insert(eventRows)
  if (eventErr) console.error('[SEED] events_calendar insert error (non-fatal):', eventErr.message)
  else console.log(`[SEED] ${eventRows.length} events_calendar rows inserted`)

  // ── smm_calendar — a mix of planned/posted so the calendar page isn't empty ──
  const smmRows = [-6, -3, -1, 2, 5, 9].map((dayOffset, i) => ({
    org_id: orgId,
    post_date: dayOffset < 0 ? isoDaysAgo(-dayOffset) : isoDaysFromNow(dayOffset),
    post_time: '10:00:00',
    platform: i % 2 === 0 ? 'instagram' : 'both',
    post_type: ['reel', 'carousel', 'static', 'story', 'static', 'reel'][i],
    category: 'project_branding',
    topic: `Ananta Enclave update #${i + 1}`,
    caption_en: `Excited to share progress at Ananta Enclave, Patia! ${i % 2 === 0 ? 'Rooftop pool structure complete 🏊' : 'Clubhouse interiors underway 🏗️'}`,
    hashtags: ['#AnantaEnclave', '#BhubaneswarRealEstate', '#PatiaHomes', '#DemoBuilder'],
    status: dayOffset < 0 ? 'posted' : 'planned',
  }))
  const { error: smmErr } = await supabase.from('smm_calendar').insert(smmRows)
  if (smmErr) console.error('[SEED] smm_calendar insert error (non-fatal):', smmErr.message)
  else console.log(`[SEED] ${smmRows.length} smm_calendar rows inserted`)

  // ── smm_metrics — 14 days so SMMAnalyzer history isn't empty ─────────────
  const smmMetricRows = [0, 7, 14].map((dayOffset) => ({
    org_id: orgId, platform: 'instagram', date: isoDaysAgo(dayOffset),
    followers: 4200 + dayOffset * 3, posts_published: 3,
    avg_reach: jitter(2100), avg_likes: jitter(180), avg_comments: jitter(12),
    avg_saves: jitter(24), avg_shares: jitter(8), engagement_rate: jitter(4.2),
    profile_visits: Math.round(jitter(310)), website_clicks: Math.round(jitter(45)),
    follower_growth: Math.round(jitter(9, 0.6)),
    data_source: 'manual',
  }))
  assertMetricSeedAllowed(orgId)
  const { error: smmMetricErr } = await supabase.from('smm_metrics').insert(smmMetricRows)
  if (smmMetricErr) console.error('[SEED] smm_metrics insert error (non-fatal):', smmMetricErr.message)
  else console.log(`[SEED] ${smmMetricRows.length} smm_metrics rows inserted`)

  // ── organic_plans — one populated row (F2 fix means this shape now matters) ──
  const organicPlanData = {
    pillars: [
      { pillar: 'Project Progress', freq: '2x/week', purpose: 'Build trust via construction transparency' },
      { pillar: 'Lifestyle & Amenities', freq: '2x/week', purpose: 'Sell the aspirational living experience' },
      { pillar: 'Community & Festivals', freq: '1x/week', purpose: 'Local relevance, Odisha festival tie-ins' },
    ],
    weekly: [
      { day: 'Monday', type: 'Carousel', topic: 'Construction milestone', captionEn: 'Another floor slab poured this week at Ananta Enclave! 🏗️', hashtags: ['#AnantaEnclave', '#UnderConstruction'], bestTime: '10:00 AM' },
      { day: 'Wednesday', type: 'Reel', topic: 'Clubhouse walkthrough', captionEn: 'Sneak peek: the rooftop pool deck is taking shape 🏊', hashtags: ['#AnantaEnclave', '#Clubhouse'], bestTime: '6:00 PM' },
      { day: 'Friday', type: 'Static', topic: 'USP spotlight — EV charging', captionEn: 'Future-ready living: every block wired for EV charging ⚡', hashtags: ['#AnantaEnclave', '#EVReady'], bestTime: '12:30 PM' },
    ],
    tips: ['Post progress photos consistently — it is the single highest-trust content type for under-construction projects.'],
  }
  const weekStart = isoDaysAgo(new Date().getDay() - 1 >= 0 ? new Date().getDay() - 1 : 0)
  const { error: organicErr } = await supabase.from('organic_plans').insert({
    org_id: orgId, week_start: weekStart, status: 'draft',
    plan_data: organicPlanData, pillars: organicPlanData.pillars,
  })
  if (organicErr) console.error('[SEED] organic_plans insert error (non-fatal):', organicErr.message)
  else console.log('[SEED] organic_plans row inserted')

  console.log(`\n[SEED] Done. org_id=${orgId} project_id=${projectId}`)
}

main().catch((err) => {
  console.error('[SEED] FATAL:', err instanceof Error ? err.message : err)
  Deno.exit(1)
})

import { assertMetricSeedAllowed } from './lib/seed-guard.ts'
/**
 * seed-cc-monitor-demo.ts — idempotent synthetic monitor data for ZZ-INTERNAL-TEST.
 *
 * Populates the internal test org with ~30 days of plausible-but-obviously-fake
 * data so the Performance Monitor, SMM Monitor, Content Library, and Dashboard
 * calendar all render in a POPULATED state for screenshots + manual testing.
 * All rows are clearly synthetic: campaign ids/names are `ZZ-…`-prefixed, and
 * the whole set is scoped to the ZZ-INTERNAL-TEST org (id below).
 *
 * Idempotent: deletes this org's prior synthetic rows (campaign_metrics whose
 * campaign_id starts `ZZ-`, and ALL of the org's smm_metrics / synthetic
 * smm_calendar rows — the org has no real social data) before re-inserting.
 * Safe to re-run.
 *
 * Two run modes:
 *   1. Direct (needs the service-role key — bypasses RLS):
 *        SUPABASE_URL=https://<proj>.supabase.co \
 *        SUPABASE_SERVICE_ROLE_KEY=<key> \
 *        deno run --allow-net --allow-env scripts/seed-cc-monitor-demo.ts
 *   2. Emit SQL (no key needed — apply via the linked CLI):
 *        SEED_EMIT_SQL=1 deno run --allow-env scripts/seed-cc-monitor-demo.ts > seed.sql
 *        supabase db query --linked -f seed.sql
 *
 * Cleanup (org is disposable):
 *   DELETE FROM campaign_metrics WHERE org_id='983c7c08-…' AND campaign_id LIKE 'ZZ-%';
 *   DELETE FROM smm_metrics      WHERE org_id='983c7c08-…';
 *   DELETE FROM smm_calendar     WHERE org_id='983c7c08-…' AND topic LIKE 'ZZ-%';
 */

const ZZ_ORG_ID = '983c7c08-ffaf-402b-981a-a9cd22615cae' // ZZ-INTERNAL-TEST (PROD)
const ORG_ID = Deno.env.get('SEED_ORG_ID') ?? ZZ_ORG_ID
// SEED_ORG_ID could previously point this anywhere, including the org a Meta
// reviewer logs into. Now it must be allowlisted or explicitly named.
assertMetricSeedAllowed(ORG_ID)
const EMIT_SQL = Deno.env.get('SEED_EMIT_SQL') === '1'
const DAYS = 30

const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p
const jitter = (base: number, pct = 0.2) => base * (1 + (Math.random() - 0.5) * 2 * pct)
const iso = (d: Date) => d.toISOString().split('T')[0]

// ---- campaign_metrics: 2 obviously-synthetic Meta campaigns, 30 days --------
const CAMPAIGNS = [
  { id: 'ZZ-DEMO-C1', name: 'ZZ-Skyline Residences — Launch', baseSpend: 1800, baseLeads: 11, ctr: 0.026, freq: 1.6 },
  { id: 'ZZ-DEMO-C2', name: 'ZZ-Skyline Residences — Retargeting', baseSpend: 1200, baseLeads: 9, ctr: 0.034, freq: 2.0 },
]

interface CampRow {
  org_id: string; campaign_id: string; campaign_name: string; date_start: string; date_stop: string
  spend: number; leads: number; cpl: number; ctr: number; frequency: number
  impressions: number; clicks: number; reach: number; platform: string; synced_at: string
}
interface SmmRow {
  org_id: string; platform: string; date: string; data_source: string
  followers: number; follower_growth: number; avg_reach: number; avg_likes: number
  avg_comments: number; avg_shares: number; avg_saves: number; engagement_rate: number
  posts_published: number; profile_visits: number; website_clicks: number
}
interface CalRow {
  org_id: string; topic: string; category: string; platform: string; post_type: string
  post_date: string; post_time: string; status: string; caption_en: string; hashtags: string[]
}

const campRows: CampRow[] = []
const smmRows: SmmRow[] = []
const now = new Date()

for (let off = DAYS - 1; off >= 0; off--) {
  const d = new Date(now); d.setDate(d.getDate() - off)
  const ds = iso(d)
  for (const c of CAMPAIGNS) {
    const spend = round(jitter(c.baseSpend))
    const leads = Math.max(1, Math.round(jitter(c.baseLeads)))
    const cpl = round(spend / leads)
    const impressions = Math.round(spend / 0.05)
    const clicks = Math.round(impressions * jitter(c.ctr, 0.1))
    campRows.push({
      org_id: ORG_ID, campaign_id: c.id, campaign_name: c.name,
      date_start: ds, date_stop: ds, spend, leads, cpl,
      ctr: round(jitter(c.ctr, 0.1), 6), frequency: round(jitter(c.freq, 0.1)),
      impressions, clicks, reach: Math.round(impressions * 0.72),
      platform: 'meta', synced_at: now.toISOString(),
    })
  }
  // one Instagram smm_metrics snapshot per day, followers trending up
  const followers = 4200 + (DAYS - 1 - off) * 8 + Math.round(jitter(6, 0.5))
  const reach = round(jitter(2900))
  smmRows.push({
    org_id: ORG_ID, platform: 'instagram', date: ds, data_source: 'manual',
    followers, follower_growth: Math.round(jitter(8, 0.5)), avg_reach: reach,
    avg_likes: round(jitter(180)), avg_comments: round(jitter(14)),
    avg_shares: round(jitter(9)), avg_saves: round(jitter(22)),
    engagement_rate: round(jitter(4.1, 0.15), 2), posts_published: (off % 2 === 0 ? 1 : 0),
    profile_visits: round(jitter(120)), website_clicks: round(jitter(35)),
  })
}

// ---- smm_calendar: a handful of upcoming scheduled posts (times SET) ---------
const CAL_SEEDS: { dayOffset: number; time: string; platform: string; type: string; topic: string; cat: string; status: string; caption: string }[] = [
  { dayOffset: 0, time: '09:00', platform: 'instagram', type: 'static', topic: 'ZZ-Amenities spotlight', cat: 'amenities', status: 'planned', caption: 'Rooftop infinity pool with skyline views 🌆' },
  { dayOffset: 0, time: '18:30', platform: 'facebook', type: 'carousel', topic: 'ZZ-Floor plan reveal', cat: 'product', status: 'planned', caption: '3 & 4 BHK layouts — swipe to explore.' },
  { dayOffset: 1, time: '11:00', platform: 'instagram', type: 'reel', topic: 'ZZ-Construction update', cat: 'progress', status: 'planned', caption: 'Structure topped out! Walkthrough inside.' },
  { dayOffset: 2, time: '17:00', platform: 'both', type: 'story', topic: 'ZZ-Weekend site visit', cat: 'event', status: 'planned', caption: 'Book your weekend site visit — limited slots.' },
  { dayOffset: 3, time: '10:30', platform: 'instagram', type: 'static', topic: 'ZZ-Location advantage', cat: 'lifestyle', status: 'planned', caption: '8 min to the business district.' },
  { dayOffset: 5, time: '19:00', platform: 'facebook', type: 'video', topic: 'ZZ-Customer testimonial', cat: 'trust', status: 'planned', caption: 'Hear why families chose Skyline.' },
  { dayOffset: -2, time: '12:00', platform: 'instagram', type: 'static', topic: 'ZZ-Festive greeting', cat: 'brand', status: 'posted', caption: 'Wishing you a bright festive season ✨' },
]
const calRows: CalRow[] = CAL_SEEDS.map((s) => {
  const d = new Date(now); d.setDate(d.getDate() + s.dayOffset)
  return {
    org_id: ORG_ID, topic: s.topic, category: s.cat, platform: s.platform, post_type: s.type,
    post_date: iso(d), post_time: s.time, status: s.status, caption_en: s.caption,
    hashtags: ['#ZZDemo', '#Skyline', '#RealEstate'],
  }
})

// ---- output ----------------------------------------------------------------

function sqlStr(s: string): string { return `'${s.replaceAll("'", "''")}'` }
function sqlArr(a: string[]): string { return `ARRAY[${a.map(sqlStr).join(',')}]::text[]` }

function emitSql(): string {
  const L: string[] = []
  L.push('BEGIN;')
  L.push(`DELETE FROM campaign_metrics WHERE org_id=${sqlStr(ORG_ID)} AND campaign_id LIKE 'ZZ-%';`)
  L.push(`DELETE FROM smm_metrics WHERE org_id=${sqlStr(ORG_ID)};`)
  L.push(`DELETE FROM smm_calendar WHERE org_id=${sqlStr(ORG_ID)} AND topic LIKE 'ZZ-%';`)
  for (const r of campRows) {
    L.push(
      `INSERT INTO campaign_metrics (org_id,campaign_id,campaign_name,date_start,date_stop,spend,leads,cpl,ctr,frequency,impressions,clicks,reach,platform,synced_at) VALUES (` +
      `${sqlStr(r.org_id)},${sqlStr(r.campaign_id)},${sqlStr(r.campaign_name)},${sqlStr(r.date_start)},${sqlStr(r.date_stop)},${r.spend},${r.leads},${r.cpl},${r.ctr},${r.frequency},${r.impressions},${r.clicks},${r.reach},${sqlStr(r.platform)},${sqlStr(r.synced_at)});`,
    )
  }
  for (const r of smmRows) {
    L.push(
      `INSERT INTO smm_metrics (org_id,platform,date,data_source,followers,follower_growth,avg_reach,avg_likes,avg_comments,avg_shares,avg_saves,engagement_rate,posts_published,profile_visits,website_clicks) VALUES (` +
      `${sqlStr(r.org_id)},${sqlStr(r.platform)},${sqlStr(r.date)},${sqlStr(r.data_source)},${r.followers},${r.follower_growth},${r.avg_reach},${r.avg_likes},${r.avg_comments},${r.avg_shares},${r.avg_saves},${r.engagement_rate},${r.posts_published},${r.profile_visits},${r.website_clicks});`,
    )
  }
  for (const r of calRows) {
    L.push(
      `INSERT INTO smm_calendar (org_id,topic,category,platform,post_type,post_date,post_time,status,caption_en,hashtags) VALUES (` +
      `${sqlStr(r.org_id)},${sqlStr(r.topic)},${sqlStr(r.category)},${sqlStr(r.platform)},${sqlStr(r.post_type)},${sqlStr(r.post_date)},${sqlStr(r.post_time)},${sqlStr(r.status)},${sqlStr(r.caption_en)},${sqlArr(r.hashtags)});`,
    )
  }
  L.push('COMMIT;')
  return L.join('\n')
}

async function applyViaClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or use SEED_EMIT_SQL=1).')
    Deno.exit(1)
  }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
  const sb = createClient(url, key)
  await sb.from('campaign_metrics').delete().eq('org_id', ORG_ID).like('campaign_id', 'ZZ-%')
  await sb.from('smm_metrics').delete().eq('org_id', ORG_ID)
  await sb.from('smm_calendar').delete().eq('org_id', ORG_ID).like('topic', 'ZZ-%')
  const c = await sb.from('campaign_metrics').insert(campRows)
  if (c.error) { console.error('campaign_metrics:', c.error.message); Deno.exit(1) }
  const s = await sb.from('smm_metrics').insert(smmRows)
  if (s.error) { console.error('smm_metrics:', s.error.message); Deno.exit(1) }
  const k = await sb.from('smm_calendar').insert(calRows)
  if (k.error) { console.error('smm_calendar:', k.error.message); Deno.exit(1) }
  console.error(`✓ Seeded ${campRows.length} campaign_metrics, ${smmRows.length} smm_metrics, ${calRows.length} smm_calendar rows for org ${ORG_ID}.`)
}

if (EMIT_SQL) {
  console.log(emitSql())
} else {
  await applyViaClient()
}

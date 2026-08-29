/**
 * crm-map-ingest
 *
 * RB-M1 STEP 2 — the receiver half of the CRM bridge. The CRM knows which ad
 * belongs to which project; this app does not. That gap is why
 * campaign_metrics.project_id is empty on every row for any org running all
 * its projects from one ad account, and why the Monitor's project filter has
 * nothing to filter on.
 *
 * Contract (locked, and deliberately sender-agnostic — the CRM side is not
 * written yet and must not need to know anything about this app's ids):
 *   header  x-awaas-bridge-secret: <shared secret>
 *   body    [{ ad_id, campaign_id?, project_external_ref }]
 *   returns { upserted, unmatched }
 *
 * There is no org_id anywhere in that payload, and that is the point. The org
 * is DERIVED from the project the external_ref resolves to. A body-supplied
 * org_id on a shared-secret endpoint would mean one leaked secret rewrites
 * every tenant's mapping.
 *
 * 503 vs 401 — the distinction this function exists to preserve:
 *   secret NOT SET   -> 503 "unconfigured". A deployment gap, not a caller
 *                       problem. Answering 401 here would tell the sender its
 *                       credential is bad, and a credential-rejected alarm on
 *                       an unconfigured server pages the wrong person, at
 *                       volume, for something no sender can fix.
 *   secret set, header wrong/absent -> 401. A real authentication failure.
 *
 * Unmatched refs are RETURNED, never dropped. A bridge that silently discards
 * what it cannot resolve looks identical to one that is working, which is the
 * precise failure this contract is shaped to prevent.
 */

import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'

/** A batch, not a firehose. Bounded so one malformed sender cannot hand the
 *  isolate an unbounded array to parse and upsert in a single statement. */
const MAX_BATCH = 1000

const corsHeaders = () => ({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-awaas-bridge-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders() })

/**
 * Constant-time secret comparison.
 *
 * Digest both sides first so the compare is over two fixed 32-byte arrays —
 * that handles unequal lengths without the early return (or the length check)
 * that leaks how much of the secret was guessed right.
 */
async function secretMatches(presented: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

interface BridgeItem {
  ad_id?: unknown
  campaign_id?: unknown
  project_external_ref?: unknown
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null

Deno.serve(async (req: Request) => {
  // Answer the preflight and STOP. meta-sync-now's header comment records what
  // the alternative costs: the cron sync function has no method check, so an
  // OPTIONS request there ran a full all-org sweep.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)

  const expected = Deno.env.get('CC_BRIDGE_SECRET') ?? ''
  if (!expected) {
    return json({
      error: 'unconfigured',
      detail: 'CC_BRIDGE_SECRET is not set on this deployment. This is a server configuration gap, not an authentication failure — do not treat it as a rejected credential.',
    }, 503)
  }

  const presented = req.headers.get('x-awaas-bridge-secret') ?? ''
  if (!await secretMatches(presented, expected)) return json({ error: 'Unauthorized' }, 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  if (!Array.isArray(body)) {
    return json({ error: 'Body must be an array of { ad_id, campaign_id?, project_external_ref }' }, 400)
  }
  if (body.length > MAX_BATCH) {
    return json({ error: `Batch too large: ${body.length} items, max ${MAX_BATCH}` }, 413)
  }
  if (body.length === 0) return json({ upserted: 0, unmatched: [] })

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const items = body as BridgeItem[]
  const refs = [...new Set(items.map((i) => str(i.project_external_ref)).filter((r): r is string => !!r))]

  const { data: projects, error: projErr } = await supabase
    .from('projects')
    .select('id, org_id, external_ref')
    .in('external_ref', refs)
  if (projErr) return json({ error: `project lookup: ${projErr.message}` }, 500)

  // external_ref is unique PER ORG (projects_org_external_ref_idx), not
  // globally, and this endpoint has no org to scope by — the secret is one
  // shared credential, not a tenant identity. So a ref that resolves to two
  // orgs' projects is genuinely ambiguous. Report it as unmatched rather than
  // picking one: guessing here writes a mapping into the wrong tenant.
  const byRef = new Map<string, { id: string; org_id: string } | 'ambiguous'>()
  for (const p of (projects ?? []) as { id: string; org_id: string | null; external_ref: string | null }[]) {
    if (!p.external_ref || !p.org_id) continue
    byRef.set(p.external_ref, byRef.has(p.external_ref) ? 'ambiguous' : { id: p.id, org_id: p.org_id })
  }

  const now = new Date().toISOString()
  // Keyed by (org_id, ad_id) — the same key meta_campaign_map_org_ad_idx
  // enforces. Deduped BEFORE the upsert because Postgres refuses to let one
  // INSERT ... ON CONFLICT statement touch the same row twice ("cannot affect
  // row a second time"); within one batch, last item wins.
  const rows = new Map<string, Database['public']['Tables']['meta_campaign_map']['Insert']>()
  const unmatched = new Set<string>()

  for (const item of items) {
    const adId = str(item.ad_id)
    const ref = str(item.project_external_ref)
    if (!adId || !ref) continue // malformed item: no ad to key on, or no ref to resolve

    const hit = byRef.get(ref)
    if (!hit || hit === 'ambiguous') {
      unmatched.add(ref)
      continue
    }

    rows.set(`${hit.org_id} ${adId}`, {
      org_id: hit.org_id,
      project_id: hit.id,
      // NOT NULL in the schema, and campaign_id is optional in the contract.
      // '' means "the sender did not say" — it cannot collide with a real Meta
      // campaign id, and the ad-level mapping is the one that wins anyway.
      meta_campaign_id: str(item.campaign_id) ?? '',
      meta_ad_id: adId,
      source: 'crm_bridge',
      updated_at: now,
    })
  }

  if (rows.size === 0) return json({ upserted: 0, unmatched: [...unmatched] })

  const { error: upErr, count } = await supabase
    .from('meta_campaign_map')
    .upsert([...rows.values()], { onConflict: 'org_id,meta_ad_id', count: 'exact' })
  // Bug #47/#48: a wrong column name does not throw — PostgREST returns it in
  // `error` and the write is silently lost. Checking it is the only way this
  // ever surfaces.
  if (upErr) return json({ error: `upsert: ${upErr.message}`, unmatched: [...unmatched] }, 500)

  return json({ upserted: count ?? rows.size, unmatched: [...unmatched] })
})

/**
 * ingest-review
 *
 * RB-P2 / P2.13 PART D — folds captured human reviews into the training set.
 *
 * review_events is INSERT-only from the client and has NO SELECT policy, so
 * this function (service role, bypasses RLS) is the only reader. It exists
 * because a review is worth nothing sitting in its own table: the point is
 * that Aanya's training rows carry the human verdict alongside the image.
 *
 * Routing:
 *   subject_type 'creative' → stamp metadata onto the matching
 *     aanya_training_creatives row (matched via creative_assets.storage_path,
 *     the same key distillCampaign dedupes on).
 *   subject_type 'strategy' → merge into the tool_outputs row's payload.review.
 *
 * org_id is NEVER taken from the request body — derived from auth.getUser()
 * plus a profiles lookup, then used to re-filter every service-role query, the
 * same rule aarav-orchestrate follows for its approve path.
 *
 * There is no review-management UI and this function exposes no read API. It
 * returns counts only.
 */

import '../_shared/review-build-guard.ts' // review-build ONLY — DO NOT MERGE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database, Json } from '../_shared/database.types.ts'

const corsHeaders = () => ({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
})

interface ReviewRow {
  id: string
  org_id: string
  subject_type: 'strategy' | 'creative'
  subject_id: string | null
  strategy_type: string | null
  platform: 'meta' | 'google' | null
  ratings: Record<string, number> | null
  improvement_text: string | null
  edit_summary: string | null
  editor_ops: unknown
  created_at: string
}

/**
 * Compact the raw op log into counts: {update: 4, nudge: 11, delete: 1}.
 *
 * The ordering of individual nudges is noise; what carries signal is WHICH
 * kinds of correction a professional had to make and how much. Stored as a
 * digest so the training row stays readable and bounded.
 */
function digestOps(ops: unknown): Record<string, number> | null {
  if (!Array.isArray(ops) || ops.length === 0) return null
  const out: Record<string, number> = {}
  for (const op of ops) {
    if (typeof op !== 'string') continue
    out[op] = (out[op] ?? 0) + 1
  }
  return Object.keys(out).length ? out : null
}

/**
 * Layout tags for the training row: the reference's per-panel content_hints
 * plus whatever design DNA the parent creative recorded.
 *
 * The hints live on `creatives.senior_designer_brief.panel_assignment.panels`
 * (V5 chose that jsonb over a new column), NOT on creative_assets — an earlier
 * draft of this function selected `reference_analysis`/`design_dna_tags`
 * straight off creative_assets, where neither column exists. PostgREST answers
 * a bad column with `{error}` and a null `data`, so that version would have
 * silently skipped every creative review rather than failing loudly. Exactly
 * the bug #47/#48 shape, on a select instead of an insert.
 */
function layoutTagsFrom(brief: Record<string, unknown> | null, designDna: unknown): Json | null {
  const assignment = (brief?.panel_assignment ?? null) as { panels?: { index?: number; contentHint?: string }[] } | null
  const hints = (assignment?.panels ?? [])
    .filter((p) => typeof p?.contentHint === 'string' && p.contentHint !== 'other')
    .map((p) => ({ section: p.index ?? null, depicts: p.contentHint }))

  if (!hints.length && !designDna) return null
  return {
    ...(hints.length ? { panel_content: hints } : {}),
    ...(designDna ? { design_dna: designDna } : {}),
  } as Json
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: corsHeaders() })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: corsHeaders() })
  }

  // Identify the caller with THEIR token, never the service key.
  const authClient = createClient<Database>(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await authClient.auth.getUser()
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders() })
  }

  const admin = createClient<Database>(supabaseUrl, serviceKey)

  // Server-resolved org. A body-supplied org_id would let any authenticated
  // user aggregate another tenant's reviews into their own training set.
  const { data: profile } = await admin
    .from('profiles')
    .select('org_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  const orgId = (profile as { org_id?: string } | null)?.org_id
  if (!orgId) {
    return new Response(JSON.stringify({ error: 'No org for user' }), { status: 403, headers: corsHeaders() })
  }

  let body: { subject_type?: 'strategy' | 'creative'; subject_id?: string | null } = {}
  try { body = await req.json() } catch { /* body is optional */ }

  let query = admin
    .from('review_events')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(200)
  if (body.subject_id) query = query.eq('subject_id', body.subject_id)
  // Narrow explicitly — an arbitrary string from the body must not reach the
  // filter, and the column only has two legal values.
  if (body.subject_type === 'strategy' || body.subject_type === 'creative') {
    query = query.eq('subject_type', body.subject_type)
  }

  const { data: reviews, error: reviewErr } = await query
  if (reviewErr) {
    return new Response(JSON.stringify({ error: `read reviews: ${reviewErr.message}` }), { status: 500, headers: corsHeaders() })
  }

  const rows = (reviews ?? []) as unknown as ReviewRow[]
  let creativesStamped = 0
  let strategiesStamped = 0
  const failures: string[] = []

  for (const r of rows) {
    if (!r.subject_id) continue

    try {
      if (r.subject_type === 'creative') {
        // creative_assets.id → storage_path → the training row distilled from it.
        // Only real columns are selected here (see layoutTagsFrom's note), and
        // the error is checked rather than assumed away.
        const { data: asset, error: assetErr } = await admin
          .from('creative_assets')
          .select('storage_path, creative_id')
          .eq('id', r.subject_id)
          .eq('org_id', orgId)
          .maybeSingle()
        if (assetErr) { failures.push(`asset ${r.id}: ${assetErr.message}`); continue }
        const storagePath = (asset as { storage_path?: string } | null)?.storage_path
        if (!storagePath) continue

        // Design context lives on the PARENT creatives row, not the asset.
        const creativeId = (asset as { creative_id?: string | null } | null)?.creative_id
        let brief: Record<string, unknown> | null = null
        let designDna: unknown = null
        if (creativeId) {
          const { data: parent } = await admin
            .from('creatives')
            .select('senior_designer_brief, design_dna_tags')
            .eq('id', creativeId)
            .eq('org_id', orgId)
            .maybeSingle()
          brief = ((parent as { senior_designer_brief?: Record<string, unknown> } | null)?.senior_designer_brief) ?? null
          designDna = (parent as { design_dna_tags?: unknown } | null)?.design_dna_tags ?? null
        }

        const patch = {
          designer_rating: r.ratings?.strategy_fit ?? null,
          text_quality: r.ratings?.text_quality ?? null,
          edit_summary: r.edit_summary,
          editor_ops_digest: digestOps(r.editor_ops) as Json | null,
          strategy_type: r.strategy_type,
          ad_platform: r.platform,
          layout_tags: layoutTagsFrom(brief, designDna),
        }

        // UPDATE, not upsert: a training row exists only once the campaign has
        // been distilled (distillCampaign). Inserting one here would create a
        // training example with no image_url/storage_path lifecycle behind it.
        const { error: updErr, count } = await admin
          .from('aanya_training_creatives')
          .update(patch, { count: 'exact' })
          .eq('org_id', orgId)
          .eq('storage_path', storagePath)
        // Bug #47/#48: a wrong column name does NOT throw here — PostgREST
        // returns it in `error`. Checking it is the only way this surfaces.
        if (updErr) { failures.push(`creative ${r.id}: ${updErr.message}`); continue }
        if ((count ?? 0) > 0) creativesStamped++
      } else {
        const { data: output } = await admin
          .from('tool_outputs')
          .select('payload')
          .eq('id', r.subject_id)
          .eq('org_id', orgId)
          .maybeSingle()
        if (!output) continue

        const payload = ((output as { payload?: Record<string, unknown> }).payload ?? {}) as Record<string, unknown>
        const { error: updErr } = await admin
          .from('tool_outputs')
          .update({
            payload: {
              ...payload,
              review: {
                ratings: r.ratings ?? {},
                improvement_text: r.improvement_text,
                strategy_type: r.strategy_type,
                platform: r.platform,
                reviewed_at: r.created_at,
              },
            },
          })
          .eq('id', r.subject_id)
          .eq('org_id', orgId)
        if (updErr) { failures.push(`strategy ${r.id}: ${updErr.message}`); continue }
        strategiesStamped++
      }
    } catch (err) {
      failures.push(`${r.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return new Response(
    JSON.stringify({
      reviews_read: rows.length,
      creatives_stamped: creativesStamped,
      strategies_stamped: strategiesStamped,
      failures,
    }),
    { status: 200, headers: corsHeaders() },
  )
})

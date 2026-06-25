/**
 * aarav-orchestrate
 *
 * Single orchestration entry point for LeadGen V2. The client UI talks ONLY
 * to this function — it never calls a specialist (arjun/aanya/diya) Edge
 * Function directly. Aarav fans work out to specialists server-side.
 *
 * Security: org_id is NEVER trusted from the request body. The user is
 * derived from the Authorization JWT (auth.getUser()), then org_id is
 * resolved server-side via the same profiles lookup get_current_user_org_id()
 * performs. The orgId passed into specialists below is always this
 * server-resolved value.
 *
 * Input:  AgentRequest  (see contracts.ts in src — keep in sync)
 * Output: AaravResponse | ApproveResponse depending on action
 *
 * Phase 5 additions:
 *   - Every send_message/regenerate turn creates an agent_turns row and
 *     UPDATEs delegations after each specialist so Realtime subscribers see
 *     live chip animation (Arjun → Aanya → Diya) without polling.
 *   - action='approve': idempotent; writes to agent_memory + agent_messages,
 *     marks turn ready_to_launch. No real Meta launch integration exists yet
 *     — status is 'ready_to_launch', surfaced honestly in the UI.
 *   - action='request_change': treated as a normal send_message turn so the
 *     conversation thread accumulates rather than replacing.
 *
 * Turn timing (worst case): ~14 LLM calls + 3 image gens ≈ 120s. The
 * Supabase default limit is 600s, so a synchronous chain that UPDATEs the
 * turn row as it goes is correct — waitUntil / background offloading is not
 * needed here. This decision is documented in CLAUDE.md.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database, Json } from '../_shared/database.types.ts'

type DB = SupabaseClient<Database>
import { runArjun, ArjunOutputError, type StrategyConfig } from '../_shared/agents/arjun.ts'
import { runAanya, AanyaOutputError, type CreativeVariant, type CreativeAngle } from '../_shared/agents/aanya.ts'
import { runKavya, KavyaOutputError, type KavyaIntent, type KavyaPlan, type KavyaPlanEntry } from '../_shared/agents/kavya.ts'
import { langfuseTrace, langfuseGeneration, langfuseSpan } from '../_shared/langfuse.ts'
import { getTierConfig } from '../_shared/tier-config.ts'

// ─── Request/response types (mirror contracts.ts) ────────────────────────────

interface AgentRequest {
  action?: 'send_message' | 'approve' | 'request_change'
  message?: string
  project_id?: string
  session_id?: string
  edited_strategy?: StrategyConfig
  regenerate_creatives?: {
    strategy: StrategyConfig
    angle?: CreativeAngle
    keep?: CreativeVariant[]
  }
  // For action='approve':
  turn_id?: string
  selected_creative_ids?: string[]
}

type DelegationState = 'pending' | 'working' | 'done' | 'failed'
interface DelegationStatus {
  agent: 'arjun' | 'aanya' | 'kavya'
  label: string
  status: DelegationState
}

// DB-format delegations stored in agent_turns.delegations jsonb column.
// Fields are optional so single-agent turns don't carry misleading pending keys.
type DelegationMap = {
  arjun?: DelegationState
  aanya?: DelegationState
  kavya?: DelegationState
}

// Claude Sonnet pricing used for cost rows — mirrors Reports.tsx calculation.
function claudeCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000
}

// Convert the DelegationStatus[] array (used in responses) to the compact
// map stored in agent_turns.delegations so Realtime payloads are small.
// Only includes keys that are present in the delegation array so Kavya-only
// turns don't emit misleading arjun/aanya 'pending' entries.
function toDelegationMap(delegations: DelegationStatus[]): DelegationMap {
  const map: DelegationMap = {}
  for (const d of delegations) {
    map[d.agent] = d.status
  }
  return map
}

// ─── Orchestration context threaded through helpers ───────────────────────────

interface OrchestrationCtx {
  traceId: string
  orgId: string
  userId: string
  projectId: string | undefined
  sessionId: string
  turnId: string
  adminClient: DB
  delegations: DelegationStatus[]
}

// ─── agent_turns helpers ──────────────────────────────────────────────────────

async function createTurnRow(ctx: OrchestrationCtx): Promise<void> {
  await ctx.adminClient.from('agent_turns').insert({
    id: ctx.turnId,
    org_id: ctx.orgId,
    project_id: ctx.projectId ?? null,
    session_id: ctx.sessionId,
    status: 'working',
    delegations: toDelegationMap(ctx.delegations) as unknown as Json,
  })
}

// UPDATE delegations column only — called mid-turn so Realtime fires on
// each specialist transition without waiting for the final canvas.
async function updateTurnDelegations(ctx: OrchestrationCtx): Promise<void> {
  await ctx.adminClient.from('agent_turns').update({
    delegations: toDelegationMap(ctx.delegations) as unknown as Json,
  }).eq('id', ctx.turnId)
}

// Final update once the full chain completes.
async function finaliseTurn(
  ctx: OrchestrationCtx,
  canvas: Record<string, unknown>,
  message: string,
  capHit = false,
): Promise<void> {
  await ctx.adminClient.from('agent_turns').update({
    status: 'awaiting_user',
    delegations: toDelegationMap(ctx.delegations) as unknown as Json,
    canvas: canvas as unknown as Json,
    message,
    awaiting_user: true,
    cap_hit: capHit,
  }).eq('id', ctx.turnId)
}

async function failTurn(ctx: OrchestrationCtx): Promise<void> {
  await ctx.adminClient.from('agent_turns').update({
    status: 'failed',
    delegations: toDelegationMap(ctx.delegations) as unknown as Json,
  }).eq('id', ctx.turnId)
}

// Write both sides of the conversation to agent_messages. userMessage is
// omitted for button-driven turns (regenerate) that carry no user prose.
async function persistMessages(
  ctx: OrchestrationCtx,
  aaravMessage: string,
  canvas: Record<string, unknown>,
  userMessage?: string,
): Promise<void> {
  type MsgInsert = Database['public']['Tables']['agent_messages']['Insert']
  const rows: MsgInsert[] = []
  if (userMessage) {
    rows.push({
      org_id: ctx.orgId,
      project_id: ctx.projectId ?? null,
      session_id: ctx.sessionId,
      turn_id: ctx.turnId,
      role: 'user' as const,
      content: userMessage,
    })
  }
  rows.push({
    org_id: ctx.orgId,
    project_id: ctx.projectId ?? null,
    session_id: ctx.sessionId,
    turn_id: ctx.turnId,
    role: 'aarav' as const,
    content: aaravMessage,
    canvas_snapshot: canvas as unknown as Json,
  })
  await ctx.adminClient.from('agent_messages').insert(rows)
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401, headers: corsHeaders(),
    })
  }

  // Client scoped to the caller's JWT — used ONLY to resolve identity/org_id.
  // Never trust an org_id from the request body.
  const userClient = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
      status: 401, headers: corsHeaders(),
    })
  }
  const userId = userData.user.id

  const { data: profile, error: profileErr } = await userClient
    .from('profiles').select('org_id, tier').eq('id', userId).single()
  if (profileErr || !profile?.org_id) {
    return new Response(JSON.stringify({ error: 'No organization found for this user' }), {
      status: 403, headers: corsHeaders(),
    })
  }
  const orgId = profile.org_id as string
  const tier  = (profile as { tier?: string }).tier ?? 'profile_2'
  const tierCfg = getTierConfig(tier)

  let body: AgentRequest
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: corsHeaders(),
    })
  }

  // Service-role client for all writes (cost ledger, turns, memory).
  // org_id flowing into inserts is always the server-resolved value above.
  const adminClient = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const action = body.action ?? 'send_message'

  // ── Approve action ────────────────────────────────────────────────────────
  if (action === 'approve') {
    return await handleApprove(body, { orgId, userId, adminClient })
  }

  // ── Normal turn (send_message / request_change / regenerate) ──────────────

  const traceId  = `aarav-${crypto.randomUUID()}`
  const turnId   = crypto.randomUUID()
  const sessionId = body.session_id ?? `session-${traceId}`
  const message  = body.message?.trim() ?? ''

  await langfuseTrace(traceId, {
    name: 'aarav-orchestrate',
    userId,
    sessionId,
    tags: ['leadgen-v2', 'aarav'],
    metadata: { org_id: orgId, project_id: body.project_id, action },
    input: { message },
  })

  // Aarav's own (stub) row — pure orchestration, no model call at this layer.
  await adminClient.from('agent_interactions').insert({
    org_id: orgId, user_id: userId, agent: 'aarav',
    trace_id: traceId, model: 'stub-aarav-v0',
    input_tokens: 0, output_tokens: 0, cost_usd: 0,
  })

  const delegations: DelegationStatus[] = [
    { agent: 'arjun', label: 'Designing campaign strategy', status: 'pending' },
    { agent: 'aanya', label: 'Generating creatives',        status: 'pending' },
  ]

  const ctx: OrchestrationCtx = {
    traceId, orgId, userId,
    projectId: body.project_id,
    sessionId, turnId, adminClient, delegations,
  }

  // Create the agent_turns row immediately so the Realtime subscriber can
  // attach to it before any specialist starts work.
  await createTurnRow(ctx)

  // Top-level catch: any unhandled exception (e.g. unexpected runtime error,
  // Supabase connectivity blip mid-turn) must still leave the turn in a
  // terminal state so the client doesn't spin on 'working' forever.
  // Known failure paths (Arjun/Aanya throws) are handled inside the chain
  // below; this wrapper catches everything else.
  try {
  // Regenerate flow: skip Arjun, re-delegate only to Aanya.
  if (body.regenerate_creatives) {
    return await handleRegenerateCreatives(body.regenerate_creatives, ctx, tierCfg.aanyaCostCeilingUsd, tier)
  }

  // ── Kavya (content / SMM) turn — detected before campaign flow ───────────
  const kavyaIntent = detectKavyaIntent(message)
  if (kavyaIntent) {
    return await handleKavyaTurn(message, kavyaIntent, ctx)
  }

  // ── Standard campaign turn (Arjun → Aanya) ───────────────────────────────

  delegations[0].status = 'working'
  await updateTurnDelegations(ctx) // First Realtime push: Arjun working

  const objective = body.edited_strategy
    ? `Revise the previous strategy with these edits: ${JSON.stringify(body.edited_strategy)}. User note: ${message || '(no additional note)'}`
    : message || 'Plan a new lead-gen campaign for this project.'

  try {
    const result = await runArjun({
      orgId, projectId: body.project_id, objective,
      budget: 'Not specified — use a reasonable default and state the assumption in notes.',
    })

    delegations[0].status = 'done'
    delegations[1].status = 'working'
    await updateTurnDelegations(ctx) // Realtime push: Arjun done, Aanya working

    await langfuseGeneration(traceId, {
      name: 'arjun-strategy',
      input: { objective }, output: result.strategy,
      model: result.model,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    })
    await adminClient.from('agent_interactions').insert({
      org_id: orgId, user_id: userId, agent: 'arjun', trace_id: traceId,
      model: result.model,
      input_tokens: result.inputTokens, output_tokens: result.outputTokens,
      cost_usd: claudeCostUsd(result.inputTokens, result.outputTokens),
    })

    let creatives: CreativeVariant[] | undefined
    let turnCapHit = false

    try {
      const aanyaResult = await runAanya({
        orgId, projectId: body.project_id, strategy: result.strategy, traceId,
        costCeilingUsd: tierCfg.aanyaCostCeilingUsd,
      })
      delegations[1].status = 'done'
      await updateTurnDelegations(ctx) // Realtime push: Aanya done

      await langfuseGeneration(traceId, {
        name: 'aanya-creative-loop',
        input: { strategy: result.strategy },
        output: { variants: aanyaResult.variants.map(v => ({ angle: v.angle, image_url: v.image_url })), capHit: aanyaResult.capHit },
        model: aanyaResult.model,
        inputTokens: aanyaResult.inputTokens, outputTokens: aanyaResult.outputTokens,
      })
      if (aanyaResult.capHit) {
        await langfuseSpan(traceId, {
          name: 'budget-cap-hit',
          output: { tier, ceilingUsd: tierCfg.aanyaCostCeilingUsd, variantsProduced: aanyaResult.variants.length },
        })
      }
      await adminClient.from('agent_interactions').insert({
        org_id: orgId, user_id: userId, agent: 'aanya', trace_id: traceId,
        model: aanyaResult.model,
        input_tokens: aanyaResult.inputTokens, output_tokens: aanyaResult.outputTokens,
        cost_usd: aanyaResult.totalCostUsd,
      })

      creatives = aanyaResult.variants
      if (aanyaResult.capHit) turnCapHit = true
    } catch (aanyaErr) {
      delegations[1].status = 'failed'
      await updateTurnDelegations(ctx)
      const usage = aanyaErr instanceof AanyaOutputError ? aanyaErr.usage : undefined
      await langfuseGeneration(traceId, {
        name: 'aanya-creative-loop', input: { strategy: result.strategy },
        level: 'ERROR', statusMessage: aanyaErr instanceof Error ? aanyaErr.message : 'Unknown error',
        model: 'claude-sonnet-4-6', inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
      })
      console.error('runAanya failed:', aanyaErr instanceof Error ? aanyaErr.message : aanyaErr)
      if (usage) {
        await adminClient.from('agent_interactions').insert({
          org_id: orgId, user_id: userId, agent: 'aanya', trace_id: traceId,
          model: 'claude-sonnet-4-6',
          input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
          cost_usd: claudeCostUsd(usage.inputTokens, usage.outputTokens),
        })
      }
    }

    const capNote = turnCapHit
      ? " I hit your plan's generation limit partway through — here's what I put together. You can regenerate any tile to use remaining budget." : ''
    const baseMessage = body.edited_strategy
      ? 'Updated the strategy with your edits — take a look and approve when ready.'
      : "Here's a targeting and budget strategy to start with. Review it on the right — you can edit any field and resend it to me."
    const aaravText = creatives
      ? `${baseMessage} I've also put together three creatives to go with it.${capNote}`
      : `${baseMessage} I hit a snag generating creatives though — you can retry from the Regenerate button.`

    const canvas = { strategy: result.strategy, creatives }
    await finaliseTurn(ctx, canvas as Record<string, unknown>, aaravText, turnCapHit)
    await persistMessages(ctx, aaravText, canvas as Record<string, unknown>, message || undefined)

    return new Response(JSON.stringify(buildResponse(turnId, orgId, 'ready', aaravText, delegations, canvas, true)), {
      headers: corsHeaders(),
    })
  } catch (err) {
    delegations[0].status = 'failed'
    await failTurn(ctx)

    const usage = err instanceof ArjunOutputError ? err.usage : undefined
    await langfuseGeneration(traceId, {
      name: 'arjun-strategy', input: { objective },
      level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error',
      model: 'claude-sonnet-4-6', inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    })
    console.error('runArjun failed:', err instanceof Error ? err.message : err)
    if (usage) {
      await adminClient.from('agent_interactions').insert({
        org_id: orgId, user_id: userId, agent: 'arjun', trace_id: traceId,
        model: 'claude-sonnet-4-6',
        input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
        cost_usd: claudeCostUsd(usage.inputTokens, usage.outputTokens),
      })
    }

    const fallbackText = "I hit a snag putting together your targeting strategy. Want to try again, or tweak your brief and resend it?"
    const canvas = {}
    await persistMessages(ctx, fallbackText, canvas as Record<string, unknown>, message || undefined)

    return new Response(JSON.stringify(buildResponse(turnId, orgId, 'ready', fallbackText, delegations, canvas, true)), {
      headers: corsHeaders(),
    })
  }
  } catch (unexpectedErr) {
    // Unhandled exception outside known failure paths — ensure the turn
    // reaches a terminal state so clients don't spin on 'working' forever.
    console.error('Unhandled orchestration error:', unexpectedErr instanceof Error ? unexpectedErr.message : unexpectedErr)
    await failTurn(ctx).catch(() => { /* ignore secondary failure */ })
    return new Response(JSON.stringify({ error: 'Internal orchestration error' }), {
      status: 500, headers: corsHeaders(),
    })
  }
})

// ─── Kavya intent detection ───────────────────────────────────────────────────
//
// Keyword-based routing — runs before the Arjun→Aanya campaign chain. Returns
// the KavyaIntent when the message is clearly SMM/content territory, or null
// when the message is better handled by the campaign chain.

function detectKavyaIntent(message: string): KavyaIntent | null {
  const m = message.toLowerCase()

  // Reel scripts — check before caption to avoid 'reel idea' matching caption
  if (/reel.*(script|idea|video)|video.*(script|idea)|script.*reel/.test(m)) return 'reel'

  // Monthly / weekly plans
  if (
    /content\s*calendar|monthly\s*plan|what\s*(should\s*)?i\s*post|plan\s*content|smm\s*plan|social\s*media\s*plan|content\s*strateg|content\s*arc|posting\s*schedule/.test(m)
  ) return 'plan'

  // Captions
  if (
    /\bcaption\b|write.*(post|instagram|facebook|linkedin)|instagram\s*post|facebook\s*post|linkedin\s*post/.test(m)
  ) return 'caption'

  return null
}

// ─── Kavya turn handler ───────────────────────────────────────────────────────

async function handleKavyaTurn(
  message: string,
  intent: KavyaIntent,
  ctx: OrchestrationCtx,
): Promise<Response> {
  const { traceId, orgId, userId, adminClient, turnId, projectId } = ctx

  // Replace the initial arjun/aanya delegation entries with a single Kavya
  // chip — ctx.delegations is passed by reference so finaliseTurn will see it.
  ctx.delegations.length = 0
  ctx.delegations.push({
    agent: 'kavya',
    label: intent === 'plan' ? 'Planning content calendar' : intent === 'caption' ? 'Writing caption' : 'Writing reel script',
    status: 'working',
  })
  // Write initial delegations so Realtime subscribers see Kavya working.
  await adminClient.from('agent_turns').update({
    delegations: toDelegationMap(ctx.delegations) as unknown as Json,
  }).eq('id', turnId)

  try {
    const result = await runKavya({ orgId, projectId, intent, message })
    ctx.delegations[0].status = 'done'

    await langfuseGeneration(traceId, {
      name: `kavya-${intent}`,
      input: { intent, message },
      output: result.output,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    })
    await adminClient.from('agent_interactions').insert({
      org_id: orgId, user_id: userId, agent: 'kavya', trace_id: traceId,
      model: result.model,
      input_tokens: result.inputTokens, output_tokens: result.outputTokens,
      cost_usd: claudeCostUsd(result.inputTokens, result.outputTokens),
    })

    // For plan intent: bulk-insert entries into smm_calendar so they appear
    // in the SMM Calendar page immediately after Kavya finishes.
    if (intent === 'plan') {
      const plan = result.output as KavyaPlan
      const rows = plan.plan.map((entry: KavyaPlanEntry) => ({
        org_id: orgId,
        post_date: entry.date,
        post_time: entry.posting_time ?? null,
        platform: entry.platform as 'instagram' | 'facebook' | 'both',
        post_type: entry.post_type as 'reel' | 'carousel' | 'static' | 'story' | 'video',
        category: entry.category ?? null,
        topic: entry.week_theme ?? null,
        caption_en: entry.caption ?? null,
        hashtags: entry.hashtags ?? null,
        nano_prompt: entry.creative_brief ?? null,
        status: 'planned' as const,
      }))
      // Ignore errors — a duplicate-date conflict must not fail the whole turn.
      await adminClient.from('smm_calendar').insert(rows).then(({ error }) => {
        if (error) console.error('smm_calendar insert error:', error.message)
      })
    }

    const intentLabel = intent === 'plan'
      ? "Here's a 30-day content calendar — added to your SMM Calendar page. Review any post and tap Edit Caption or Brief to refine."
      : intent === 'caption'
      ? "Here's your caption — copy it or hit me with tweaks."
      : "Here's your reel script — hook, body, and CTA ready to shoot."

    const canvas: Record<string, unknown> = { [intent]: result.output }
    await finaliseTurn(ctx, canvas, intentLabel)
    await persistMessages(ctx, intentLabel, canvas, message || undefined)

    return new Response(JSON.stringify(
      buildResponse(turnId, orgId, 'ready', intentLabel, ctx.delegations, canvas, true)
    ), { headers: corsHeaders() })

  } catch (err) {
    ctx.delegations[0].status = 'failed'
    await failTurn(ctx)

    const usage = err instanceof KavyaOutputError ? err.usage : undefined
    await langfuseGeneration(traceId, {
      name: `kavya-${intent}`,
      input: { intent, message },
      level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error',
      model: result_model_on_error(intent), inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    })
    console.error('runKavya failed:', err instanceof Error ? err.message : err)
    if (usage) {
      await adminClient.from('agent_interactions').insert({
        org_id: orgId, user_id: userId, agent: 'kavya', trace_id: traceId,
        model: result_model_on_error(intent),
        input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
        cost_usd: claudeCostUsd(usage.inputTokens, usage.outputTokens),
      })
    }

    const fallback = "I hit a snag with that content request. Want to try rephrasing it, or ask for something more specific?"
    const canvas = {}
    await persistMessages(ctx, fallback, canvas, message || undefined)
    return new Response(JSON.stringify(
      buildResponse(turnId, orgId, 'ready', fallback, ctx.delegations, canvas, true)
    ), { headers: corsHeaders() })
  }
}

// Returns the model string for error-path Langfuse/cost rows where the result
// variable is unavailable (the error was thrown before the LLM responded).
function result_model_on_error(intent: KavyaIntent): string {
  return intent === 'plan' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'
}

// ─── Approve action ───────────────────────────────────────────────────────────
//
// INVARIANT: Approve is idempotent — a second call on an already-approved turn
// returns the existing state without double-writing memory or conversation rows.
// Idempotency is enforced by the approved_at IS NOT NULL sentinel on the turn.
//
// No real Meta/ad-launch integration exists. The turn status is set to
// 'ready_to_launch' to signal the campaign is approved and ready; the UI
// surfaces this honestly rather than pretending a launch happened.

async function handleApprove(
  body: AgentRequest,
  ctx: { orgId: string; userId: string; adminClient: DB }
): Promise<Response> {
  const { orgId, adminClient } = ctx

  if (!body.turn_id) {
    return new Response(JSON.stringify({ error: 'turn_id is required for action=approve' }), {
      status: 400, headers: corsHeaders(),
    })
  }

  // Validate the turn exists and belongs to this org (never trust turn_id alone).
  const { data: turn, error: turnErr } = await adminClient
    .from('agent_turns')
    .select('*')
    .eq('id', body.turn_id)
    .eq('org_id', orgId)
    .single()

  if (turnErr || !turn) {
    return new Response(JSON.stringify({ error: 'Turn not found or access denied' }), {
      status: 404, headers: corsHeaders(),
    })
  }

  // IDEMPOTENT: already approved — return current state without re-writing.
  if (turn.approved_at) {
    return new Response(JSON.stringify({
      success: true,
      turn_status: turn.status,
      turn_id: body.turn_id,
      already_approved: true,
    }), { headers: corsHeaders() })
  }

  const canvas = (turn.canvas ?? {}) as {
    strategy?: StrategyConfig;
    creatives?: CreativeVariant[];
    brand?: unknown;
  }

  // Filter to selected creatives, or use all if none specified.
  const selectedCreatives = body.selected_creative_ids?.length
    ? (canvas.creatives ?? []).filter(c => body.selected_creative_ids!.includes(c.id))
    : (canvas.creatives ?? [])

  const platform = canvas.strategy?.platform ?? 'unknown platform'
  const funnel   = canvas.strategy?.primary_funnel_stage ?? ''
  const date     = new Date().toISOString().split('T')[0]
  const strategyNotes = canvas.strategy?.notes ?? ''
  // summary is plain text for future ILIKE / full-text search. pgvector
  // embedding is a follow-on (no vector column exists yet — see CLAUDE.md).
  const summary = `Approved ${platform} ${funnel} campaign — ${date}. ${strategyNotes}`.trim()

  // Fetch the original user brief — the first user message in this session.
  // Stored directly on agent_memory so the recall phase can embed it
  // without joining through agent_messages at query time.
  let userBrief: string | null = null
  const { data: firstMsg } = await adminClient
    .from('agent_messages')
    .select('content')
    .eq('session_id', turn.session_id)
    .eq('org_id', orgId)
    .eq('role', 'user')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (firstMsg) userBrief = (firstMsg as { content: string }).content

  // Write approved decision to agent_memory for future recall.
  await adminClient.from('agent_memory').insert({
    org_id:             orgId,
    project_id:         turn.project_id ?? null,
    turn_id:            body.turn_id,
    memory_type:        'approved_campaign',
    strategy:           (canvas.strategy ?? null) as unknown as Json,
    selected_creatives: selectedCreatives as unknown as Json,
    brand_verdict:      (canvas.brand ?? null) as unknown as Json,
    summary,
    user_brief:         userBrief,
  })

  // Mark turn approved. No real launch integration exists — 'ready_to_launch'
  // is the honest terminal state until a Meta create-campaign edge function
  // is wired (future phase). Do NOT change this to 'approved' without
  // adding a real launch call above this line.
  await adminClient.from('agent_turns').update({
    status:      'ready_to_launch',
    approved_at: new Date().toISOString(),
  }).eq('id', body.turn_id)

  return new Response(JSON.stringify({
    success:      true,
    turn_status:  'ready_to_launch',
    turn_id:      body.turn_id,
  }), { headers: corsHeaders() })
}

// ─── Regenerate turn ──────────────────────────────────────────────────────────

async function handleRegenerateCreatives(
  regen: { strategy: StrategyConfig; angle?: CreativeAngle; keep?: CreativeVariant[] },
  ctx: OrchestrationCtx,
  costCeilingUsd: number,
  tier: string,
): Promise<Response> {
  const { traceId, orgId, userId, projectId, adminClient, delegations, turnId, sessionId } = ctx

  // Strategy is reused unchanged — mark Arjun done immediately.
  delegations[0].status = 'done'
  delegations[1].status = 'working'
  await updateTurnDelegations(ctx) // Realtime push: Aanya working

  try {
    const result = await runAanya({
      orgId, projectId, strategy: regen.strategy, traceId, onlyAngle: regen.angle,
      costCeilingUsd,
    })
    delegations[1].status = 'done'
    await updateTurnDelegations(ctx) // Realtime push: Aanya done

    await langfuseGeneration(traceId, {
      name: 'aanya-creative-loop',
      input: { strategy: regen.strategy, angle: regen.angle },
      output: { variants: result.variants.map(v => ({ angle: v.angle, image_url: v.image_url })), capHit: result.capHit },
      model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    })
    if (result.capHit) {
      await langfuseSpan(traceId, {
        name: 'budget-cap-hit',
        output: { tier, ceilingUsd: costCeilingUsd, variantsProduced: result.variants.length },
      })
    }
    await adminClient.from('agent_interactions').insert({
      org_id: orgId, user_id: userId, agent: 'aanya', trace_id: traceId,
      model: result.model,
      input_tokens: result.inputTokens, output_tokens: result.outputTokens,
      cost_usd: result.totalCostUsd,
    })

    const creatives = regen.angle
      ? [...(regen.keep ?? []), ...result.variants]
      : result.variants

    const capNote = result.capHit
      ? " I hit your plan's limit partway through — here's what I managed." : ''
    const aaravText = regen.angle
      ? `Regenerated the ${regen.angle} creative — take a look.${capNote}`
      : `Regenerated all three creatives — take a look.${capNote}`
    const canvas = { strategy: regen.strategy, creatives }
    await finaliseTurn(ctx, canvas as Record<string, unknown>, aaravText, result.capHit)
    await persistMessages(ctx, aaravText, canvas as Record<string, unknown>)

    return new Response(JSON.stringify(
      buildResponse(turnId, orgId, 'ready', aaravText, delegations, canvas, true)
    ), { headers: corsHeaders() })
  } catch (err) {
    delegations[1].status = 'failed'
    await failTurn(ctx)
    const usage = err instanceof AanyaOutputError ? err.usage : undefined
    await langfuseGeneration(traceId, {
      name: 'aanya-creative-loop',
      input: { strategy: regen.strategy, angle: regen.angle },
      level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error',
      model: 'claude-sonnet-4-6', inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    })
    console.error('runAanya (regenerate) failed:', err instanceof Error ? err.message : err)
    if (usage) {
      await adminClient.from('agent_interactions').insert({
        org_id: orgId, user_id: userId, agent: 'aanya', trace_id: traceId,
        model: 'claude-sonnet-4-6',
        input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
        cost_usd: claudeCostUsd(usage.inputTokens, usage.outputTokens),
      })
    }
    const fallbackText = 'I hit a snag regenerating that creative. Want to try again?'
    const canvas = { strategy: regen.strategy, creatives: regen.keep ?? [] }
    await persistMessages(ctx, fallbackText, canvas as Record<string, unknown>)
    return new Response(JSON.stringify(
      buildResponse(turnId, orgId, 'ready', fallbackText, delegations, canvas, true)
    ), { headers: corsHeaders() })
  }
}

// ─── Response builder ─────────────────────────────────────────────────────────

function buildResponse(
  turnId: string,
  orgId: string,
  status: 'idle' | 'thinking' | 'generating' | 'ready',
  content: string,
  delegations: DelegationStatus[],
  canvas: Record<string, unknown>,
  awaitingUser: boolean,
) {
  return {
    turn_id: turnId,
    org_id:  orgId,
    status,
    message: {
      id:        crypto.randomUUID(),
      role:      'aarav' as const,
      content,
      timestamp: new Date().toISOString(),
    },
    delegations,
    canvas,
    awaiting_user: awaitingUser,
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type':                 'application/json',
  }
}

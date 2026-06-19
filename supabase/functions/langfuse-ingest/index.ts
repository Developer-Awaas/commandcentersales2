/**
 * langfuse-ingest
 *
 * Secure proxy so browser code (src/lib/ai-service.ts) can log a Langfuse
 * trace + generation for LLM calls it makes directly to the Anthropic API.
 *
 * Why this exists: those calls happen client-side with the user's own
 * Claude API key (see ai-service.ts header comment — a known, pre-existing
 * architectural tradeoff, not something this function changes). The
 * Langfuse SECRET key must never reach the browser, so the browser can't
 * call the Langfuse ingestion API directly. Instead it calls this function
 * with the (non-sensitive) trace data, and the function forwards it to
 * Langfuse using the secret stored in this function's environment.
 *
 * Requires a valid Supabase Authorization header so the endpoint can't be
 * used as an open relay. No Anthropic/Claude API key ever passes through
 * here — only prompts/outputs/token counts/model name.
 *
 * Input:  { traceName, sessionId?, tags?, input?, output?, model?,
 *           inputTokens?, outputTokens?, level?, statusMessage?, metadata? }
 * Output: { ok: true } (always 200 once authenticated — never blocks the
 *           caller's real work on a tracing failure)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { langfuseTrace, langfuseGeneration } from '../_shared/langfuse.ts'

interface IngestRequest {
  traceName?: string
  sessionId?: string
  tags?: string[]
  input?: unknown
  output?: unknown
  model?: string
  inputTokens?: number
  outputTokens?: number
  level?: 'DEFAULT' | 'WARNING' | 'ERROR'
  statusMessage?: string
  metadata?: Record<string, unknown>
}

// Defensive scrub in case a caller accidentally includes a key in
// input/output/metadata — these should never be sent to Langfuse.
const SECRET_PATTERN = /\b(sk-ant-[a-zA-Z0-9_-]+|sk-lf-[a-zA-Z0-9-]+|Bearer\s+\S+)\b/g

function scrub(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_PATTERN, '[redacted]')
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v)]))
  }
  return value
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: corsHeaders(),
    })
  }

  const userClient = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
      status: 401,
      headers: corsHeaders(),
    })
  }
  const userId = userData.user.id

  let body: IngestRequest
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }

  if (!body.traceName) {
    return new Response(JSON.stringify({ error: 'traceName is required' }), { status: 400, headers: corsHeaders() })
  }

  const traceId = `client-${crypto.randomUUID()}`

  await langfuseTrace(traceId, {
    name: body.traceName,
    userId,
    sessionId: body.sessionId,
    tags: body.tags,
    metadata: scrub(body.metadata) as Record<string, unknown> | undefined,
    input: scrub(body.input),
  })

  await langfuseGeneration(traceId, {
    name: body.traceName,
    model: body.model,
    input: scrub(body.input),
    output: scrub(body.output),
    inputTokens: body.inputTokens,
    outputTokens: body.outputTokens,
    level: body.level,
    statusMessage: body.statusMessage,
  })

  // Always 200 — tracing must never surface as a user-facing failure.
  return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders() })
})

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

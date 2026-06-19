/**
 * Minimal Langfuse ingestion client shared by aarav-orchestrate and any
 * specialist module it invokes (arjun.ts, and later aanya.ts/diya.ts), plus
 * any other Edge Function that makes an LLM call server-side.
 *
 * Hand-rolled against the (legacy but still supported) POST
 * /api/public/ingestion batch endpoint rather than the OTel SDK — Edge
 * Functions are short-lived Deno isolates where pulling in
 * @opentelemetry/sdk-node + @langfuse/otel is unnecessary weight for a
 * handful of fetch calls we can await directly before the response returns.
 *
 * No-ops cleanly when LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY secrets
 * aren't set (e.g. local dev) so observability never blocks a response.
 */

function config() {
  return {
    publicKey: Deno.env.get('LANGFUSE_PUBLIC_KEY'),
    secretKey: Deno.env.get('LANGFUSE_SECRET_KEY'),
    host: Deno.env.get('LANGFUSE_HOST') ?? Deno.env.get('LANGFUSE_BASE_URL') ?? 'https://cloud.langfuse.com',
  }
}

async function sendBatch(batch: Record<string, unknown>[]): Promise<void> {
  const { publicKey, secretKey, host } = config()
  if (!publicKey || !secretKey) return
  try {
    const basicAuth = btoa(`${publicKey}:${secretKey}`)
    const res = await fetch(`${host}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}` },
      body: JSON.stringify({ batch }),
    })
    if (!res.ok) {
      console.error('Langfuse ingestion failed:', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('Langfuse ingestion failed:', err instanceof Error ? err.message : err)
  }
}

export async function langfuseTrace(
  traceId: string,
  body: {
    name: string
    userId?: string
    sessionId?: string
    tags?: string[]
    metadata?: Record<string, unknown>
    input?: unknown
  }
): Promise<void> {
  await sendBatch([
    {
      id: crypto.randomUUID(),
      type: 'trace-create',
      timestamp: new Date().toISOString(),
      body: { id: traceId, environment: Deno.env.get('LANGFUSE_ENVIRONMENT') ?? 'production', ...body },
    },
  ])
}

// Non-LLM step under a trace (e.g. orchestration/routing work that doesn't
// itself call a model). Use langfuseGeneration instead for actual LLM calls
// so they're tagged as GENERATION observations (enables token/cost analytics
// and model-specific views in the Langfuse UI).
export async function langfuseSpan(
  traceId: string,
  body: {
    name: string
    input?: unknown
    output?: unknown
    level?: 'DEFAULT' | 'WARNING' | 'ERROR'
    statusMessage?: string
    parentObservationId?: string
  }
): Promise<string> {
  const spanId = crypto.randomUUID()
  const now = new Date().toISOString()
  await sendBatch([
    {
      id: crypto.randomUUID(),
      type: 'span-create',
      timestamp: now,
      body: { id: spanId, traceId, startTime: now, endTime: now, ...body },
    },
  ])
  return spanId
}

// An actual LLM call — marked as a GENERATION observation so Langfuse can
// compute cost/latency analytics and show it in model-specific views,
// per the "correct observation types" baseline requirement.
export async function langfuseGeneration(
  traceId: string,
  body: {
    name: string
    input?: unknown
    output?: unknown
    model?: string
    inputTokens?: number
    outputTokens?: number
    level?: 'DEFAULT' | 'WARNING' | 'ERROR'
    statusMessage?: string
    parentObservationId?: string
    startTime?: string
  }
): Promise<string> {
  const generationId = crypto.randomUUID()
  const endTime = new Date().toISOString()
  const { inputTokens, outputTokens, startTime, ...rest } = body
  await sendBatch([
    {
      id: crypto.randomUUID(),
      type: 'generation-create',
      timestamp: endTime,
      body: {
        id: generationId,
        traceId,
        startTime: startTime ?? endTime,
        endTime,
        usageDetails:
          inputTokens !== undefined || outputTokens !== undefined
            ? { input: inputTokens ?? 0, output: outputTokens ?? 0, total: (inputTokens ?? 0) + (outputTokens ?? 0) }
            : undefined,
        ...rest,
      },
    },
  ])
  return generationId
}

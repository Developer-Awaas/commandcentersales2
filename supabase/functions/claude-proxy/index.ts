const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function errorResponse(message: string): Response {
  return new Response(
    JSON.stringify({ type: 'error', error: { message } }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return errorResponse('ANTHROPIC_API_KEY not configured in Edge Function secrets.')
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body')
  }

  // _beta: optional anthropic-beta header value (e.g. 'web-search-2025-03-05')
  const beta = body._beta as string | undefined
  delete body._beta

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }
  if (beta) headers['anthropic-beta'] = beta

  // Stream from Anthropic. Supabase's 150s limit is specifically a
  // *request-idle* timeout — "if an Edge Function doesn't send a response
  // before the timeout, 504 Gateway Timeout will be returned" — separate
  // from the actual 400s wall-clock ceiling
  // (https://supabase.com/docs/guides/functions/limits). A buffered
  // (non-streaming) call with a large max_tokens can take well past 150s
  // to receive Anthropic's complete response before this function ever
  // sends a single byte back, which 504s regardless of how much wall-clock
  // time would otherwise remain. Streaming sends the first bytes back
  // almost immediately, satisfying that check, while generation continues
  // under the higher ceiling. Every caller (aiCall/aiVision/
  // describeImageForFlux and the two direct-invoke callers) only ever
  // consumed the concatenated text + usage totals, never individual
  // content-block structure — see callClaudeProxyStream in ai-service.ts
  // — so passing the raw SSE stream through requires no server-side
  // reconstruction, no separate non-streaming code path.
  body.stream = true

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // Also fixes a real gap: this fetch previously had NO timeout at
      // all — a genuinely hung upstream call would run until the
      // platform's own wall-clock kill, which reports as a resource
      // error (HTTP 546) rather than a clean, readable timeout message
      // (the exact failure mode bug #35 was written about, but this
      // AbortSignal was never actually present in the shipped file).
      // 350s leaves headroom under the 400s wall-clock ceiling.
      signal: AbortSignal.timeout(350_000),
    })
  } catch (err) {
    const msg = err instanceof Error && err.name === 'TimeoutError'
      ? 'Anthropic API timed out after 350s'
      : `Anthropic API unreachable: ${err instanceof Error ? err.message : String(err)}`
    return errorResponse(msg)
  }

  // A rejected request (bad params, auth failure, etc.) gets a normal JSON
  // error body from Anthropic even with stream:true — streaming only
  // starts once generation actually begins. Normalise it the same way the
  // non-streaming path always did.
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '')
    try {
      const errJson = JSON.parse(errText)
      return errorResponse(errJson?.error?.message ?? `Anthropic error ${upstream.status}`)
    } catch {
      return errorResponse(`Anthropic error ${upstream.status}: ${errText.slice(0, 200)}`)
    }
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS },
  })
})

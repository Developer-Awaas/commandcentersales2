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

  // Wrap the upstream call — if fetch throws (network error, timeout, DNS),
  // the runtime would crash with HTTP 546 without this try/catch.
  let responseText: string
  let upstreamStatus: number
  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    upstreamStatus = upstream.status
    responseText = await upstream.text()
  } catch (err) {
    return errorResponse(`Anthropic API unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Always return HTTP 200 so the Supabase SDK never throws FunctionsHttpError.
  // If Anthropic returned a non-2xx the response body already contains
  // { type: 'error', error: { ... } } which aiCall/aiVision check for.
  if (upstreamStatus >= 200 && upstreamStatus < 300) {
    return new Response(responseText, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  // Anthropic error response — parse and normalise so callers always
  // get { type: 'error', error: { message: '...' } }
  try {
    const errJson = JSON.parse(responseText)
    const message = errJson?.error?.message ?? `Anthropic error ${upstreamStatus}`
    return errorResponse(message)
  } catch {
    return errorResponse(`Anthropic error ${upstreamStatus}: ${responseText.slice(0, 200)}`)
  }
})

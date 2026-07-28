// Verifies Canva's "Return Navigation" correlation_jwt — a completely
// separate mechanism from the OAuth flow (canva-oauth-callback). Once a
// user clicks the "Return" button inside Canva's editor (a feature enabled
// per-integration in the Canva Developer Portal's "Return navigation"
// page, with a single fixed return URL configured there — not something
// this app can set per-request), Canva redirects the editor tab to
// `{returnUrl}?correlation_jwt={jwt}`. That JWT is unauthenticated by
// itself (just a URL redirect, no Authorization header) — its signature
// MUST be checked against Canva's own published public keys before
// trusting anything in it, exactly as Canva's own docs prescribe:
// https://www.canva.dev/docs/connect/return-navigation-guide/
import * as jose from 'https://esm.sh/jose@5'

const CANVA_KEYS_URL = 'https://api.canva.com/rest/v1/connect/keys'

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  let body: { correlationJwt?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ valid: false, error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }
  if (!body.correlationJwt) {
    return new Response(JSON.stringify({ valid: false, error: 'correlationJwt is required' }), { status: 400, headers: corsHeaders() })
  }

  const clientId = Deno.env.get('CANVA_CLIENT_ID')
  if (!clientId) {
    return new Response(JSON.stringify({ valid: false, error: 'CANVA_CLIENT_ID secret is not set' }), { status: 500, headers: corsHeaders() })
  }

  try {
    const JWKS = jose.createRemoteJWKSet(new URL(CANVA_KEYS_URL))
    const { payload } = await jose.jwtVerify(body.correlationJwt, JWKS, { audience: clientId })

    // "rti" = "return to integration" — the only token type this endpoint
    // is ever meant to see. Anything else is not a real return-navigation
    // token even if the signature happens to check out.
    if (payload.type !== 'rti') {
      return new Response(JSON.stringify({ valid: false, error: 'Unexpected token type' }), { status: 400, headers: corsHeaders() })
    }

    return new Response(JSON.stringify({
      valid: true,
      designId: (payload.design_id as string | undefined) ?? null,
      // Set by this app when opening the editor (appended to edit_url as
      // ?correlation_state=..., capped at 50 chars per Canva's docs) —
      // echoed back verbatim here. Empty string if never set.
      correlationState: (payload.correlation_state as string | undefined) ?? '',
    }), { headers: corsHeaders() })
  } catch (err) {
    return new Response(
      JSON.stringify({ valid: false, error: err instanceof Error ? err.message : 'Verification failed' }),
      { status: 401, headers: corsHeaders() }
    )
  }
})

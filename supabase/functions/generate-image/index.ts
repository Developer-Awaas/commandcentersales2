/**
 * generate-image
 *
 * Server-side proxy for NVIDIA NIM — FLUX.1-schnell image generation.
 * Called by gemini-service.ts to avoid browser CORS issues.
 *
 * Requires env secret: NVIDIA_API_KEY (from build.nvidia.com)
 *
 * Input:  { prompt: string, width?: number, height?: number }
 * Output: { base64: string, mimeType: string }
 */

const NVIDIA_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const apiKey = Deno.env.get('NVIDIA_API_KEY') ?? ''
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'NVIDIA_API_KEY secret is not set' }), { status: 500, headers: corsHeaders() })
  }

  let body: { prompt?: string; width?: number; height?: number }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }

  const { prompt, width = 1080, height = 1080 } = body
  if (!prompt || typeof prompt !== 'string') {
    return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400, headers: corsHeaders() })
  }

  const safePrompt = prompt.slice(0, 1000)

  try {
    const imageRes = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        prompt: safePrompt,
        seed: Math.floor(Math.random() * 999999),
        steps: 4,
      }),
    })

    if (!imageRes.ok) {
      const errText = await imageRes.text().catch(() => imageRes.statusText)
      return new Response(
        JSON.stringify({ error: `NVIDIA API error ${imageRes.status}: ${errText}` }),
        { status: 502, headers: corsHeaders() }
      )
    }

    const result = await imageRes.json() as { artifacts?: { base64: string }[] }
    const base64 = result.artifacts?.[0]?.base64
    if (!base64) {
      return new Response(
        JSON.stringify({ error: 'No image returned from NVIDIA API' }),
        { status: 502, headers: corsHeaders() }
      )
    }

    return new Response(
      JSON.stringify({ base64, mimeType: 'image/jpeg' }),
      { headers: corsHeaders() }
    )
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: corsHeaders() }
    )
  }
})

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

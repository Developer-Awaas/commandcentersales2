/**
 * generate-image
 *
 * Server-side proxy for OpenAI GPT-Image-1 image generation.
 * Called by gemini-service.ts to avoid browser CORS issues.
 *
 * Requires env secret: OPENAI_API_KEY
 *
 * Input:  { prompt: string, width?: number, height?: number }
 * Output: { base64: string, mimeType: string }
 *
 * GPT-Image-1 supported sizes:
 *   Square    (1:1)        → 1024×1024
 *   Portrait  (4:5 / 9:16) → 1024×1536
 *   Landscape               → 1536×1024
 *
 * GPT-Image-1 always returns base64 in data[0].b64_json directly.
 *
 * Observability: each call is wrapped in its own Langfuse trace (no-op if
 * LANGFUSE_* secrets aren't set). Image bytes are never sent to Langfuse —
 * only the prompt, size/quality params, and success/failure.
 */

import { langfuseTrace, langfuseGeneration } from '../_shared/langfuse.ts'

const OPENAI_URL = 'https://api.openai.com/v1/images/generations'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY secret is not set' }),
      { status: 500, headers: corsHeaders() }
    )
  }

  let body: { prompt?: string; width?: number; height?: number; quality?: 'low' | 'medium' | 'high' }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }

  const { prompt, width = 1080, height = 1080, quality = 'medium' } = body
  if (!prompt || typeof prompt !== 'string') {
    return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400, headers: corsHeaders() })
  }

  // Map caller dimensions to the closest supported GPT-Image-1 size
  const size = height > width ? '1024x1536' : width > height ? '1536x1024' : '1024x1024'

  const safePrompt = prompt.slice(0, 4000)

  const traceId = `generate-image-${crypto.randomUUID()}`
  await langfuseTrace(traceId, {
    name: 'generate-image',
    tags: ['image-gen', 'gpt-image-1'],
    metadata: { size, quality },
    input: { prompt: safePrompt },
  })

  try {
    const imageRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: safePrompt,
        n: 1,
        size,
        quality, // low | medium | high — caller sets per aspect ratio
      }),
    })

    if (!imageRes.ok) {
      const errText = await imageRes.text().catch(() => imageRes.statusText)
      await langfuseGeneration(traceId, {
        name: 'gpt-image-1',
        model: 'gpt-image-1',
        input: { prompt: safePrompt, size, quality },
        level: 'ERROR',
        statusMessage: `OpenAI API error ${imageRes.status}: ${errText}`,
      })
      return new Response(
        JSON.stringify({ error: `OpenAI API error ${imageRes.status}: ${errText}` }),
        { status: 502, headers: corsHeaders() }
      )
    }

    const result = await imageRes.json() as { data?: { b64_json?: string }[] }
    const base64 = result.data?.[0]?.b64_json
    if (!base64) {
      await langfuseGeneration(traceId, {
        name: 'gpt-image-1',
        model: 'gpt-image-1',
        input: { prompt: safePrompt, size, quality },
        level: 'ERROR',
        statusMessage: 'No image returned from OpenAI API',
      })
      return new Response(
        JSON.stringify({ error: 'No image returned from OpenAI API' }),
        { status: 502, headers: corsHeaders() }
      )
    }

    await langfuseGeneration(traceId, {
      name: 'gpt-image-1',
      model: 'gpt-image-1',
      input: { prompt: safePrompt, size, quality },
      output: { imageGenerated: true, mimeType: 'image/png' },
    })

    return new Response(
      JSON.stringify({ base64, mimeType: 'image/png' }),
      { headers: corsHeaders() }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await langfuseGeneration(traceId, {
      name: 'gpt-image-1',
      model: 'gpt-image-1',
      input: { prompt: safePrompt, size, quality },
      level: 'ERROR',
      statusMessage: message,
    })
    return new Response(
      JSON.stringify({ error: message }),
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

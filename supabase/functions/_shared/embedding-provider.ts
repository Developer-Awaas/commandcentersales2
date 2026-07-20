/**
 * Embedding provider abstraction.
 *
 * Provider selected by EMBEDDING_PROVIDER env var, default 'openai'.
 * OpenAI path: text-embedding-3-small with dimensions:1024 (exactly 1024 floats, asserted).
 * Voyage path: stub — set EMBEDDING_PROVIDER=voyage to activate, then implement embedWithVoyage().
 *
 * Only exported surface callers need:
 *   embed(text, inputType)  — returns number[1024]
 *   toPgVector(v)           — converts to pgvector text literal for raw SQL
 */

export type EmbeddingProvider = 'openai' | 'voyage'
export type InputType = 'query' | 'document'

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings'
const EXPECTED_DIM = 1024

/** Convert a float array to pgvector text literal: '[0.1,0.2,...]' */
export function toPgVector(v: number[]): string {
  return '[' + v.join(',') + ']'
}

// One retry (two total attempts) on any API failure.
async function withOneRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.warn(
      `${label}: first attempt failed, retrying — ${err instanceof Error ? err.message : String(err)}`,
    )
    return await fn()
  }
}

async function embedWithOpenAI(text: string, _inputType: InputType): Promise<number[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: EXPECTED_DIM,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`OpenAI embeddings API error ${res.status}: ${errText}`)
  }

  const json = await res.json()
  const embedding: number[] = json?.data?.[0]?.embedding
  if (!Array.isArray(embedding)) {
    throw new Error('OpenAI embeddings: unexpected response shape — no data[0].embedding')
  }
  if (embedding.length !== EXPECTED_DIM) {
    throw new Error(
      `OpenAI embeddings: expected ${EXPECTED_DIM} dimensions, got ${embedding.length}`,
    )
  }
  return embedding
}

export async function embed(text: string, inputType: InputType): Promise<number[]> {
  const provider = (Deno.env.get('EMBEDDING_PROVIDER') ?? 'openai') as EmbeddingProvider
  switch (provider) {
    case 'openai':
      return withOneRetry(
        () => embedWithOpenAI(text, inputType),
        'embedding-provider/openai',
      )
    case 'voyage':
      // Voyage stub: inputType is used natively (query vs document differ in their API).
      // Implement embedWithVoyage() and swap this throw when activating.
      throw new Error(
        'Voyage embedding provider stub — set VOYAGE_API_KEY and implement embedWithVoyage() to activate',
      )
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER: ${provider as string}`)
  }
}

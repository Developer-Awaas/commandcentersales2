/**
 * Brace-counting JSON extractor (SSoT 7.5) — the repo's locked pattern for
 * pulling a JSON object out of LLM prose, mirrored from the depth-tracking
 * loop in src/lib/ai-service.ts's repairTruncatedJSON (scan for the first
 * '{', track nesting depth while skipping string contents/escapes, and
 * slice out the substring where depth returns to zero). Deliberately NOT a
 * regex or naive `JSON.parse(text.slice(firstBrace))` — those break the
 * moment the model adds trailing prose after the closing brace.
 *
 * Shared by every specialist agent module under _shared/agents/ (arjun.ts,
 * aanya.ts, ...) — all server-side, all within the supabase/functions tree,
 * so importing across files here is safe (unlike importing from src/, which
 * Edge Functions can't reach across the deploy boundary).
 */
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('LLM did not return a JSON object')

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  throw new Error('LLM returned an unterminated JSON object')
}

export function parseJsonObject<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
  return JSON.parse(extractJsonObject(cleaned)) as T
}

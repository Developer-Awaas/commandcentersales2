/**
 * T-006a — classify image-generation failures so `image_jobs.error` records
 * WHY a job failed, not just THAT it failed.
 *
 * Exactly one of five classes applies to every failure:
 *   provider_5xx     — OpenAI/Gemini returned a non-2xx HTTP status. Carries
 *                       the raw status code (generate-image/index.ts,
 *                       image-provider.ts all format provider errors as
 *                       "OpenAI API error ###: …" / "Gemini API error ###: …"
 *                       — matched here, not threaded through as a new field,
 *                       so every existing throw site needs no change).
 *   provider_timeout — our own AbortSignal.timeout fired on the provider
 *                       fetch (IMAGE_FETCH_TIMEOUT_MS / imageFetchTimeoutMs).
 *                       Empirically, on TEST, this surfaces as a message
 *                       containing "signal timed out" or "aborted" — the only
 *                       abort signals this codebase attaches to a fetch are
 *                       the timeout ones, so matching on that text is safe.
 *   wall_clock        — REAPER-ONLY. cleanup-stuck-image-jobs finds a
 *                       'running' row whose work started (started_at is set)
 *                       but the isolate was killed by Supabase's platform
 *                       wall-clock limit before it could write a terminal
 *                       status. The edge function can never classify this
 *                       itself — it is dead by the time it would happen.
 *   reaper             — REAPER-ONLY. cleanup-stuck-image-jobs finds a row
 *                       still 'queued' — the EdgeRuntime.waitUntil() task
 *                       never even transitioned it to 'running'. Kept
 *                       distinct from wall_clock because we cannot prove
 *                       generation was in flight when it died.
 *   unknown           — everything else: storage upload failures, the
 *                       review-build budget cap, JSON parse errors, …
 *
 * classifyImageError() only ever returns provider_5xx / provider_timeout /
 * unknown — wall_clock and reaper are written directly by the reaper's SQL,
 * which is the only code that can tell a stuck row apart from a live one.
 */

export type ImageFailureClass = 'provider_5xx' | 'provider_timeout' | 'wall_clock' | 'reaper' | 'unknown'

export interface ClassifiedImageError {
  class: ImageFailureClass
  /** Raw provider HTTP status. Only ever set when class is provider_5xx. */
  statusCode?: number
  message: string
}

const PROVIDER_STATUS_RE = /\b(?:OpenAI|Gemini) API error (\d{3}):/
const TIMEOUT_RE = /\btimed out\b|\baborted\b/i

export function classifyImageError(err: unknown): ClassifiedImageError {
  const message = err instanceof Error ? err.message : String(err)

  const providerMatch = message.match(PROVIDER_STATUS_RE)
  if (providerMatch) {
    return { class: 'provider_5xx', statusCode: Number(providerMatch[1]), message }
  }
  if (TIMEOUT_RE.test(message)) {
    return { class: 'provider_timeout', message }
  }
  return { class: 'unknown', message }
}

/** `[<class>[:<statusCode>]] <message>` — machine-parseable prefix, human text after. */
export function formatClassifiedError(c: ClassifiedImageError): string {
  const tag = c.statusCode !== undefined ? `${c.class}:${c.statusCode}` : c.class
  return `[${tag}] ${c.message}`
}

/**
 * Reads the body of a supabase.functions.invoke() error (error.context is the
 * raw Response). Kept free of the supabase client so it can be unit-tested.
 *
 * `fromFunction` is true only when the body is OUR function's own
 * `{ error: string }` — a deliberate answer, never worth retrying. Anything
 * else came from in front of the function: the gateway (`{ code, message }`,
 * e.g. "Invalid JWT"), the platform (worker limit, boot error, timeout) or an
 * uncaught throw (plain-text 500). Those surface `message` when present.
 */
export async function readFunctionError(
  error: unknown,
  fallback = 'Request failed',
): Promise<{ message: string; fromFunction: boolean }> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof (context as Response).json === 'function') {
    try {
      const body = await (context as Response).json() as Record<string, unknown> | null;
      if (body && typeof body.error === 'string') return { message: body.error, fromFunction: true };
      if (body && typeof body.message === 'string') return { message: body.message, fromFunction: false };
    } catch { /* not JSON or already consumed — fall through */ }
  }
  return { message: error instanceof Error ? error.message : fallback, fromFunction: false };
}

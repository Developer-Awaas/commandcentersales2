// Resolves a user-facing message for a failed SMM creative generation.
//
// Root-cause note (verified live against TEST 2026-07-28, see diag scripts):
// two real claude-proxy calls with the actual buildSMMCreativePrompt schema
// (a plain "company_branding" post and a "testimonial" post — the type most
// likely to trigger an LLM unescaped-quote JSON bug) both round-tripped
// through claude-proxy's SSE stream and ai-service.ts's extractJson cleanly.
// No reproducible parse/API failure was found in the core pipeline.
//
// What WAS a real, verifiable gap: SMMCreatives.tsx's generate() discarded
// aiCall's actual res.error (a quota message or a genuine claude-proxy
// error) and always showed the same generic "Generation failed" toast —
// not literally silent, but unhelpfully generic, which is what a user
// experiencing an intermittent or quota-related failure would describe as
// "it just fails." This resolves and surfaces the real reason instead.
export function resolveGenerationErrorMessage(res: Record<string, unknown> | null | undefined): string {
  if (res && typeof res.error === 'string' && res.error) {
    return `Generation failed: ${res.error}`;
  }
  if (res && typeof res.raw === 'string') {
    return 'Generation failed: response could not be parsed as structured data.';
  }
  return 'Generation failed. Please try again.';
}

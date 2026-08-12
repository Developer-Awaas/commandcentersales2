/**
 * `import.meta.env` is Vite-only — it's statically replaced at build time, so
 * the browser bundle is unaffected by this indirection. Under plain Node it is
 * `undefined`, and any module reading it at load time throws before its first
 * line runs.
 *
 * That matters because node-side tooling in scripts/ imports real modules from
 * src/ so it exercises the SHIPPED code (see replicate-live-check.ts, which
 * runs the actual buildReplicatePrompt rather than a hand-copied prompt — the
 * divergence that made V5's copy-integrity finding inconclusive). Falling back
 * to process.env there keeps that possible.
 *
 * Only modules that node tooling actually pulls in need this; components that
 * are browser-only can keep reading import.meta.env directly.
 */
export const viteEnv = (import.meta.env
  ?? (globalThis as { process?: { env?: Record<string, string> } }).process?.env
  ?? {}) as Record<string, string | undefined>;

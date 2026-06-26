---
name: dev
description: >
  Run, build, and verify the Command Center V2 stack locally. Use for:
  (1) starting the Vite dev server, (2) type-checking the React/TS client,
  (3) running deno check on Edge Functions, (4) running the agent unit tests,
  (5) doing a full clean build, or any combination of these. This skill
  avoids ad-hoc one-off commands scattered across responses by giving one
  consistent entry point for all local dev tasks.
allowed-tools:
  - Bash(npm run dev *)
  - Bash(npm run build *)
  - Bash(npm run typecheck *)
  - Bash(npm run lint *)
  - Bash(npm run preview *)
  - Bash(npm ci *)
  - Bash(deno check *)
  - Bash(deno test *)
  - Bash(deno cache *)
  - Bash(deno fmt *)
  - Bash(deno lint *)
---

# Command Center V2 — Dev Skill

Use this skill whenever you need to run, build, type-check, or test anything
in this repo. It covers the full stack: the Vite/React/TS client AND the
Supabase Edge Functions (Deno).

All commands are run from the repo root (`d:\commandcentersales2`).

---

## 1. Client (Vite + React + TypeScript)

| Task | Command |
|---|---|
| Dev server (hot-reload) | `npm run dev` |
| Production build | `npm run build` |
| TypeScript type-check only (no emit) | `npm run typecheck` |
| ESLint | `npm run lint` |
| Preview the production build locally | `npm run preview` |
| Clean install of dependencies | `npm ci` |

**Clean dev start** (install → build check → start server):
```sh
npm ci && npm run typecheck && npm run dev
```

**Clean build** (type-check then build):
```sh
npm run typecheck && npm run build
```

---

## 2. Edge Functions (Deno 2.x)

`supabase/functions/deno.json` is the Deno config; it is auto-discovered by
any `deno` command run on files under `supabase/functions/`.

### Type-check all 9 entry points

```sh
deno check \
  supabase/functions/aarav-orchestrate/index.ts \
  supabase/functions/canva-oauth-callback/index.ts \
  supabase/functions/canva-open-editor/index.ts \
  supabase/functions/canva-sync-design/index.ts \
  supabase/functions/generate-creatives/index.ts \
  supabase/functions/generate-image/index.ts \
  supabase/functions/langfuse-ingest/index.ts \
  supabase/functions/meta-insights-sync/index.ts \
  supabase/functions/claude-proxy/index.ts
```

### Unit tests (no credentials required)

```sh
deno test --allow-env supabase/functions/_shared/agents/
```

Discovers all `*_test.ts` and `*.test.ts` files in the agents directory.
Tests requiring live credentials are `ignore:true` or auto-ignored via
`ignore: !SMOKE_ENV_VAR`. Currently runs 4 aanya tests + the diya no-kit test.

### Run a specific test file

```sh
deno test --allow-env supabase/functions/_shared/agents/aanya_test.ts
```

### Run smoke tests that need credentials (manual only)

```sh
ANTHROPIC_API_KEY=sk-ant-... \
SUPABASE_URL=https://...supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
SMOKE_ON_BRAND_URL=https://... \
SMOKE_OFF_BRAND_URL=https://... \
deno test --allow-env --allow-net \
  supabase/functions/_shared/agents/diya_smoke_test.ts
```

---

## 3. Full pre-push check (mirrors CI)

Run this before pushing to catch any type errors across both the client and
edge functions — same checks as `.github/workflows/typecheck.yml`:

```sh
npm run build && \
deno check \
  supabase/functions/aarav-orchestrate/index.ts \
  supabase/functions/canva-oauth-callback/index.ts \
  supabase/functions/canva-open-editor/index.ts \
  supabase/functions/canva-sync-design/index.ts \
  supabase/functions/generate-creatives/index.ts \
  supabase/functions/generate-image/index.ts \
  supabase/functions/langfuse-ingest/index.ts \
  supabase/functions/meta-insights-sync/index.ts \
  supabase/functions/claude-proxy/index.ts && \
deno test --allow-env supabase/functions/_shared/agents/
```

Or just install the committed git hook (runs this automatically on every push):
```sh
git config core.hooksPath scripts/hooks
```

---

## 4. Adding a new Edge Function

When a new `supabase/functions/*/index.ts` is created:

1. Add it to the `deno check` list in **both**:
   - `.github/workflows/typecheck.yml` (under `edge-typecheck` job)
   - `scripts/hooks/pre-push`
2. Update `supabase/functions/_shared/database.types.ts` if any migration
   was added alongside it (hand-written — see CLAUDE.md §Edge Function DB types).

---

## Notes

- **Deno version**: 2.8.3 (installed via Scoop). Upgrade: `scoop update deno`.
- **Node version**: whatever is active locally (project targets Node 20 in CI).
- The dev server binds to `localhost:5173` by default (Vite default).
- `npm run build` output goes to `dist/`. Supabase Edge Functions are NOT
  bundled by this build — they deploy separately via `supabase functions deploy`.

import { defineConfig, devices } from '@playwright/test';

// Local dev + VITE_MOCK_AI=true only — no real Anthropic/GPT-Image-1 spend,
// no real Supabase writes beyond what ZZ-INTERNAL-TEST is scoped for. See
// e2e/history-journey.spec.ts's header for the credential requirement and
// its graceful-skip behavior when they're absent (CI doesn't have them
// wired up yet — see CLAUDE.md's CI gate section).
const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  // Generous: one test drives a full multi-step flow with several real
  // PROD writes (creatives + campaign + tool_outputs inserts, then a
  // distill that does sequential deletes).
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  // list = readable CI console output; html = the report the CI job's
  // upload-artifact step publishes (with the trace, on failure) — a
  // list-only reporter produces no playwright-report/ dir, making that
  // upload a silent no-op.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // A built preview, not the dev server — closer to what actually ships
    // and faster to serve once built. VITE_MOCK_AI is baked into the build
    // (Vite inlines import.meta.env at build time), so it must be set for
    // the `build` half of this command, not just `preview`.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_MOCK_AI: 'true' },
  },
});

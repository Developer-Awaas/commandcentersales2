import { defineConfig, devices } from '@playwright/test';

// Local dev + VITE_MOCK_AI=true only — no real Anthropic/GPT-Image-1 spend,
// no real Supabase writes beyond what ZZ-INTERNAL-TEST is scoped for. See
// e2e/history-journey.spec.ts's header for the credential requirement and
// its graceful-skip behavior when they're absent (CI doesn't have them
// wired up yet — see CLAUDE.md's CI gate section).
const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { VITE_MOCK_AI: 'true' },
  },
});

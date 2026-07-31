import { test, expect } from '@playwright/test';

// End-to-end evidence for CC-P3: generate a strategy through the Campaign
// Wizard -> save -> appears in History -> expand journey -> mark the
// campaign complete -> confirm the distill dialog -> the history entry is
// gone. Runs against local dev with VITE_MOCK_AI=true (playwright.config.ts
// sets it via webServer.env — no real Anthropic/GPT-Image-1 spend), signed
// in as the ZZ-INTERNAL-TEST org's dedicated user
// (983c7c08-ffaf-402b-981a-a9cd22615cae, see CLAUDE.md's "Internal test org
// (PROD)" rule) so every write this test makes is scoped to a real,
// disposable, already-isolated org — never TEST, never a real customer org.
//
// Requires INTERNAL_TEST_USER_EMAIL / INTERNAL_TEST_USER_PASSWORD as env
// vars (the same GitHub repo secrets created for this org — deliberately
// never available in this working tree, see .env/.env.cc-test.local, which
// don't have them either). Skips gracefully when absent, matching the
// existing credential-gated pattern in
// supabase/functions/_shared/agents/diya_smoke_test.ts — this is NOT wired
// into CI yet (no secrets configured for a Playwright job), so this file
// is real, runnable infrastructure but has not been executed end-to-end as
// part of this PR. See the PR description's evidence section for the exact
// reason and what running it requires.
const EMAIL = process.env.INTERNAL_TEST_USER_EMAIL;
const PASSWORD = process.env.INTERNAL_TEST_USER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'INTERNAL_TEST_USER_EMAIL/INTERNAL_TEST_USER_PASSWORD not set — see file header.');

test('generate strategy -> save -> History -> journey -> complete campaign -> distill -> entry gone', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL as string);
  await page.getByLabel('Password').fill(PASSWORD as string);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('NH Command Center')).not.toBeVisible({ timeout: 15_000 });

  // Campaign Wizard is the only flow that creates a real `campaigns` row
  // today (Strategy.tsx's own standalone save is a separate, untouched
  // path — see CC-P3's PR description scoping note).
  await page.getByRole('button', { name: /campaign wizard/i }).click();
  await expect(page.getByRole('heading', { name: 'Campaign Wizard' })).toBeVisible();

  // The dedicated, disposable project seeded by e2e/seed-e2e.mjs — selecting
  // it by name (not index 0) keeps this deterministic and keeps every row
  // the test creates reachable by cleanup-e2e.mjs (scoped to this project).
  await page.getByLabel('Project').selectOption({ label: 'ZZ-E2E Test Project' });
  await page.getByPlaceholder(/brief|describe/i).fill('E2E test brief — 2BHK apartments, festive season offer.');
  await page.getByRole('button', { name: /generate strategy/i }).click();

  // Post-generation: form collapses, "Save Strategy" appears.
  const saveStrategyButton = page.getByRole('button', { name: /save strategy/i });
  await expect(saveStrategyButton).toBeVisible({ timeout: 20_000 });
  await saveStrategyButton.click();
  await expect(page.getByText(/strategy saved/i)).toBeVisible();

  // History (Lead Gen section) — the just-saved strategy should appear.
  await page.getByRole('button', { name: /^history$/i }).first().click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  const historyRow = page.getByText('Strategy').first();
  await expect(historyRow).toBeVisible({ timeout: 10_000 });
  await historyRow.click();
  // Journey view renders the tool sequence.
  await expect(page.getByText('Strategy', { exact: true })).toBeVisible();

  // Campaigns — mark the new campaign completed, confirm the distill dialog.
  await page.getByRole('button', { name: /campaigns/i }).click();
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  const statusSelect = page.locator('select').first();
  await statusSelect.selectOption('completed');
  await expect(page.getByText(/distilled for AI training/i)).toBeVisible();
  await page.getByRole('button', { name: /yes, mark complete/i }).click();
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // Back in History — the campaign's entries should be gone (distilled + cleaned up).
  await page.getByRole('button', { name: /^history$/i }).first().click();
  await expect(historyRow).not.toBeVisible({ timeout: 10_000 });
});

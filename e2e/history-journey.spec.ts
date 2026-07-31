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
  // Post-login anchor: the Dashboard heading (more reliable than asserting
  // the login brand text is gone).
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

  // The sidebar is section-collapsed on login (Overview open; Lead Gen /
  // Social Media collapsed). Clicking the "Lead Gen" section header both
  // navigates to its default page and reveals its items (incl. Campaign
  // Wizard, History, Campaigns). exact:true avoids matching the dashboard's
  // "Go to Lead Gen" button.
  await page.getByRole('button', { name: 'Lead Gen', exact: true }).click();

  // Campaign Wizard is the only flow that creates a real `campaigns` row +
  // a `strategy` tool_output today (Strategy.tsx's own standalone save is a
  // separate, untouched path writing only to `creatives` — see CC-P3's PR
  // description scoping note).
  await page.getByRole('button', { name: 'Campaign Wizard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campaign Wizard' })).toBeVisible();

  // Select the dedicated, disposable project seeded by e2e/seed-e2e.mjs (by
  // name, not index 0 — keeps every row the test creates reachable by
  // cleanup-e2e.mjs, scoped to this project). The brief is intentionally
  // left empty: generation is gated only on a project, and under
  // VITE_MOCK_AI the brief text is ignored anyway.
  await page.getByLabel('Project').selectOption({ label: 'ZZ-E2E Test Project' });
  await page.getByRole('button', { name: /generate strategy/i }).click();

  // Post-generation: form collapses, "Save Strategy" appears. Clicking it
  // creates the campaign + the strategy tool_output.
  const saveStrategyButton = page.getByRole('button', { name: /save strategy/i });
  await expect(saveStrategyButton).toBeVisible({ timeout: 30_000 });
  await saveStrategyButton.click();
  await expect(page.getByRole('button', { name: /strategy saved/i })).toBeVisible();

  // Exit the wizard — in wizard mode the sidebar shows a reduced nav, so
  // History/Campaigns aren't reachable until we leave. The campaign +
  // tool_output persist across the abandon (separate tables from
  // wizard_sessions).
  await page.getByRole('button', { name: 'Exit Wizard' }).click();
  await page.getByRole('button', { name: /yes, cancel/i }).click();

  const main = page.getByRole('main');

  // History (Lead Gen) — the just-saved strategy should appear. Target the
  // row's "part of a campaign journey" marker, NOT getByText('Strategy'):
  // the History page always renders a "Strategy" filter-pill button
  // regardless of contents, so matching that text is a false positive. The
  // journey marker only appears on a real campaign-linked history row.
  await page.getByRole('button', { name: 'History', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  const journeyRow = main.getByText(/part of a campaign journey/i);
  await expect(journeyRow).toBeVisible({ timeout: 10_000 });
  await journeyRow.click(); // expand the journey view

  // Campaigns — mark the new campaign completed, confirm the distill dialog.
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  await main.locator('select').first().selectOption('completed');
  await expect(page.getByText(/distilled for AI training/i)).toBeVisible();
  await page.getByRole('button', { name: /yes, mark complete/i }).click();
  await expect(main.getByText('completed', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Back in History — the distilled campaign's entries should be gone. Again
  // target the journey-row marker (not the ever-present "Strategy" filter
  // pill); with the only entry distilled away, the empty-state copy shows.
  await page.getByRole('button', { name: 'History', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(main.getByText(/part of a campaign journey/i)).toHaveCount(0, { timeout: 10_000 });
  await expect(main.getByText(/no saved history yet/i)).toBeVisible();
});

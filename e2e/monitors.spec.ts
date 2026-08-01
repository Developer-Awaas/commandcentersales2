import { test, expect } from '@playwright/test';

// CC-P4 Step 7 — smoke the two new Monitor pages against the live app
// (VITE_MOCK_AI=true, ZZ-INTERNAL-TEST). PROD has zero campaign_metrics for
// this org, so the Performance Monitor should render its FIRST-CLASS empty
// state (connect-Meta CTA or an empty metrics list — never an error toast),
// and the SMM Monitor should load its controls. Same credential gate + graceful
// skip as history-journey.spec.ts (INTERNAL_TEST_USER_* are GitHub-secret-only).
const EMAIL = process.env.INTERNAL_TEST_USER_EMAIL;
const PASSWORD = process.env.INTERNAL_TEST_USER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'INTERNAL_TEST_USER_EMAIL/INTERNAL_TEST_USER_PASSWORD not set.');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL as string);
  await page.getByLabel('Password').fill(PASSWORD as string);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  // Expand the Lead Gen section (collapsed on login) to reveal its nav items.
  await page.getByRole('button', { name: 'Lead Gen', exact: true }).click();
}

test('Performance Monitor renders empty-state first-class (no Meta data)', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Performance Monitor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Performance Monitor' })).toBeVisible();
  // Either the connect-Meta CTA (no connection) or the empty metrics list — both
  // are valid empty states. The key assertion: no crash, the page rendered.
  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  await expect(
    main.getByText(/Connect Meta|No metrics for the last|Syncing Meta data/i).first()
  ).toBeVisible({ timeout: 30_000 });
  // The Manual entry toggle must always be available as a fallback.
  await expect(page.getByRole('button', { name: /manual entry/i })).toBeVisible();
});

test('SMM Monitor loads', async ({ page }) => {
  await login(page);
  // History item shares the "SMM Monitor"? No — go via the SMM section.
  await page.getByRole('button', { name: 'Social Media', exact: true }).click();
  await page.getByRole('button', { name: 'SMM Monitor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SMM Monitor' })).toBeVisible();
  await expect(page.getByRole('button', { name: /manual entry/i })).toBeVisible();
});

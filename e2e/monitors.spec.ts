import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// CC-P4 — smoke + screenshot the two new Monitor pages against the live app
// (VITE_MOCK_AI=true, ZZ-INTERNAL-TEST). Assertions are STATE-TOLERANT: they
// verify the page renders and its Manual-entry fallback is present, NOT a
// specific empty-vs-populated state — ZZ-INTERNAL-TEST is seeded with demo
// metrics for populated screenshots, but the suite must stay green whether or
// not that seed is present. Full-page screenshots are written to screenshots/
// and uploaded as a CI artifact (populated when the demo seed is in place).
// Same credential gate + graceful skip as history-journey.spec.ts.
const EMAIL = process.env.INTERNAL_TEST_USER_EMAIL;
const PASSWORD = process.env.INTERNAL_TEST_USER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'INTERNAL_TEST_USER_EMAIL/INTERNAL_TEST_USER_PASSWORD not set.');

try { mkdirSync('screenshots', { recursive: true }); } catch { /* exists */ }

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL as string);
  await page.getByLabel('Password').fill(PASSWORD as string);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Lead Gen', exact: true }).click();
}

test('Performance Monitor renders + screenshot', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Performance Monitor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Performance Monitor' })).toBeVisible();
  // State-tolerant: the page rendered and the Manual-entry fallback is present
  // in every state (empty connect-CTA, empty list, or populated).
  await expect(page.getByRole('button', { name: /manual entry/i })).toBeVisible();
  // Let any auto-sync / metrics read settle, then capture.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'screenshots/performance-monitor.png', fullPage: true });
});

test('SMM Monitor renders + screenshot', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Social Media', exact: true }).click();
  await page.getByRole('button', { name: 'SMM Monitor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SMM Monitor' })).toBeVisible();
  await expect(page.getByRole('button', { name: /manual entry/i })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/smm-monitor.png', fullPage: true });
});

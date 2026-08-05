import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// CC-P5 Step 5 — Content Library rework + Dashboard calendar, against the live
// app (VITE_MOCK_AI, ZZ-INTERNAL-TEST which is seeded with demo smm_calendar
// rows by scripts/seed-cc-monitor-demo.ts). STATE-TOLERANT: assertions verify
// the reworked surfaces render and the source filter bar works, not a specific
// populated-vs-empty state. Same credential gate + graceful skip as
// history-journey.spec.ts / monitors.spec.ts.
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
}

test('Content Library: source filter bar + Calendar filter', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Social Media', exact: true }).click();
  await page.getByRole('button', { name: 'Content Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Content Library' })).toBeVisible();

  // The prominent source filter bar — present in every state.
  for (const label of ['All', 'Planner', 'Creatives', 'Calendar']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${label}`) }).first()).toBeVisible();
  }

  // Switching to Calendar should not error (seeded ZZ has calendar rows, but the
  // assertion stays state-tolerant — just that the view renders).
  await page.getByRole('button', { name: /^Calendar/ }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/content-library.png', fullPage: true });
});

test('Dashboard content calendar section renders', async ({ page }) => {
  await login(page);
  // The DashboardCalendar section sits on the Dashboard landing page.
  await expect(page.getByText('Content Calendar', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/dashboard-calendar.png', fullPage: true });
});

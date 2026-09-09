import { test, expect } from '@playwright/test';

// T-001 regression: a SECOND Quick Generate on the Strategy page used to render
// the FIRST generation's images.
//
// Root cause: SeniorDesignerResultPanel auto-generates once per mount, guarded
// by a ref plus a `[]`-dep effect (StrategyResult.tsx:1399/1428). A second
// submit reconciled into the same instance — the guard was already true, so the
// effect never re-fired and the old images stayed under the new copy.
// Strategy.tsx now clears `result` and bumps `submissionId`, which is the
// panel's `key`, forcing a fresh instance and a fresh ref.
//
// The assertion is on the image URL, which is the strongest available signal:
// under VITE_MOCK_AI the image BYTES are a fixed fixture, so identical pixels
// prove nothing — but every generation uploads to
// `generated-creatives/{org}/{sessionId}/...` with a fresh `sessionId`
// (StrategyResult.tsx:1460), so a changed src means a genuinely new generation
// and an unchanged src is exactly the bug.
//
// Same credential gate + graceful skip as history-journey.spec.ts.
const EMAIL = process.env.INTERNAL_TEST_USER_EMAIL;
const PASSWORD = process.env.INTERNAL_TEST_USER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'INTERNAL_TEST_USER_EMAIL/INTERNAL_TEST_USER_PASSWORD not set.');

// Generation is slow even mocked (real upload + DB insert per image).
const GEN_TIMEOUT = 90_000;

test('Strategy: a second Quick Generate renders a NEW image, not the first one', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL as string);
  await page.getByLabel('Password').fill(PASSWORD as string);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Lead Gen', exact: true }).click();
  await page.getByRole('button', { name: 'Strategy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Strategy' })).toBeVisible();

  // The disposable project seeded by e2e/seed-e2e.mjs — by name, so
  // cleanup-e2e.mjs can reach everything this test creates.
  await page.getByLabel('Project').selectOption({ label: 'ZZ-E2E Test Project' });

  const generate = page.getByRole('button', { name: /quick generate ad/i });
  // The gallery is the only place a generated image renders.
  const firstImage = page.locator('img[src*="generated-creatives"]').first();

  await generate.click();
  // The button's in-flight copy is also the UX assertion: disabled, and stating
  // a time expectation rather than leaving a spinner to be read as a hang.
  const busy = page.getByRole('button', { name: /generating… usually under a minute/i });
  await expect(busy).toBeDisabled();

  await expect(firstImage).toBeVisible({ timeout: GEN_TIMEOUT });
  const firstSrc = await firstImage.getAttribute('src');
  expect(firstSrc).toBeTruthy();

  // Second generate on the same strategy. Before the fix this resolved
  // instantly to the SAME src, because nothing re-ran.
  await expect(generate).toBeEnabled({ timeout: GEN_TIMEOUT });
  await generate.click();

  // The old image must be GONE while the new one generates — cleared, not
  // dimmed. This is the half of the bug a src comparison alone would miss: a
  // stale image left on screen is indistinguishable from a finished one.
  await expect(page.locator(`img[src="${firstSrc}"]`)).toHaveCount(0, { timeout: 20_000 });

  const secondImage = page.locator('img[src*="generated-creatives"]').first();
  await expect(secondImage).toBeVisible({ timeout: GEN_TIMEOUT });
  const secondSrc = await secondImage.getAttribute('src');

  expect(secondSrc).toBeTruthy();
  expect(secondSrc).not.toBe(firstSrc);
});

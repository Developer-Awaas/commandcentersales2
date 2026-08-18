// RB-PR STEP 2 — fresh-reviewer render check against the LIVE review build.
//
// Verifies that meta-review@awaas.world, with ZERO connected Meta assets
// (org_integrations is empty for the demo org), can reach every surface in its
// module grant without errors — and records what each one actually shows.
//
// Standalone on purpose (not an e2e/ spec): it targets cc.awaas.world rather
// than the local preview playwright.config.ts builds, and must never run in CI
// against a real account. Credentials come from env, never a literal:
//   REVIEW_EMAIL=... REVIEW_PASSWORD=... node scripts/rb-pr-render-check.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.REVIEW_URL || 'https://cc.awaas.world';
const EMAIL = process.env.REVIEW_EMAIL;
const PASSWORD = process.env.REVIEW_PASSWORD;
const OUT = process.env.SHOT_DIR || 'rb-pr-shots';
if (!EMAIL || !PASSWORD) { console.error('REVIEW_EMAIL / REVIEW_PASSWORD required'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

// [group, label] — group is the collapsible section the item lives under.
const SURFACES = [
  [null,            'Dashboard'],
  ['Lead Gen',      'Performance Monitor'],
  ['Lead Gen',      'Campaigns'],
  ['Social Media',  'SMM Monitor'],
  ['Social Media',  'SMM Planner'],
  ['Social Media',  'SMM Creatives'],
  ['Social Media',  'Content Calendar'],
  [null,            'Settings'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

// Collect every console error + failed request, attributed to the surface open
// at the time. "No errors" is the actual assertion here, so it must be captured
// continuously rather than sampled.
let current = 'login';
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push([current, `console: ${m.text().slice(0, 160)}`]); });
page.on('pageerror', (e) => problems.push([current, `pageerror: ${String(e).slice(0, 160)}`]));
page.on('requestfailed', (r) => problems.push([current, `netfail: ${r.url().slice(0, 100)} ${r.failure()?.errorText ?? ''}`]));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email').fill(EMAIL);
await page.getByLabel('Password').fill(PASSWORD);
await page.getByRole('button', { name: /sign in/i }).click();
await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/00-login-dashboard.png`, fullPage: true });
console.log('LOGIN: ok — dashboard reached as reviewer');

const results = [];
let i = 0;
for (const [group, label] of SURFACES) {
  current = label;
  i += 1;
  const slug = String(i).padStart(2, '0') + '-' + label.toLowerCase().replace(/\W+/g, '-');
  try {
    // The group header is a TOGGLE — clicking it unconditionally before every
    // item alternately collapses the section again, which reads as "item
    // missing from nav" when it is simply hidden. Only expand when the item
    // isn't already reachable.
    let item = page.getByRole('button', { name: label, exact: true });
    if (group && !(await item.count())) {
      const g = page.getByRole('button', { name: group, exact: true });
      if (await g.count()) await g.first().click().catch(() => {});
      await page.waitForTimeout(400);
      item = page.getByRole('button', { name: label, exact: true });
    }
    if (!(await item.count())) { results.push([label, 'NOT VISIBLE IN NAV', '-']); continue; }
    await item.first().click();
    await page.waitForTimeout(3000);

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    // Does the surface offer a connect path, and does it look broken?
    const connectCta = /connect|not connected|add your meta|link your|get started|no data|manual entry/i.test(body);
    const looksBroken = /something went wrong|failed to load|unexpected error|error:/i.test(body);
    await page.screenshot({ path: `${OUT}/${slug}.png`, fullPage: true });
    results.push([label, looksBroken ? 'ERROR TEXT ON PAGE' : 'rendered', connectCta ? 'connect/empty affordance present' : 'no connect affordance']);
  } catch (err) {
    results.push([label, 'THREW: ' + String(err).slice(0, 90), '-']);
  }
}

const pad = (v, n) => String(v).padEnd(n);
console.log("");
console.log(pad("SURFACE", 22) + pad("RENDER", 24) + "AFFORDANCE");
for (const [a, b, c] of results) console.log(pad(a, 22) + pad(b, 24) + c);

console.log('\nCONSOLE / NETWORK PROBLEMS: ' + (problems.length || 'none'));
for (const [where, what] of problems.slice(0, 25)) console.log(`  [${where}] ${what}`);

await browser.close();

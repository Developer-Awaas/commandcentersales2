/**
 * Authenticated Edge Function invoker for review-build verification runs.
 *
 * Exists so a verification never needs credentials typed into a command line
 * (and therefore into a session transcript). Both files it reads are ignored
 * by `*.local` in .gitignore:
 *
 *   .env.local         VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   (already present)
 *   .env.review.local  REVIEW_EMAIL, REVIEW_PASSWORD               (create once, by hand)
 *
 * Usage:  node scripts/rb-invoke.mjs <function-slug> ['<json body>']
 *   e.g.  node scripts/rb-invoke.mjs meta-sync-now
 *         node scripts/rb-invoke.mjs meta-publish '{"target":"facebook","dry_run":true}'
 *
 * Prints HTTP status and the raw response body. Nothing else — the caller is a
 * human or an agent reading evidence, not a program.
 */
import { readFileSync } from 'node:fs';

function envFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

const app = envFile('.env.local');
const rev = envFile('.env.review.local');

const URL_ = app.VITE_SUPABASE_URL;
const ANON = app.VITE_SUPABASE_ANON_KEY;
const EMAIL = rev.REVIEW_EMAIL ?? process.env.REVIEW_EMAIL;
const PASSWORD = rev.REVIEW_PASSWORD ?? process.env.REVIEW_PASSWORD;

const missing = Object.entries({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: ANON, REVIEW_EMAIL: EMAIL, REVIEW_PASSWORD: PASSWORD })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}\nCreate .env.review.local with REVIEW_EMAIL= and REVIEW_PASSWORD= (gitignored via *.local).`);
  process.exit(2);
}

const slug = process.argv[2];
if (!slug) { console.error('Usage: node scripts/rb-invoke.mjs <function-slug> [json-body]'); process.exit(2); }
const body = process.argv[3] ?? '{}';

const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const authBody = await auth.json();
if (!auth.ok || !authBody.access_token) {
  // Never print authBody wholesale — an auth error echoes back what was sent.
  console.error(`Sign-in failed: HTTP ${auth.status} ${authBody.error_code ?? authBody.error ?? ''}`);
  process.exit(1);
}

const res = await fetch(`${URL_}/functions/v1/${slug}`, {
  method: 'POST',
  headers: { apikey: ANON, authorization: `Bearer ${authBody.access_token}`, 'content-type': 'application/json' },
  body,
});
console.log(`HTTP ${res.status}`);
console.log(await res.text());

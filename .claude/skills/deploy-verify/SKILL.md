---
name: deploy-verify
description: Use when shipping or confirming a deploy in this repo — pushing, promoting, or claiming something is live on cc.awaas.world, TEST, or PROD. Trigger on "deploy", "promote", "is it live", "did it ship", or before marking any inventory item CLOSED.
---

# deploy-verify

Nothing is done until a stamp or a row proves it.

## Sequence

1. **Authorization.** Push only when the user said to. `main` is PR-only and
   branch-protected; `review-build` is local-commit-only unless told otherwise.
2. **CI run ID.** `gh run list` — record the number. Four required checks must
   be green (`build`, `client-unit-tests`, `edge-typecheck`, `edge-unit-tests`).
   `playwright-e2e` and `ws1-6-isolation` are advisory by design.
3. **Promote.** Confirmed unreliable, not just cautious default: review-build
   → `cc.awaas.world` auto-deployed clean once (2026-09-12) and then needed a
   manual Vercel-dashboard promote on 2026-09-18 and again on 2026-09-22,
   both times after CI was green and Vercel's own records already showed a
   completed deploy. Never assume either way — go straight to step 4. If the
   stamp doesn't match, ask Saswat to promote in the dashboard; the CLI stays
   unlinked and you never promote yourself.
4. **Stamp match.** Fetch the alias and compare `__COMMIT_SHA__` to the SHA you
   pushed. **Assert on content, never on HTTP status** — the SPA catch-all
   returns 200 for files that do not exist.
5. **Row evidence.** For anything with a database effect, paste the row: a
   `schema_migrations` tail, an `agent_interactions` ledger row, an
   `image_jobs` status. Edge functions on review-build deploy by hand
   (`supabase functions deploy --use-api`, `supabase db push`) to TEST
   `yelmuykbqdyeikgbmkoq` — there is no auto-deploy off `main`.
6. **Then** mark CLOSED.

## Refusals

No stamp, no CLOSED. No CI run ID, no promote request. `--no-verify` skips only
the local hook mirror — CI is the backstop and is not bypassable. Never flip
`META_PUBLISH_MODE`; never `supabase link` to PROD.

---
name: test-triage
description: Use when a tester reports a bug or a CI job goes red — turning a report or a failing spec into a tracked, classified item. Trigger on "tester says", "this is broken on cc.awaas.world", "the e2e is failing", "triage this", or any red check.
---

# test-triage

## Intake (a report without these is bounced)

- **Environment** — `cc.awaas.world` / TEST / PROD / local.
- **Build stamp** — the `__COMMIT_SHA__` the tester actually saw. A report
  against an unknown build cannot be reproduced or closed. Bounce it, ask for
  the stamp, do not guess from `git log`.
- Steps, expected, observed.

## Then

1. Assign `T-nnn`, next free number in `docs/closeout-inventory.md`.
2. Map to an inventory ID or open one. Check `docs/history/bugs.md` first —
   #1–#50 are already fixed.
3. Class + phase: **P0** data loss / security / R-A surface down · **P1** core
   flow broken, no workaround · **P2** degraded, workaround exists · **P3**
   cosmetic.

## Red CI

Name the run ID and whether the job is required or advisory. Ask *since when* —
a spec red since its first-ever run is a config question (wrong project, missing
migration), not a regression from the push it appeared on. Check what the job's
env targets first.

Vitest runs files sequentially (`fileParallelism: false`) — a flake here is a
real bug, not parallelism. A new `*.test.ts` must be in the `include:` list in
`vitest.config.ts` or it silently never runs. Never read `tsc` exit code
through a pipe — use `${PIPESTATUS[0]}`.

**Fix committed ≠ fix evidenced.** FIXED-UNVERIFIED until a live run proves it.

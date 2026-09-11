---
name: probe-prompt
description: Use when writing or running a read-only investigation prompt against this repo or a Supabase project — answering "which/where/is it live" questions without editing anything. Trigger on "probe", "investigate", "find out whether", "which project does X target", or any discovery step in a closeout phase.
---

# probe-prompt

A probe **reads**. It never edits, applies, deploys, or seeds.

## Rules

1. **Read-only.** No file writes, no migrations, no `functions deploy`, no
   secret writes. If the answer needs a write, stop and report that.
2. **Freeze list.** Never touch `meta-publish*`, `meta-token-connect`,
   `meta-oauth*`, `_shared/meta-publish.ts`, `_shared/meta-oauth.ts`,
   `_shared/graph-version.ts`, `SettingsPage` publishing, `MetaPostDialog`,
   Monitor sync. Never read or flip `META_PUBLISH_MODE`.
3. **Cite or don't claim.** Every finding carries `file:line`, a commit SHA, or
   pasted `\d` output. SQL you propose must quote the `\d` it was written
   against, or say "adapt to actual columns".
4. **Liveness is content, never status.** The SPA catch-all returns 200 for
   missing files — assert on the bytes (`__COMMIT_SHA__`, a row, a header),
   not on an HTTP code. A merged commit is not a deployed fact.
5. **"Fix committed" ≠ "fix evidenced."** Say FIXED-UNVERIFIED until a live
   run or a row proves it.
6. **Contradictions get flagged, never reconciled.** If the doc and the
   database disagree, report both and stop.

## Output

Hypothesis table — `Hypothesis | SUPPORTED / REFUTED / UNTESTED | Evidence
(file:line or pasted output)` — then a ≤150-word summary. UNTESTED is a
legitimate verdict; guessing is not.

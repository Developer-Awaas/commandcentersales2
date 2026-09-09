# Database and worktree access rules

Standing rules. Both exist because a convenient shortcut quietly widened blast radius.

## PROD reads go through a read-only role and psql — never `supabase link`

`supabase db query` takes no `--project-ref`, so the only way to read PROD through the CLI is to
relink the worktree. That is wrong for two reasons: it mutates shared local state
(`supabase/.temp/project-ref` and friends) that other worktrees and concurrent sessions read, so a
parallel session's "linked" query can silently hit the wrong database mid-flight; and it leaves the
worktree pointed at PROD, where the next `db push` or `functions deploy` is a production write
nobody intended.

Use a dedicated read-only role and connect directly instead:

    psql "$PROD_READONLY_URL" -c "select jobname, schedule, active from cron.job;"

The role is the actual control — a `SELECT`-only grant cannot be turned into a write by a mistyped
command, whereas "I only meant to read" is not enforced by anything. Keep the connection string out
of the repo (`.env.local`, gitignored) and never on a command line that reaches shell history.

If a relink is ever genuinely unavoidable, say so out loud, restore the original ref immediately,
and `git checkout -- supabase/.temp/` afterwards.

## Park uncommitted work by branch-carry, never `git stash`

The stash stack is shared across every worktree of this repo and every concurrent session. A bare
`git stash pop` takes whatever is on top, which may be another session's work, and the entry is gone
once popped. Uncommitted changes follow you across `git checkout -b` for free, so:

    git checkout -b park/<topic>
    git commit -m "park: <what and why>" -- <the specific paths>
    git checkout <original-branch>

Commit explicit paths, not `-a` — `-a` sweeps in unrelated dirt (machine-local CLI scratch state, for
one). If a stash is genuinely unavoidable, `git stash push -u -m "<unique-tag>"`, capture the SHA
from `git stash list --format='%H %gs'`, restore with `git stash apply <sha>`, and drop it by tag.

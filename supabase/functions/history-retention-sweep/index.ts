/**
 * history-retention-sweep — pg_cron weekly job, zero LLM cost.
 *
 * Backstop for tool_outputs' 30-row-per-(org_id, tool) retention cap.
 * The primary enforcement is saveToolOutput's own post-insert check
 * (src/lib/history-service.ts's enforceRetentionCap) — this sweep exists
 * only to catch rows that check missed (a direct delete elsewhere leaving
 * a stale count, a save that raced past the cap, etc). Same
 * storage-then-DB-row deletion ordering as the client-side version.
 *
 * Scheduled via a vault-backed migration, same pattern as
 * dhruv-anomaly-check / meta-insights-sync. Deployed with
 * --no-verify-jwt (called by pg_cron, no user JWT).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { denyUnlessCron } from '../_shared/cron-guard.ts'

const RETENTION_CAP_PER_TOOL = 30

interface ToolOutputRow {
  id: string
  org_id: string
  tool: string
  asset_refs: { bucket: string; path: string }[] | null
  created_at: string
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Cron-only. pg_cron sends the service-role bearer; nothing else may run this.
  const denied = denyUnlessCron(req)
  if (denied) return denied

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: rows, error } = await supabase
    .from('tool_outputs')
    .select('id, org_id, tool, asset_refs, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('history-retention-sweep: failed to list tool_outputs:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // Group by (org_id, tool); rows are already newest-first from the query
  // above, so anything past index RETENTION_CAP_PER_TOOL in each group is
  // overflow.
  const groups = new Map<string, ToolOutputRow[]>()
  for (const row of (rows ?? []) as ToolOutputRow[]) {
    const key = `${row.org_id}::${row.tool}`
    const arr = groups.get(key) ?? []
    arr.push(row)
    groups.set(key, arr)
  }

  let deleted = 0
  const errors: string[] = []

  for (const groupRows of groups.values()) {
    const overflow = groupRows.slice(RETENTION_CAP_PER_TOOL)
    for (const row of overflow) {
      try {
        const byBucket: Record<string, string[]> = {}
        for (const ref of row.asset_refs ?? []) {
          if (!ref.bucket || !ref.path) continue
          ;(byBucket[ref.bucket] ??= []).push(ref.path)
        }
        for (const [bucket, paths] of Object.entries(byBucket)) {
          const { error: rmErr } = await supabase.storage.from(bucket).remove(paths)
          // Non-fatal — an orphaned file costs storage space, not
          // correctness, matching history-service.ts's own behavior.
          if (rmErr) console.warn(`history-retention-sweep: storage cleanup failed for "${bucket}":`, rmErr.message)
        }
        const { error: delErr } = await supabase.from('tool_outputs').delete().eq('id', row.id)
        if (delErr) throw new Error(delErr.message)
        deleted++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${row.id}: ${msg}`)
      }
    }
  }

  return new Response(JSON.stringify({ groups_checked: groups.size, deleted, errors }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

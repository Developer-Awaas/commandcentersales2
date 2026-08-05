/**
 * audit-insert-columns.ts — static insert/upsert payload-column audit.
 *
 * Motivated by bug #47 (CLAUDE.md): both Dhruv cron functions inserted into a
 * non-existent `body` column (the column is `message`). Supabase-js
 * `.insert<T>()` / `.upsert<T>()` infer their argument as a GENERIC type
 * parameter, which suppresses TypeScript's excess-property check — so a wrong
 * key compiles cleanly, passes `deno check`/`tsc`, and only fails at runtime
 * (PostgREST returns `{ error }`, the call never throws). `deno check` cannot
 * catch this class of bug; this script can.
 *
 * What it does:
 *   1. AST-scans src/**\/*.{ts,tsx} + supabase/functions/**\/*.ts (TypeScript
 *      compiler API — robust to multiline / nested / array payloads) for every
 *      `.from('<table>')....insert({...})` / `.upsert({...})` chain, extracting
 *      the target table and the literal TOP-LEVEL payload keys.
 *   2. Reads the real column set per table from information_schema.columns on
 *      PROD (read-only). Source, in priority order:
 *        a. COLUMNS_JSON=<path> — a pre-fetched JSON file (CI-portable; the file
 *           is `[{ "table_name": "...", "column_name": "..." }, ...]`).
 *        b. otherwise shells `supabase db query --linked` (uses the linked
 *           project's own auth — no raw credentials in this script).
 *   3. Diffs payload keys against columns. A key that is NOT a real column is a
 *      violation (the bug-#47 class). Missing columns are NOT flagged (partial
 *      inserts are normal). Dynamic payloads (a variable, a spread, a computed
 *      key) and unresolved / dynamic table names are reported separately, never
 *      counted as violations — they can't be checked statically.
 *
 * Exit code: 1 if any violation, else 0 — so it can gate CI later if it stays
 * cheap (the AST scan is; the DB read is one query).
 *
 * Run:
 *   deno run --allow-read --allow-run --allow-env scripts/audit-insert-columns.ts
 *   # or, CI-portable (no supabase CLI needed):
 *   COLUMNS_JSON=cols.json deno run --allow-read --allow-env scripts/audit-insert-columns.ts
 */

import ts from 'npm:typescript@5.5.3'
import { walk } from 'jsr:@std/fs@1/walk'
import { relative, fromFileUrl } from 'jsr:@std/path@1'

const REPO_ROOT = fromFileUrl(new URL('..', import.meta.url))
const SCAN_DIRS = ['src', 'supabase/functions']
// Test files mock the Supabase client — their insert payloads are fixtures, not
// real writes, so a mismatch there is harmless noise. Skip them.
const SKIP_RE = /\.(test|spec)\.(ts|tsx)$|_test\.ts$/

type Payload =
  | { kind: 'keys'; keys: string[]; hasSpread: boolean; hasComputed: boolean }
  | { kind: 'dynamic'; reason: string }

interface Site {
  file: string
  line: number
  method: 'insert' | 'upsert'
  table: string | null // null = no from() found, '<dynamic>' = from(non-literal)
  payload: Payload
}

// ---- AST extraction -------------------------------------------------------

function unwrap(node: ts.Expression): ts.Expression {
  let n: ts.Expression = node
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAwaitExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isAsExpression(n)
  ) {
    n = n.expression
  }
  return n
}

/** Walk the leftmost call/property spine to find the nearest `.from('literal')`. */
function findTable(receiver: ts.Expression): string | null {
  let cur: ts.Node | undefined = receiver
  while (cur) {
    if (ts.isCallExpression(cur)) {
      const callee = cur.expression
      if (ts.isPropertyAccessExpression(callee)) {
        if (callee.name.text === 'from') {
          const a = cur.arguments[0]
          return a && ts.isStringLiteralLike(a) ? a.text : '<dynamic>'
        }
        cur = callee.expression // receiver of this method call
        continue
      }
      cur = cur.expression
      continue
    }
    if (ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression
      continue
    }
    if (
      ts.isParenthesizedExpression(cur) ||
      ts.isAwaitExpression(cur) ||
      ts.isNonNullExpression(cur)
    ) {
      cur = cur.expression
      continue
    }
    break
  }
  return null
}

function keysFromObject(obj: ts.ObjectLiteralExpression): {
  keys: string[]
  hasSpread: boolean
  hasComputed: boolean
} {
  const keys: string[] = []
  let hasSpread = false
  let hasComputed = false
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      hasSpread = true
      continue
    }
    const name = prop.name
    if (!name) continue
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
      keys.push(name.text)
    } else if (ts.isComputedPropertyName(name)) {
      hasComputed = true
    }
  }
  return { keys, hasSpread, hasComputed }
}

function extractPayload(arg: ts.Expression | undefined): Payload {
  if (!arg) return { kind: 'dynamic', reason: 'no-argument' }
  const a = unwrap(arg)
  if (ts.isObjectLiteralExpression(a)) {
    const { keys, hasSpread, hasComputed } = keysFromObject(a)
    return { kind: 'keys', keys, hasSpread, hasComputed }
  }
  if (ts.isArrayLiteralExpression(a)) {
    const set = new Set<string>()
    let hasSpread = false
    let hasComputed = false
    let sawObject = false
    for (const el of a.elements) {
      const e = unwrap(el)
      if (ts.isObjectLiteralExpression(e)) {
        sawObject = true
        const r = keysFromObject(e)
        r.keys.forEach((k) => set.add(k))
        hasSpread ||= r.hasSpread
        hasComputed ||= r.hasComputed
      } else if (ts.isSpreadElement(e)) {
        hasSpread = true
      }
    }
    if (!sawObject) return { kind: 'dynamic', reason: 'array-non-literal' }
    return { kind: 'keys', keys: [...set], hasSpread, hasComputed }
  }
  return { kind: 'dynamic', reason: a.kind === ts.SyntaxKind.Identifier ? 'variable' : 'non-literal' }
}

function scanFile(absPath: string, source: string): Site[] {
  const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true)
  const sites: Site[] = []
  const rel = relative(REPO_ROOT, absPath).replaceAll('\\', '/')
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      if (method === 'insert' || method === 'upsert') {
        const table = findTable(node.expression.expression)
        // Only record chains that actually originate from a .from(...) — that's
        // what makes it a Supabase table write and not some unrelated .insert().
        if (table !== null) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          sites.push({
            file: rel,
            line: line + 1,
            method,
            table,
            payload: extractPayload(node.arguments[0]),
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return sites
}

// ---- Column source --------------------------------------------------------

async function loadColumns(): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>()
  let rows: { table_name: string; column_name: string }[]

  const jsonPath = Deno.env.get('COLUMNS_JSON')
  if (jsonPath) {
    rows = JSON.parse(await Deno.readTextFile(jsonPath))
  } else {
    rows = await queryColumnsViaCli()
  }
  for (const { table_name, column_name } of rows) {
    if (!map.has(table_name)) map.set(table_name, new Set())
    map.get(table_name)!.add(column_name)
  }
  return map
}

async function queryColumnsViaCli(): Promise<{ table_name: string; column_name: string }[]> {
  const sql =
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, column_name;"
  const tmp = await Deno.makeTempFile({ suffix: '.sql' })
  await Deno.writeTextFile(tmp, sql)
  try {
    const cmd = new Deno.Command('supabase', {
      args: ['db', 'query', '--linked', '-f', tmp],
      stdout: 'piped',
      stderr: 'piped',
    })
    const { code, stdout, stderr } = await cmd.output()
    const out = new TextDecoder().decode(stdout)
    const err = new TextDecoder().decode(stderr)
    if (code !== 0) {
      throw new Error(`supabase db query exited ${code}: ${err || out}`)
    }
    const m = out.match(/\{[\s\S]*\}/)
    if (!m) throw new Error(`could not parse supabase db query output:\n${out}`)
    const parsed = JSON.parse(m[0]) as { rows?: { table_name: string; column_name: string }[] }
    if (!parsed.rows) throw new Error('supabase db query returned no .rows')
    return parsed.rows
  } finally {
    await Deno.remove(tmp).catch(() => {})
  }
}

// ---- Main -----------------------------------------------------------------

async function main() {
  const sites: Site[] = []
  for (const dir of SCAN_DIRS) {
    const root = `${REPO_ROOT}${dir}`
    try {
      for await (const entry of walk(root, { exts: ['.ts', '.tsx'], includeDirs: false })) {
        if (SKIP_RE.test(entry.path)) continue
        const src = await Deno.readTextFile(entry.path)
        sites.push(...scanFile(entry.path, src))
      }
    } catch (e) {
      console.error(`skip ${dir}: ${(e as Error).message}`)
    }
  }

  const columns = await loadColumns()

  const violations: { site: Site; badKeys: string[] }[] = []
  const unknownTables: Site[] = []
  const dynamic: Site[] = []
  let cleanCount = 0

  for (const site of sites) {
    if (site.table === '<dynamic>') {
      dynamic.push(site)
      continue
    }
    if (site.payload.kind === 'dynamic') {
      dynamic.push(site)
      continue
    }
    const cols = columns.get(site.table!)
    if (!cols) {
      unknownTables.push(site)
      continue
    }
    const bad = site.payload.keys.filter((k) => !cols.has(k))
    if (bad.length) violations.push({ site, badKeys: bad })
    else cleanCount++
  }

  // ---- Report ----
  const b = (s: string) => s
  console.log('\n=== insert/upsert payload-column audit ===')
  console.log(
    `scanned ${sites.length} insert/upsert sites — ${cleanCount} clean, ` +
      `${violations.length} violation(s), ${unknownTables.length} unknown-table, ${dynamic.length} dynamic (unauditable)\n`,
  )

  if (violations.length) {
    console.log('VIOLATIONS — payload key(s) that are NOT columns of the target table:')
    console.log('  ' + 'file:line'.padEnd(60) + 'method  table                      bad keys')
    for (const { site, badKeys } of violations) {
      console.log(
        '  ' +
          `${site.file}:${site.line}`.padEnd(60) +
          `${site.method.padEnd(7)} ${(site.table ?? '').padEnd(26)} ${badKeys.join(', ')}`,
      )
    }
    console.log('')
  }

  if (unknownTables.length) {
    console.log('UNKNOWN TABLES (not in public schema — verify name / non-public schema):')
    for (const s of unknownTables) {
      console.log(`  ${b(`${s.file}:${s.line}`)}  ${s.method}  ${s.table}`)
    }
    console.log('')
  }

  if (Deno.env.get('AUDIT_VERBOSE')) {
    console.log('DYNAMIC / unauditable (variable, spread, computed key, or from(non-literal)):')
    for (const s of dynamic) {
      const why = s.table === '<dynamic>' ? 'from(dynamic)' : (s.payload as { reason?: string }).reason ?? 'spread/computed'
      console.log(`  ${s.file}:${s.line}  ${s.method}  ${s.table ?? '?'}  (${why})`)
    }
    console.log('')
  } else if (dynamic.length) {
    console.log(`(${dynamic.length} dynamic/unauditable sites — set AUDIT_VERBOSE=1 to list)\n`)
  }

  if (violations.length) {
    console.log('RESULT: FAIL — fix the wrong column name(s) above (bug-#47 class).')
    Deno.exit(1)
  }
  console.log('RESULT: PASS — every literal insert/upsert key maps to a real column.')
}

await main()

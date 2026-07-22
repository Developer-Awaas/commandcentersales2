// WS1.6 isolation harness for Command Center — cross-tenant RLS probes,
// modeled on awaas-suite's Gate P (same probe shapes via lib.ts) but with
// Command-Center-specific probes standing in for Gate P's RBAC-RPC probes,
// which have no equivalent here (no assign_role/provision_org RPCs).
//
// Every probe asserts DENIAL — a probe that unexpectedly succeeds means
// real cross-tenant leakage. No service-role key in this file: every
// request uses only the anon key + a JWT minted at runtime via
// password-grant sign-in for one of the two non-admin probe users seeded
// by seed-isolation-probes.sh.
//
// Primary target: agent_memory_chunks (the table WS1.6 was opened against).
// Probes 5-6 additionally cover profiles, since agent_memory_chunks's own
// isolation is meaningless if profiles.org_id itself can be read/tampered
// cross-org or self-escalated.
//
// Probes 1-6 all authenticate via user JWT through PostgREST — they prove
// RLS holds, but say nothing about the service-role write path in
// handleApprove/projectApprovedCampaign (aarav-orchestrate), which bypasses
// RLS by design. Probes 7-8 close that gap (§5.1 Deviation Register item):
//   7 — service-role tenancy check: handleApprove re-derives org_id from the
//       caller's verified session (never the request body) and manually
//       filters agent_turns by it even on the service-role client. Probe 7
//       calls the live edge function as org A against org B's turn_id and
//       asserts both the HTTP-level rejection and that org B's turn is
//       provably untouched afterward.
//   8 — match_memory_chunks RPC: SECURITY INVOKER (confirmed by grep below,
//       not just trusted from the migration comment), so RLS applies inside
//       the function body. Probe 8 seeds an embedded org B chunk (rows with
//       a NULL embedding are silently skipped by the RPC, which would make
//       the probe pass for the wrong reason — see seed script) and asserts
//       org A's call never returns it, regardless of query.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  callEdgeFunction,
  crossOrgDeleteDenied,
  crossOrgReadDenied,
  crossOrgUpdateDenied,
  crossOrgWriteDenied,
  jwtSub,
  mintPasswordJwt,
  type ProbeContext,
  restGet,
  restPatch,
  restPost,
} from "./lib.ts";

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const REST_BASE = mustEnv("REST_BASE");
const ANON_KEY = mustEnv("ANON_KEY");
const PROBE_ORG_A_EMAIL = mustEnv("PROBE_ORG_A_EMAIL");
const PROBE_ORG_A_PASSWORD = mustEnv("PROBE_ORG_A_PASSWORD");
const PROBE_ORG_B_EMAIL = mustEnv("PROBE_ORG_B_EMAIL");
const PROBE_ORG_B_PASSWORD = mustEnv("PROBE_ORG_B_PASSWORD");

const ctx: ProbeContext = { restBase: REST_BASE, anonKey: ANON_KEY };

const jwtA = await mintPasswordJwt(ctx, PROBE_ORG_A_EMAIL, PROBE_ORG_A_PASSWORD);
const jwtB = await mintPasswordJwt(ctx, PROBE_ORG_B_EMAIL, PROBE_ORG_B_PASSWORD);
const selfIdA = jwtSub(jwtA);

// No current_org_id() RPC in Command Center — org id is read off the
// caller's own profiles row instead. Allowed by "Org members can view org
// profiles" (org_id = get_current_user_org_id()) because that resolves to
// the same value as your own row's org_id, trivially true for id=self.
async function ownOrgId(jwt: string, selfId: string): Promise<string> {
  const result = await restGet(ctx, `profiles?id=eq.${selfId}&select=org_id`, jwt);
  assertEquals(result.status, 200, `setup: failed to read own org_id: ${JSON.stringify(result.body)}`);
  const rows = result.body as { org_id: string }[];
  assert(rows.length > 0 && rows[0].org_id, `setup: probe user ${selfId} has no org_id — run seed-isolation-probes.sh first`);
  return rows[0].org_id;
}

const selfIdB = jwtSub(jwtB);
const orgAId = await ownOrgId(jwtA, selfIdA);
const orgBId = await ownOrgId(jwtB, selfIdB);

Deno.test("probe 1: org A JWT cannot read org B's agent_memory_chunks rows", async () => {
  const ownView = await restGet(ctx, `agent_memory_chunks?org_id=eq.${orgBId}&select=id`, jwtB);
  assertEquals(ownView.status, 200, `setup: org B could not read its own agent_memory_chunks: ${JSON.stringify(ownView.body)}`);
  const ownRows = ownView.body as unknown[];
  assert(ownRows.length > 0, "setup: org B has no seeded agent_memory_chunks row — run seed-isolation-probes.sh first");

  await crossOrgReadDenied(ctx, {
    table: "agent_memory_chunks",
    orgColumn: "org_id",
    otherOrgId: orgBId,
    probingJwt: jwtA,
    probeLabel: "PROBE 1",
    ownRowsCount: ownRows.length,
  });
});

Deno.test("probe 2: org A JWT cannot insert an agent_memory_chunks row under org B's org_id", async () => {
  await crossOrgWriteDenied(ctx, {
    table: "agent_memory_chunks",
    orgColumn: "org_id",
    targetOrgId: orgBId,
    extraFields: { scope: "domain", content: `probe2-leak-attempt-${Date.now()}` },
    probingJwt: jwtA,
    probeLabel: "PROBE 2",
  });
});

Deno.test("probe 3: org A JWT cannot update org B's agent_memory_chunks row", async () => {
  await crossOrgUpdateDenied(ctx, {
    table: "agent_memory_chunks",
    orgColumn: "org_id",
    targetOrgId: orgBId,
    rowFilter: `org_id=eq.${orgBId}`,
    patch: { salience: 0.01 },
    probingJwt: jwtA,
    probeLabel: "PROBE 3",
  });
});

Deno.test("probe 4: org A JWT cannot delete org B's agent_memory_chunks row", async () => {
  await crossOrgDeleteDenied(ctx, {
    table: "agent_memory_chunks",
    rowFilter: `org_id=eq.${orgBId}`,
    probingJwt: jwtA,
    probeLabel: "PROBE 4",
  });
});

Deno.test("probe 5: org A JWT cannot read org B's profiles row", async () => {
  await crossOrgReadDenied(ctx, {
    table: "profiles",
    orgColumn: "org_id",
    otherOrgId: orgBId,
    probingJwt: jwtA,
    probeLabel: "PROBE 5",
  });
});

// Command-Center-specific stand-in for Gate P's RBAC probes (no
// assign_role/provision_org RPCs exist here — this repo's equivalent
// privilege-escalation surface is prevent_self_privilege_escalation(),
// 20260610150000_fix_rls_org_scope.sql).
Deno.test("probe 6: org A probe cannot self-escalate role or org_id via UPDATE", async () => {
  const roleAttempt = await restPatch(ctx, `profiles?id=eq.${selfIdA}`, jwtA, { role: "admin" });
  assert(
    roleAttempt.status !== 200 || (roleAttempt.body as unknown[]).length === 0,
    `PROBE 6a LEAK: org A probe self-escalated role to 'admin': ${JSON.stringify(roleAttempt.body)}`,
  );
  if (roleAttempt.status === 200) {
    console.log("PROBE 6a: blocked with 0 rows affected (trigger raised inside the UPDATE, PostgREST reports 200/empty)");
  } else {
    console.log(`PROBE 6a: blocked at HTTP ${roleAttempt.status} (prevent_self_privilege_escalation trigger raised an exception)`);
  }

  const orgAttempt = await restPatch(ctx, `profiles?id=eq.${selfIdA}`, jwtA, { org_id: orgBId });
  assert(
    orgAttempt.status !== 200 || (orgAttempt.body as unknown[]).length === 0,
    `PROBE 6b LEAK: org A probe self-reassigned org_id to org B: ${JSON.stringify(orgAttempt.body)}`,
  );

  // Confirm neither attempt actually changed anything (belt-and-suspenders —
  // don't just trust the response, re-read the row with a fresh request).
  const confirm = await restGet(ctx, `profiles?id=eq.${selfIdA}&select=role,org_id`, jwtA);
  assertEquals(confirm.status, 200, `setup: re-read own profile failed: ${JSON.stringify(confirm.body)}`);
  const row = (confirm.body as { role: string; org_id: string }[])[0];
  assertEquals(row.role, "member", `PROBE 6a LEAK confirmed on re-read: role is now '${row.role}'`);
  assertEquals(row.org_id, orgAId, `PROBE 6b LEAK confirmed on re-read: org_id is now '${row.org_id}'`);
});

// ─── Probes 7-8: service-role write path (§5.1 Deviation Register) ──────────

const SEED_TURN_SESSION_ID = "isolation-probe-session";
// Must match seed-isolation-probes.sh's SEED_CHUNK_CONTENT exactly.
const SEED_CHUNK_CONTENT = "isolation-probe seed chunk (org B) — do not delete manually, see seed-isolation-probes.sh";

Deno.test("probe 7: org A JWT cannot approve org B's turn via aarav-orchestrate (service-role path)", async () => {
  // Look up org B's seeded turn via org B's own JWT (org-scoped SELECT policy)
  // rather than hardcoding an id — keeps the probe correct across reseeds.
  const turnLookup = await restGet(ctx, `agent_turns?session_id=eq.${SEED_TURN_SESSION_ID}&org_id=eq.${orgBId}&select=id,approved_at,status`, jwtB);
  assertEquals(turnLookup.status, 200, `setup: org B could not read its own seeded turn: ${JSON.stringify(turnLookup.body)}`);
  const turnRows = turnLookup.body as { id: string; approved_at: string | null; status: string }[];
  assert(turnRows.length > 0, "setup: org B has no seeded agent_turns row — run seed-isolation-probes.sh first (needs the agent_turns seeding step)");
  const targetTurnId = turnRows[0].id;
  assertEquals(turnRows[0].approved_at, null, "setup: seeded turn is already approved — reseed with a fresh turn before running this probe");

  // The actual attack: org A's real, valid JWT calling the live edge
  // function with org B's turn_id. There is no org_id/project_id field to
  // spoof in the request body at all (AgentRequest has none for action
  // 'approve') — aarav-orchestrate/index.ts's own header comment states
  // org_id is "NEVER trusted from the request body" and is instead derived
  // from auth.getUser() + a profiles lookup. This probe verifies that
  // derivation actually gates the service-role agent_turns query
  // (handleApprove, aarav-orchestrate/index.ts ~line 758-770), not just that
  // the client can't pass an org_id parameter that would have been ignored anyway.
  const approveAttempt = await callEdgeFunction(ctx, "aarav-orchestrate", jwtA, {
    action: "approve",
    turn_id: targetTurnId,
  });
  assertEquals(
    approveAttempt.status,
    404,
    `PROBE 7 LEAK: org A JWT was able to invoke approve on org B's turn (expected 404 'Turn not found or access denied'): ${JSON.stringify(approveAttempt.body)}`,
  );
  assertStringIncludes(
    JSON.stringify(approveAttempt.body),
    "not found",
    `PROBE 7: got 404 but unexpected body shape (checking this isn't a coincidental 404 from a different failure): ${JSON.stringify(approveAttempt.body)}`,
  );

  // Belt-and-suspenders: don't just trust the HTTP response — re-fetch the
  // turn via org B's own JWT and confirm nothing actually changed. A bug
  // that returned 404 while still writing (e.g. an exception after a
  // partial write) would pass the assertion above but fail this one.
  const reread = await restGet(ctx, `agent_turns?id=eq.${targetTurnId}&select=approved_at,status`, jwtB);
  assertEquals(reread.status, 200, `setup: org B could not re-read its own turn: ${JSON.stringify(reread.body)}`);
  const rerow = (reread.body as { approved_at: string | null; status: string }[])[0];
  assertEquals(rerow.approved_at, null, `PROBE 7 LEAK confirmed on re-read: org B's turn now has approved_at='${rerow.approved_at}'`);
  assertEquals(rerow.status, "awaiting_user", `PROBE 7 LEAK confirmed on re-read: org B's turn status changed to '${rerow.status}'`);

  // Also confirm no agent_memory row was created referencing this turn —
  // the downstream write handleApprove would have made had it not rejected.
  const memCheck = await restGet(ctx, `agent_memory?turn_id=eq.${targetTurnId}&select=id`, jwtB);
  assertEquals(memCheck.status, 200, `setup: org B could not query its own agent_memory: ${JSON.stringify(memCheck.body)}`);
  assertEquals((memCheck.body as unknown[]).length, 0, `PROBE 7 LEAK: an agent_memory row was created for org B's turn despite the approve attempt being denied`);
});

Deno.test("probe 8: match_memory_chunks RPC never returns org B content to org A, regardless of query", async () => {
  // Query with org B's exact seed content as query_text — the strongest
  // possible lexical match (ts_rank component of the hybrid score), so if
  // RLS/org filtering inside the SECURITY INVOKER function ever regressed,
  // this is the query most likely to surface the leak.
  const queryEmbedding = Array.from({ length: 1024 }, () => 0.01);
  const result = await restPost(ctx, "rpc/match_memory_chunks", jwtA, {
    query_embedding: queryEmbedding,
    query_text: SEED_CHUNK_CONTENT,
    match_count: 50,
  });
  assertEquals(result.status, 200, `unexpected status calling match_memory_chunks: ${JSON.stringify(result.body)}`);
  const rows = result.body as { id: string; content: string }[];
  const leaked = rows.filter((r) => r.content === SEED_CHUNK_CONTENT);
  assertEquals(
    leaked.length,
    0,
    `PROBE 8 LEAK: match_memory_chunks returned org B's seed chunk to an org A caller: ${JSON.stringify(leaked)}`,
  );
});

Deno.test("probe 8b: match_memory_chunks is SECURITY INVOKER in every migration that defines it (static check)", async () => {
  // Genuinely static and offline — no network call, no trusting a code
  // comment. Reads every migration file directly (whatever's checked out
  // in this run, so it tracks the real repo state, not a cached belief)
  // and inspects every CREATE [OR REPLACE] FUNCTION match_memory_chunks(...)
  // block. A later migration silently redefining this function as
  // SECURITY DEFINER — which would make it run as the function owner and
  // bypass RLS entirely, the exact failure mode this whole probe exists to
  // catch — fails this test even if no current migration does that today.
  const migrationsDir = new URL("../../migrations/", import.meta.url);
  const defs: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, migrationsDir));
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+match_memory_chunks\s*\([\s\S]*?\$\$;/gi;
    for (const match of text.matchAll(re)) defs.push(match[0]);
  }
  assert(defs.length > 0, "setup: no match_memory_chunks function definition found in supabase/migrations/*.sql — did the migration get renamed/moved?");
  for (const def of defs) {
    assert(!/SECURITY\s+DEFINER/i.test(def), `PROBE 8b LEAK: found a match_memory_chunks definition using SECURITY DEFINER (bypasses RLS):\n${def}`);
    assert(/SECURITY\s+INVOKER/i.test(def), `PROBE 8b: a match_memory_chunks definition specifies neither SECURITY INVOKER nor DEFINER (Postgres default is INVOKER, but this should be explicit):\n${def}`);
  }
});

// Probes 9-10: same-org role gating on org_integrations (migration
// 20260722100000). Unlike probes 1-8, this is NOT a cross-org check — org A's
// probe user (role='member' by default, per profiles.role's schema default;
// the seed script never overrides it) must be denied read/write on ITS OWN
// org's org_integrations row. Found live via review-build's reviewer-scoping
// verification: any member could read and overwrite their org's Meta API
// access token before this migration. Regression-proofed here so this class
// of gap is caught by CI permanently, not by a reviewer happening to check.

Deno.test("probe 9: org A member JWT cannot read org A's own org_integrations row", async () => {
  // No "allowed" JWT to sanity-check the precondition against here (unlike
  // probe 1's own-org read-before-cross-org-denial check) — there's no
  // admin-role probe user seeded. The precondition instead lives in
  // seed-isolation-probes.sh, which `fail`s outright if the seed insert
  // doesn't succeed, so a missing row would show up as a seed failure, not
  // a silently-passing probe here.
  const result = await restGet(ctx, `org_integrations?org_id=eq.${orgAId}&select=*`, jwtA);
  assertEquals(result.status, 200, `PROBE 9: unexpected status reading org_integrations: ${JSON.stringify(result.body)}`);
  const rows = result.body as unknown[];
  assertEquals(
    rows.length,
    0,
    `PROBE 9 LEAK: a member-role JWT read its own org's org_integrations row (org_id=${orgAId}) — admin gating is not effective`,
  );
});

Deno.test("probe 10: org A member JWT cannot write org A's own org_integrations row", async () => {
  const result = await restPost(ctx, "org_integrations", jwtA, {
    org_id: orgAId,
    provider: "google_ads",
    meta_access_token: "probe-10-write-attempt-should-be-denied",
  });
  if (result.status === 201) {
    const rows = result.body as unknown[];
    assertEquals(
      rows.length,
      0,
      `PROBE 10 LEAK: a member-role JWT inserted an org_integrations row for its own org (org_id=${orgAId}) — admin gating is not effective`,
    );
  } else {
    assert(
      result.status === 401 || result.status === 403,
      `PROBE 10: unexpected non-201 status ${result.status}: ${JSON.stringify(result.body)}`,
    );
  }
});

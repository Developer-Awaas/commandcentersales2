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

import { assert, assertEquals } from "jsr:@std/assert";
import {
  crossOrgDeleteDenied,
  crossOrgReadDenied,
  crossOrgUpdateDenied,
  crossOrgWriteDenied,
  jwtSub,
  mintPasswordJwt,
  type ProbeContext,
  restGet,
  restPatch,
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

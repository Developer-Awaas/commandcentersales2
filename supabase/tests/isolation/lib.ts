// Shared REST/JWT plumbing + generic cross-org probes for the Command
// Center isolation test suite (WS1.6). Same pattern as awaas-suite's
// supabase/tests/isolation/lib.ts (crossOrgReadDenied/crossOrgWriteDenied
// signatures are intentionally identical) but a separate implementation —
// these are two different repos/Supabase projects with no shared package,
// so "generalize" means "same reusable shape," not "same imported module."
//
// Command Center uses the default `public` PostgREST schema (no
// Accept-Profile/Content-Profile headers needed, unlike awaas-suite's
// praveshika schema).

import { assert, assertEquals } from "jsr:@std/assert";

export interface ProbeContext {
  restBase: string;
  anonKey: string;
}

export interface RestResult {
  status: number;
  body: unknown;
}

export async function mintPasswordJwt(ctx: ProbeContext, email: string, password: string): Promise<string> {
  const res = await fetch(`${ctx.restBase}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ctx.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (res.status !== 200) {
    throw new Error(`password-grant sign-in for ${email} expected HTTP 200, got ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token as string;
}

export function jwtSub(jwt: string): string {
  const payload = jwt.split(".")[1];
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  const json = atob(padded);
  return JSON.parse(json).sub as string;
}

export async function restGet(ctx: ProbeContext, path: string, jwt: string): Promise<RestResult> {
  const res = await fetch(`${ctx.restBase}/rest/v1/${path}`, {
    method: "GET",
    headers: { apikey: ctx.anonKey, Authorization: `Bearer ${jwt}` },
  });
  return { status: res.status, body: await res.json() };
}

export async function restPost(ctx: ProbeContext, path: string, jwt: string, body: Record<string, unknown>): Promise<RestResult> {
  const res = await fetch(`${ctx.restBase}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: ctx.anonKey,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Calls a deployed Edge Function (not PostgREST) — e.g. aarav-orchestrate. */
export async function callEdgeFunction(ctx: ProbeContext, name: string, jwt: string, body: Record<string, unknown>): Promise<RestResult> {
  const res = await fetch(`${ctx.restBase}/functions/v1/${name}`, {
    method: "POST",
    headers: { apikey: ctx.anonKey, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

export async function restPatch(ctx: ProbeContext, path: string, jwt: string, patch: Record<string, unknown>): Promise<RestResult> {
  const res = await fetch(`${ctx.restBase}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: ctx.anonKey,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  return { status: res.status, body: await res.json() };
}

export async function restDelete(ctx: ProbeContext, path: string, jwt: string): Promise<RestResult> {
  const res = await fetch(`${ctx.restBase}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { apikey: ctx.anonKey, Authorization: `Bearer ${jwt}`, Prefer: "return=representation" },
  });
  return { status: res.status, body: await res.json() };
}

/** Cross-org READ probe: asserts a JWT scoped to one org cannot read a row scoped to another org. */
export async function crossOrgReadDenied(
  ctx: ProbeContext,
  opts: { table: string; orgColumn: string; otherOrgId: string; probingJwt: string; probeLabel: string; ownRowsCount?: number },
): Promise<void> {
  if (opts.ownRowsCount !== undefined) {
    assert(opts.ownRowsCount > 0, `setup: ${opts.probeLabel} precondition failed — target org has no seeded ${opts.table} row`);
  }
  const result = await restGet(ctx, `${opts.table}?${opts.orgColumn}=eq.${opts.otherOrgId}&select=*`, opts.probingJwt);
  assertEquals(result.status, 200, `${opts.probeLabel}: unexpected status reading ${opts.table}: ${JSON.stringify(result.body)}`);
  const rows = result.body as unknown[];
  assertEquals(rows.length, 0, `${opts.probeLabel} LEAK: cross-org JWT read a ${opts.table} row (${opts.orgColumn}=${opts.otherOrgId})`);
}

/** Cross-org WRITE probe: asserts a JWT scoped to one org cannot insert a row spoofing another org's id. */
export async function crossOrgWriteDenied(
  ctx: ProbeContext,
  opts: { table: string; orgColumn: string; targetOrgId: string; extraFields: Record<string, unknown>; probingJwt: string; probeLabel: string },
): Promise<void> {
  const result = await restPost(ctx, opts.table, opts.probingJwt, { [opts.orgColumn]: opts.targetOrgId, ...opts.extraFields });
  if (result.status === 201) {
    const rows = result.body as unknown[];
    assertEquals(rows.length, 0, `${opts.probeLabel} LEAK: cross-org JWT inserted a ${opts.table} row under ${opts.orgColumn}=${opts.targetOrgId}`);
  } else {
    assert(result.status === 401 || result.status === 403, `${opts.probeLabel}: unexpected non-201 status ${result.status}: ${JSON.stringify(result.body)}`);
  }
}

/** Cross-org UPDATE probe: asserts a JWT scoped to one org cannot modify a row scoped to another org. */
export async function crossOrgUpdateDenied(
  ctx: ProbeContext,
  opts: { table: string; orgColumn: string; targetOrgId: string; rowFilter: string; patch: Record<string, unknown>; probingJwt: string; probeLabel: string },
): Promise<void> {
  const result = await restPatch(ctx, `${opts.table}?${opts.rowFilter}`, opts.probingJwt, opts.patch);
  if (result.status === 200) {
    const rows = result.body as unknown[];
    assertEquals(rows.length, 0, `${opts.probeLabel} LEAK: cross-org JWT updated a ${opts.table} row scoped to another org`);
  } else {
    assert(result.status === 401 || result.status === 403, `${opts.probeLabel}: unexpected non-200 status ${result.status}: ${JSON.stringify(result.body)}`);
  }
}

/** Cross-org DELETE probe: asserts a JWT scoped to one org cannot delete a row scoped to another org. */
export async function crossOrgDeleteDenied(
  ctx: ProbeContext,
  opts: { table: string; rowFilter: string; probingJwt: string; probeLabel: string },
): Promise<void> {
  const result = await restDelete(ctx, `${opts.table}?${opts.rowFilter}`, opts.probingJwt);
  if (result.status === 200) {
    const rows = result.body as unknown[];
    assertEquals(rows.length, 0, `${opts.probeLabel} LEAK: cross-org JWT deleted a row from ${opts.table} scoped to another org`);
  } else {
    assert(result.status === 401 || result.status === 403, `${opts.probeLabel}: unexpected non-200 status ${result.status}: ${JSON.stringify(result.body)}`);
  }
}

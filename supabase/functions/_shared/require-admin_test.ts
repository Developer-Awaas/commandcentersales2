/**
 * Credential-free. The gate is a security branch, so it gets a check that
 * fails if it ever quietly inverts.
 *
 * Run: deno test _shared/require-admin_test.ts   (from supabase/functions)
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isOrgAdmin } from './require-admin.ts'

/** Minimal stand-in for the service-role client's chained builder. */
function clientReturning(data: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data }) }),
      }),
    }),
  }
}

Deno.test('an admin passes', async () => {
  assertEquals(await isOrgAdmin(clientReturning({ role: 'admin' }), 'u1'), true)
})

Deno.test('a member does not', async () => {
  assertEquals(await isOrgAdmin(clientReturning({ role: 'member' }), 'u1'), false)
})

Deno.test('a missing profile row does not pass — absence is not permission', async () => {
  assertEquals(await isOrgAdmin(clientReturning(null), 'u1'), false)
})

Deno.test('a row with no role at all does not pass', async () => {
  assertEquals(await isOrgAdmin(clientReturning({}), 'u1'), false)
})

Deno.test('role matching is exact, not a prefix or case fold', async () => {
  for (const role of ['Admin', 'ADMIN', 'administrator', 'admin ', 'superadmin']) {
    assertEquals(await isOrgAdmin(clientReturning({ role }), 'u1'), false, `"${role}" must not pass`)
  }
})

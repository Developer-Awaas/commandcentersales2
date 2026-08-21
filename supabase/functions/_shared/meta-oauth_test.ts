// RB-MO — tests for the token-provenance door. Credential-free: fetch is
// stubbed, so no Graph call and no secrets are involved.
//
// What is under test is the thing that actually failed in production: a token
// minted by a DELETED app sat in org_integrations looking healthy for a month
// while the cron logged `skipped`. Every case below is a way that can happen
// again if verifyMetaToken stops being strict.
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { verifyMetaToken, buildMetaAuthUrl, META_SCOPES } from './meta-oauth.ts'

const realFetch = globalThis.fetch

function stubGraph(status: number, body: unknown) {
  globalThis.fetch = ((..._args: unknown[]) =>
    Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }))) as typeof fetch
}

function withApp(id: string, secret: string, fn: () => Promise<void>): Promise<void> {
  const prevId = Deno.env.get('META_APP_ID')
  const prevSecret = Deno.env.get('META_APP_SECRET')
  Deno.env.set('META_APP_ID', id)
  Deno.env.set('META_APP_SECRET', secret)
  return fn().finally(() => {
    prevId ? Deno.env.set('META_APP_ID', prevId) : Deno.env.delete('META_APP_ID')
    prevSecret ? Deno.env.set('META_APP_SECRET', prevSecret) : Deno.env.delete('META_APP_SECRET')
    globalThis.fetch = realFetch
  })
}

Deno.test('verifyMetaToken: refuses to run at all when the app is unconfigured', async () => {
  const prevId = Deno.env.get('META_APP_ID')
  const prevSecret = Deno.env.get('META_APP_SECRET')
  Deno.env.delete('META_APP_ID')
  Deno.env.delete('META_APP_SECRET')
  try {
    const r = await verifyMetaToken('EAAanything')
    assertEquals(r.ok, false)
    if (!r.ok) assertEquals(r.reason, 'unconfigured')
  } finally {
    prevId && Deno.env.set('META_APP_ID', prevId)
    prevSecret && Deno.env.set('META_APP_SECRET', prevSecret)
  }
})

Deno.test('verifyMetaToken: the dead-app case surfaces Meta\'s own message', async () => {
  // This is the exact production failure: OAuthException 190. It must be
  // reported verbatim, not flattened into a generic "invalid token", or the
  // next person re-runs the same week-long investigation.
  await withApp('1019506610581235', 'secret', async () => {
    stubGraph(400, { error: { message: 'Error validating application. Application has been deleted.', code: 190, type: 'OAuthException' } })
    const r = await verifyMetaToken('EAAdead')
    assertEquals(r.ok, false)
    if (!r.ok) {
      assertEquals(r.reason, 'graph_error')
      assertEquals(r.error.includes('Application has been deleted'), true)
      assertEquals(r.error.includes('190'), true)
    }
  })
})

Deno.test('verifyMetaToken: rejects a token minted by a DIFFERENT app', async () => {
  await withApp('1019506610581235', 'secret', async () => {
    stubGraph(200, { data: { app_id: '2444234312716509', is_valid: true, type: 'USER', scopes: ['ads_read'] } })
    const r = await verifyMetaToken('EAAforeign')
    assertEquals(r.ok, false)
    if (!r.ok) {
      assertEquals(r.reason, 'foreign_app')
      // Naming both apps is what makes the message actionable.
      assertEquals(r.error.includes('2444234312716509'), true)
      assertEquals(r.error.includes('1019506610581235'), true)
    }
  })
})

Deno.test('verifyMetaToken: rejects is_valid:false even from the right app', async () => {
  await withApp('1019506610581235', 'secret', async () => {
    stubGraph(200, { data: { app_id: '1019506610581235', is_valid: false, error: { message: 'Session has expired' } } })
    const r = await verifyMetaToken('EAAexpired')
    assertEquals(r.ok, false)
    if (!r.ok) assertEquals(r.reason, 'invalid')
  })
})

Deno.test('verifyMetaToken: accepts our own valid token and reports GRANTED scopes', async () => {
  await withApp('1019506610581235', 'secret', async () => {
    stubGraph(200, {
      data: {
        app_id: '1019506610581235', is_valid: true, type: 'USER',
        user_id: '77', expires_at: 1800000000,
        // Deliberately FEWER than requested: a user can decline scopes on the
        // consent screen, and storing what we asked for instead of what we got
        // is how a review fails on a permission we never actually had.
        scopes: ['ads_read', 'pages_show_list'],
      },
    })
    const r = await verifyMetaToken('EAAgood')
    assertEquals(r.ok, true)
    if (r.ok) {
      assertEquals(r.facts.appId, '1019506610581235')
      assertEquals(r.facts.scopes, ['ads_read', 'pages_show_list'])
      assertEquals(r.facts.expiresAt, new Date(1800000000 * 1000).toISOString())
    }
  })
})

Deno.test('verifyMetaToken: expires_at 0 means never, not the epoch', async () => {
  // System User tokens report 0. Treating that as 1970 would mark a
  // permanently-valid token as long expired.
  await withApp('1019506610581235', 'secret', async () => {
    stubGraph(200, { data: { app_id: '1019506610581235', is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: [] } })
    const r = await verifyMetaToken('EAAsystem')
    assertEquals(r.ok, true)
    if (r.ok) assertEquals(r.facts.expiresAt, null)
  })
})

Deno.test('buildMetaAuthUrl: state carries the nonce and nothing else', async () => {
  await withApp('1019506610581235', 'secret', async () => {
    const prevCfg = Deno.env.get('META_CONFIG_ID')
    Deno.env.delete('META_CONFIG_ID')
    try {
      const u = new URL(buildMetaAuthUrl('nonce-abc', 'https://x.supabase.co/functions/v1/meta-oauth-callback'))
      assertEquals(u.searchParams.get('state'), 'nonce-abc')
      assertEquals(u.searchParams.get('client_id'), '1019506610581235')
      assertEquals(u.searchParams.get('response_type'), 'code')
      // Without a config id, scopes must be requested explicitly.
      assertEquals(u.searchParams.get('scope'), META_SCOPES.join(','))
    } finally {
      prevCfg && Deno.env.set('META_CONFIG_ID', prevCfg)
    }
  })
})

Deno.test('buildMetaAuthUrl: a config id replaces scope (Login for Business)', async () => {
  await withApp('1019506610581235', 'secret', async () => {
    Deno.env.set('META_CONFIG_ID', 'cfg-123')
    try {
      const u = new URL(buildMetaAuthUrl('n', 'https://x/cb'))
      assertEquals(u.searchParams.get('config_id'), 'cfg-123')
      // Sending both is what makes Meta ignore the configuration silently.
      assertEquals(u.searchParams.get('scope'), null)
    } finally {
      Deno.env.delete('META_CONFIG_ID')
    }
  })
})

// P2.16 — token seniority. The guard exists because an OAuth connect silently
// turned the demo org's permanent System User connection into a personal login
// expiring 19 Oct. These pin the ONE direction that must be blocked, and — just
// as importantly — the three that must not be.
import { storeMetaConnection } from './meta-oauth.ts'

type Row = { meta_token_type?: string | null; token_expires_at?: string | null; meta_verified_at?: string | null }

/** Minimal stub: only the shape storeMetaConnection actually touches. */
function clientWith(existing: Row | null) {
  const calls: string[] = []
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return { maybeSingle: () => Promise.resolve({ data: existing ? { id: 'row-1', ...existing } : null }) }
                },
              }
            },
          }
        },
        update() { calls.push('update'); return { eq: () => Promise.resolve({ error: null }) } },
        insert() { calls.push('insert'); return Promise.resolve({ error: null }) },
      }
    },
  }
  return { client, calls }
}

const facts = (tokenType: string, expiresAt: string | null) => ({
  appId: '1409803007695086', tokenType, userId: '1', expiresAt, scopes: ['ads_read'], isValid: true,
})
const noAssets = { adAccountId: null, pageId: null, igUserId: null }

Deno.test('seniority: BLOCKS replacing a verified SYSTEM_USER with an expiring USER token', async () => {
  const { client, calls } = clientWith({ meta_token_type: 'SYSTEM_USER', meta_verified_at: '2026-08-18T14:19:02Z', token_expires_at: null })
  // deno-lint-ignore no-explicit-any
  const res = await storeMetaConnection(client as any, 'org-1', 'EAAnew', facts('USER', '2026-10-19T10:20:05Z'), noAssets)
  assertEquals(res.ok, false)
  assertEquals('needsConfirmation' in res, true)
  // Nothing may be written while the question is outstanding.
  assertEquals(calls.length, 0)
})

Deno.test('seniority: allows the SAME downgrade once a human confirmed it', async () => {
  const { client, calls } = clientWith({ meta_token_type: 'SYSTEM_USER', meta_verified_at: '2026-08-18T14:19:02Z', token_expires_at: null })
  // deno-lint-ignore no-explicit-any
  const res = await storeMetaConnection(client as any, 'org-1', 'EAAnew', facts('USER', '2026-10-19T10:20:05Z'), noAssets, { allowDowngrade: true })
  assertEquals(res.ok, true)
  assertEquals(calls, ['update'])
})

Deno.test('seniority: UPGRADE (USER -> SYSTEM_USER) is never blocked', async () => {
  const { client } = clientWith({ meta_token_type: 'USER', meta_verified_at: '2026-08-20T10:20:11Z', token_expires_at: '2026-10-19T10:20:05Z' })
  // deno-lint-ignore no-explicit-any
  const res = await storeMetaConnection(client as any, 'org-1', 'EAAsys', facts('SYSTEM_USER', null), noAssets)
  assertEquals(res.ok, true)
})

Deno.test('seniority: a FIRST connect is never blocked', async () => {
  const { client, calls } = clientWith(null)
  // deno-lint-ignore no-explicit-any
  const res = await storeMetaConnection(client as any, 'org-1', 'EAAnew', facts('USER', '2026-10-19T10:20:05Z'), noAssets)
  assertEquals(res.ok, true)
  assertEquals(calls, ['insert'])
})

Deno.test('seniority: an UNVERIFIED prior SYSTEM_USER row does not block', async () => {
  // meta_verified_at NULL means provenance was never established — that row has
  // no seniority to defend, and treating it as senior would let a legacy
  // unverified token veto a good OAuth connect.
  const { client } = clientWith({ meta_token_type: 'SYSTEM_USER', meta_verified_at: null, token_expires_at: null })
  // deno-lint-ignore no-explicit-any
  const res = await storeMetaConnection(client as any, 'org-1', 'EAAnew', facts('USER', '2026-10-19T10:20:05Z'), noAssets)
  assertEquals(res.ok, true)
})

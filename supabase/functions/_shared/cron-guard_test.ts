/**
 * Credential-free. Proves the gate closes, and — just as important — that it
 * still opens for the caller pg_cron actually is.
 *
 * Run: deno test --allow-env _shared/cron-guard_test.ts   (from supabase/functions)
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { denyUnlessCron } from './cron-guard.ts'

const KEY = 'test-service-role-key-value'

function post(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/functions/v1/whatever', { method: 'POST', headers })
}

Deno.test('rejects a non-POST before looking at anything else', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY)
  const r = denyUnlessCron(new Request('https://example.test/x', { method: 'GET' }))
  assertEquals(r?.status, 405)
})

Deno.test('OPTIONS is refused, not answered — these functions are not for browsers', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY)
  const r = denyUnlessCron(new Request('https://example.test/x', { method: 'OPTIONS' }))
  assertEquals(r?.status, 405)
  // No CORS on the refusal either: answering a preflight is what let a browser
  // reach the all-org sweep in the first place.
  assertEquals(r?.headers.get('Access-Control-Allow-Origin'), null)
})

Deno.test('refuses when the service-role key is absent rather than falling open', () => {
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
  assertEquals(denyUnlessCron(post({ authorization: `Bearer ${KEY}` }))?.status, 503)
})

Deno.test('no Authorization header is 401', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY)
  assertEquals(denyUnlessCron(post())?.status, 401)
})

Deno.test('a wrong bearer is 401', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY)
  assertEquals(denyUnlessCron(post({ authorization: 'Bearer not-the-key' }))?.status, 401)
})

Deno.test('a same-length wrong bearer is 401 — length alone is not the check', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY)
  const sameLength = 'X'.repeat(KEY.length)
  assertEquals(denyUnlessCron(post({ authorization: `Bearer ${sameLength}` }))?.status, 401)
})

Deno.test('the real pg_cron caller passes', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY)
  // Exactly the header shape in cron.job.command:
  //   'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
  assertEquals(denyUnlessCron(post({ authorization: `Bearer ${KEY}` })), null)
})

Deno.test('bearer prefix is case-insensitive and tolerates extra spacing', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY)
  assertEquals(denyUnlessCron(post({ authorization: `bearer  ${KEY}` })), null)
})

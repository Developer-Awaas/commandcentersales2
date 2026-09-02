import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { normalizeAdAccountId, bareAdAccountId, AD_ACCOUNT_ID_ERROR } from './ad-account-id.ts'

// Mirrors src/lib/ad-account-id.test.ts case for case. The two normalizers are
// hand-mirrored across the Vite/Deno boundary (same as pricing.ts), so the
// tests are the only thing that catches one side drifting from the other.

const NHCPL = '1538119047116545'

Deno.test('prefixes a bare numeric id', () => {
  assertEquals(normalizeAdAccountId(NHCPL), { ok: true, value: `act_${NHCPL}` })
})

Deno.test('is idempotent on an already-prefixed id', () => {
  assertEquals(normalizeAdAccountId(`act_${NHCPL}`), { ok: true, value: `act_${NHCPL}` })
})

Deno.test('strips the prefix case-insensitively', () => {
  assertEquals(normalizeAdAccountId('ACT_123456'), { ok: true, value: 'act_123456' })
  assertEquals(normalizeAdAccountId('Act_123456'), { ok: true, value: 'act_123456' })
})

Deno.test('trims surrounding whitespace', () => {
  assertEquals(normalizeAdAccountId('  act_123456  '), { ok: true, value: 'act_123456' })
  assertEquals(normalizeAdAccountId('\t1538119047116545\n'), { ok: true, value: `act_${NHCPL}` })
})

Deno.test('rejects non-numeric input', () => {
  assertEquals(normalizeAdAccountId('12ab34'), { ok: false, error: AD_ACCOUNT_ID_ERROR })
  assertEquals(normalizeAdAccountId('act_12ab34'), { ok: false, error: AD_ACCOUNT_ID_ERROR })
})

Deno.test('rejects empty and whitespace-only input', () => {
  assertEquals(normalizeAdAccountId(''), { ok: false, error: AD_ACCOUNT_ID_ERROR })
  assertEquals(normalizeAdAccountId('   '), { ok: false, error: AD_ACCOUNT_ID_ERROR })
  assertEquals(normalizeAdAccountId('act_'), { ok: false, error: AD_ACCOUNT_ID_ERROR })
})

Deno.test('rejects a doubled prefix rather than repairing it', () => {
  assertEquals(normalizeAdAccountId('act_act_123456'), { ok: false, error: AD_ACCOUNT_ID_ERROR })
})

Deno.test('enforces the digit-length bounds', () => {
  assertEquals(normalizeAdAccountId('12345').ok, false)
  assertEquals(normalizeAdAccountId('123456').ok, true)
  assertEquals(normalizeAdAccountId('1'.repeat(20)).ok, true)
  assertEquals(normalizeAdAccountId('1'.repeat(21)).ok, false)
})

Deno.test('bareAdAccountId strips the prefix for display', () => {
  assertEquals(bareAdAccountId(`act_${NHCPL}`), NHCPL)
  assertEquals(bareAdAccountId(NHCPL), NHCPL)
  assertEquals(bareAdAccountId(null), '')
})

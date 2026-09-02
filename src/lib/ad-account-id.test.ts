import { describe, it, expect } from 'vitest';
import { normalizeAdAccountId, bareAdAccountId, AD_ACCOUNT_ID_ERROR } from './ad-account-id';

/** The known-good reference value (NHCPL) used in every live verification. */
const NHCPL = '1538119047116545';

describe('normalizeAdAccountId', () => {
  it('prefixes a bare numeric id', () => {
    expect(normalizeAdAccountId(NHCPL)).toEqual({ ok: true, value: `act_${NHCPL}` });
  });

  it('is idempotent on an already-prefixed id', () => {
    const once = normalizeAdAccountId(NHCPL);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(normalizeAdAccountId(once.value)).toEqual({ ok: true, value: `act_${NHCPL}` });
  });

  it('strips the prefix case-insensitively', () => {
    // The old code was `startsWith('act_')`, which turned this into
    // act_ACT_123456 and stored it.
    expect(normalizeAdAccountId('ACT_123456')).toEqual({ ok: true, value: 'act_123456' });
    expect(normalizeAdAccountId('Act_123456')).toEqual({ ok: true, value: 'act_123456' });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeAdAccountId('  act_123456  ')).toEqual({ ok: true, value: 'act_123456' });
    expect(normalizeAdAccountId('\t1538119047116545\n')).toEqual({ ok: true, value: `act_${NHCPL}` });
  });

  it('rejects non-numeric input', () => {
    expect(normalizeAdAccountId('12ab34')).toEqual({ ok: false, error: AD_ACCOUNT_ID_ERROR });
    // Previously stored as act_12ab34 with no complaint.
    expect(normalizeAdAccountId('act_12ab34')).toEqual({ ok: false, error: AD_ACCOUNT_ID_ERROR });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(normalizeAdAccountId('')).toEqual({ ok: false, error: AD_ACCOUNT_ID_ERROR });
    expect(normalizeAdAccountId('   ')).toEqual({ ok: false, error: AD_ACCOUNT_ID_ERROR });
    expect(normalizeAdAccountId('act_')).toEqual({ ok: false, error: AD_ACCOUNT_ID_ERROR });
  });

  it('rejects a doubled prefix rather than repairing it', () => {
    expect(normalizeAdAccountId('act_act_123456')).toEqual({ ok: false, error: AD_ACCOUNT_ID_ERROR });
  });

  it('enforces the digit-length bounds', () => {
    expect(normalizeAdAccountId('12345')).toEqual({ ok: false, error: AD_ACCOUNT_ID_ERROR });
    expect(normalizeAdAccountId('123456')).toEqual({ ok: true, value: 'act_123456' });
    expect(normalizeAdAccountId('1'.repeat(20)).ok).toBe(true);
    expect(normalizeAdAccountId('1'.repeat(21)).ok).toBe(false);
  });
});

describe('bareAdAccountId', () => {
  it('strips the prefix for display', () => {
    expect(bareAdAccountId(`act_${NHCPL}`)).toBe(NHCPL);
    expect(bareAdAccountId(NHCPL)).toBe(NHCPL);
  });

  it('survives null and undefined', () => {
    expect(bareAdAccountId(null)).toBe('');
    expect(bareAdAccountId(undefined)).toBe('');
  });
});

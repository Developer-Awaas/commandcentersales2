import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression coverage for:
// - Bug: jwtExpiredOrExpiringSoon used plain atob() which fails on base64URL
//   encoding (JWTs use - and _ instead of + and /). The function always fell
//   into the catch block and returned false, meaning the proactive refresh
//   never fired for expired tokens.
// - Bug: FunctionsFetchError ("Failed to send a request to the Edge Function")
//   was not retried — only auth-class HTTP errors were retried.

// Helper: build a test JWT with a specific payload (no real signature)
function makeJwt(payload: Record<string, unknown>): string {
  const toBase64Url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${toBase64Url({ alg: 'HS256', typ: 'JWT' })}.${toBase64Url(payload)}.fake-sig`;
}

const mocks = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getSessionMock: vi.fn(),
  refreshSessionMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: mocks.getSessionMock,
      refreshSession: mocks.refreshSessionMock,
    },
    get functions() {
      return { invoke: mocks.invokeMock };
    },
  }),
}));

import { invokeEdgeFn } from './supabase';

describe('invokeEdgeFn — proactive token refresh (base64URL fix)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('proactively refreshes when the access_token JWT is expired', async () => {
    const expiredToken = makeJwt({ exp: Math.floor(Date.now() / 1000) - 120 });
    const freshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

    mocks.getSessionMock.mockResolvedValue({ data: { session: { access_token: expiredToken } } });
    mocks.refreshSessionMock.mockResolvedValue({ data: { session: { access_token: freshToken } } });
    mocks.invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

    await invokeEdgeFn('test-fn', { x: 1 });

    // Refresh must have been called BEFORE the invoke
    expect(mocks.refreshSessionMock).toHaveBeenCalledTimes(1);
    // Invoke must use the fresh token
    expect(mocks.invokeMock).toHaveBeenCalledWith('test-fn', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${freshToken}` }),
    }));
  });

  it('does NOT refresh when the token is still valid', async () => {
    const validToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

    mocks.getSessionMock.mockResolvedValue({ data: { session: { access_token: validToken } } });
    mocks.invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

    await invokeEdgeFn('test-fn', { x: 1 });

    expect(mocks.refreshSessionMock).not.toHaveBeenCalled();
    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe('invokeEdgeFn — FunctionsFetchError retry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries once on FunctionsFetchError and returns success on second attempt', async () => {
    const validToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mocks.getSessionMock.mockResolvedValue({ data: { session: { access_token: validToken } } });

    const fetchError = new Error('Failed to send a request to the Edge Function');
    mocks.invokeMock
      .mockResolvedValueOnce({ data: null, error: fetchError })
      .mockResolvedValueOnce({ data: { base64: 'abc' }, error: null });

    const result = await invokeEdgeFn('generate-image', { prompt: 'test' });

    expect(mocks.invokeMock).toHaveBeenCalledTimes(2);
    // No token refresh for network-level errors — just retry same token
    expect(mocks.refreshSessionMock).not.toHaveBeenCalled();
    expect(result.data).toEqual({ base64: 'abc' });
    expect(result.error).toBeNull();
  });

  it('returns the error after both attempts fail (no infinite loop)', async () => {
    const validToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mocks.getSessionMock.mockResolvedValue({ data: { session: { access_token: validToken } } });

    const fetchError = new Error('Failed to send a request to the Edge Function');
    mocks.invokeMock.mockResolvedValue({ data: null, error: fetchError });

    const result = await invokeEdgeFn('generate-image', { prompt: 'test' });

    // Exactly 2 calls — original + 1 retry, never more
    expect(mocks.invokeMock).toHaveBeenCalledTimes(2);
    expect(result.error?.message).toContain('Failed to send a request');
  });
});

// Helper: simulate the real FunctionsHttpError which has a .context Response property
// with the HTTP status code. invokeEdgeFn reads context.status to distinguish 401
// (auth failure → refresh + retry) from 500/546 (function crash → don't retry).
function makeHttpError(status: number, message = 'Edge Function returned a non-2xx status code') {
  return Object.assign(new Error(message), { context: { status, clone: () => ({ text: async () => '{}' }) } });
}

describe('invokeEdgeFn — auth error retry with token refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refreshes token and retries on 401 auth error', async () => {
    const oldToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const newToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });

    mocks.getSessionMock.mockResolvedValue({ data: { session: { access_token: oldToken } } });
    mocks.refreshSessionMock.mockResolvedValue({ data: { session: { access_token: newToken } } });

    // Simulate 401 from Supabase gateway (JWT validation failure)
    const authError = makeHttpError(401);
    mocks.invokeMock
      .mockResolvedValueOnce({ data: null, error: authError })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });

    const result = await invokeEdgeFn('claude-proxy', { messages: [] });

    expect(mocks.refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(mocks.invokeMock).toHaveBeenCalledTimes(2);
    expect(mocks.invokeMock).toHaveBeenNthCalledWith(2, 'claude-proxy', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${newToken}` }),
    }));
    expect(result.data).toEqual({ ok: true });
  });

  it('does NOT retry auth error when refresh yields the same token', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mocks.getSessionMock.mockResolvedValue({ data: { session: { access_token: token } } });
    mocks.refreshSessionMock.mockResolvedValue({ data: { session: { access_token: token } } });

    const authError = makeHttpError(401);
    mocks.invokeMock.mockResolvedValue({ data: null, error: authError });

    const result = await invokeEdgeFn('claude-proxy', { messages: [] });

    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
    // The auth error is returned as-is when no new token is available
    expect(result.error).not.toBeNull();
  });

  it('does NOT retry 546 function crashes (not an auth error)', async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mocks.getSessionMock.mockResolvedValue({ data: { session: { access_token: token } } });

    // 546 = edge function boot/crash error — not an auth failure
    const crashError = makeHttpError(546);
    mocks.invokeMock.mockResolvedValue({ data: null, error: crashError });

    const result = await invokeEdgeFn('generate-image', { prompt: 'test' });

    // Only 1 call — no retry for function crashes
    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSessionMock).not.toHaveBeenCalled();
    // Error is surfaced (not silently dropped)
    expect(result.error).not.toBeNull();
  });
});

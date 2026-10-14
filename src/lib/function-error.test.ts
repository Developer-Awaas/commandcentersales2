import { describe, it, expect } from 'vitest';
import { readFunctionError } from './function-error';

const httpErr = (body: string, status: number) =>
  Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: new Response(body, { status }) });

describe('readFunctionError', () => {
  it("treats the function's own { error } as deliberate (no retry)", async () => {
    expect(await readFunctionError(httpErr('{"error":"Page 1 is not on this deployment\'s publish allowlist."}', 403)))
      .toEqual({ message: "Page 1 is not on this deployment's publish allowlist.", fromFunction: true });
  });
  it("surfaces the gateway's message field, flagged retryable", async () => {
    expect(await readFunctionError(httpErr('{"code":"UNAUTHORIZED_LEGACY_JWT","message":"Invalid JWT"}', 401)))
      .toEqual({ message: 'Invalid JWT', fromFunction: false });
  });
  it('falls back to the wrapper text for a plain-text 500, flagged retryable', async () => {
    expect(await readFunctionError(httpErr('Internal Server Error', 500)))
      .toEqual({ message: 'Edge Function returned a non-2xx status code', fromFunction: false });
  });
  it('uses the fallback for a non-Error with no context', async () => {
    expect(await readFunctionError(null, 'Could not load')).toEqual({ message: 'Could not load', fromFunction: false });
  });
});

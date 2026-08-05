import { describe, it, expect } from 'vitest';
import { resolveGenerationErrorMessage } from './smm-generation-error';

describe('resolveGenerationErrorMessage', () => {
  it('surfaces the real error text instead of a generic message', () => {
    const msg = resolveGenerationErrorMessage({ error: 'Daily AI quota reached. Resets at midnight IST.' });
    expect(msg).toBe('Generation failed: Daily AI quota reached. Resets at midnight IST.');
  });

  it('surfaces a claude-proxy error message the same way', () => {
    const msg = resolveGenerationErrorMessage({ error: 'claude-proxy returned 500' });
    expect(msg).toBe('Generation failed: claude-proxy returned 500');
  });

  it('gives a specific message for an unparseable (raw) response', () => {
    const msg = resolveGenerationErrorMessage({ raw: 'not json at all' });
    expect(msg).toBe('Generation failed: response could not be parsed as structured data.');
  });

  it('falls back to a generic message only when there is truly no detail', () => {
    expect(resolveGenerationErrorMessage(null)).toBe('Generation failed. Please try again.');
    expect(resolveGenerationErrorMessage(undefined)).toBe('Generation failed. Please try again.');
    expect(resolveGenerationErrorMessage({})).toBe('Generation failed. Please try again.');
  });
});

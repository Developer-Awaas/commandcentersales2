import { describe, it, expect, vi } from 'vitest';

// The providers import ./supabase at module load; stub it so selection can be
// tested without constructing a real client.
vi.mock('./supabase', () => ({ supabase: {} }));

import { getBrandProvider, getMediaProvider, getMetaSyncProvider, getSocialMetricsProvider } from './providers';
import { LocalBrandProvider, LocalMediaProvider, CampaignMetricsProvider, ManualSocialMetricsProvider } from './providers/local';

describe('provider selection (config)', () => {
  it('returns the Local implementations today (pre-Praveshika)', () => {
    expect(getBrandProvider()).toBeInstanceOf(LocalBrandProvider);
    expect(getMediaProvider()).toBeInstanceOf(LocalMediaProvider);
    expect(getMetaSyncProvider()).toBeInstanceOf(CampaignMetricsProvider);
    expect(getSocialMetricsProvider()).toBeInstanceOf(ManualSocialMetricsProvider);
  });

  it('returns a stable singleton per provider', () => {
    expect(getBrandProvider()).toBe(getBrandProvider());
    expect(getMetaSyncProvider()).toBe(getMetaSyncProvider());
  });
});

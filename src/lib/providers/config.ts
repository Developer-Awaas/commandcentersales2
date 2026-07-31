// Provider selection — one constant per provider. Swapping to Praveshika is a
// one-line change here (+ implementing the class), no call-site edits.
//
// Deliberately a config constant, not an env var: the swap is a code decision
// tracked in git, matching the CC-P4 spec's // TODO(praveshika) markers.

import type { BrandProvider, MediaProvider, MetaSyncProvider } from './types';
import { LocalBrandProvider, LocalMediaProvider, CampaignMetricsProvider } from './local';

// TODO(praveshika): swap to PraveshikaBrandProvider when the brand service is live.
const brandProvider: BrandProvider = new LocalBrandProvider();
// TODO(praveshika): swap to PraveshikaMediaProvider when media lives there.
const mediaProvider: MediaProvider = new LocalMediaProvider();
// TODO(praveshika): swap to PraveshikaMetaSyncProvider when metrics live there.
const metaSyncProvider: MetaSyncProvider = new CampaignMetricsProvider();

export function getBrandProvider(): BrandProvider {
  return brandProvider;
}
export function getMediaProvider(): MediaProvider {
  return mediaProvider;
}
export function getMetaSyncProvider(): MetaSyncProvider {
  return metaSyncProvider;
}

// Edge provider selection — one constant per provider, mirroring the client
// side (src/lib/providers/config.ts). Swap to Praveshika here in one line.

import type { BrandProvider, MediaProvider } from './types.ts'
import { LocalBrandProvider, LocalMediaProvider } from './local.ts'

// TODO(praveshika): swap to PraveshikaBrandProvider when the brand service is live.
const brandProvider: BrandProvider = new LocalBrandProvider()
// TODO(praveshika): swap to PraveshikaMediaProvider when media lives there.
const mediaProvider: MediaProvider = new LocalMediaProvider()

export function getBrandProvider(): BrandProvider {
  return brandProvider
}
export function getMediaProvider(): MediaProvider {
  return mediaProvider
}

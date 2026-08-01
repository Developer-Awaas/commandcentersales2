// CC-P4 provider seam (edge side). Server-side mirror of src/lib/providers —
// decouples Edge Functions (Diya's brand check today) from where brand kits /
// media / metrics come from, so a Praveshika backend can drop in later.
// Selection via a config constant (./config.ts), matching the client side.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { RunBrandCheckInput, RunBrandCheckResult, BrandKitRow } from '../agents/diya.ts'

export interface BrandKit {
  id: string
  org_id: string
  [key: string]: unknown
}

export interface ProjectMediaAsset {
  id: string
  org_id: string
  project_id: string | null
  asset_url: string
  [key: string]: unknown
}

// Providers are constructed with a per-request SupabaseClient (edge functions
// build a fresh service-role client per invocation — see metrics-query.ts's
// buildMetricsContext, which takes the client as a param the same way).
export interface BrandProvider {
  getBrandKit(supabase: SupabaseClient, orgId: string, projectId?: string): Promise<BrandKit | null>
  // Batch vision brand check over Aanya's variants — the Local impl delegates
  // to Diya (CC-P4 Step 2). Fail-safe by design: missing kit / parse / API
  // error resolve to per-variant 'flag', never a fabricated pass or a crash.
  runBrandCheck(input: RunBrandCheckInput): Promise<RunBrandCheckResult>
}

export type { RunBrandCheckInput, RunBrandCheckResult, BrandKitRow }

export interface MediaProvider {
  listProjectMedia(supabase: SupabaseClient, orgId: string, projectId: string): Promise<ProjectMediaAsset[]>
  getLogo(supabase: SupabaseClient, orgId: string): Promise<string | null>
}

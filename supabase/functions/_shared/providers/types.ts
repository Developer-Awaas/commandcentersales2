// CC-P4 provider seam (edge side). Server-side mirror of src/lib/providers —
// decouples Edge Functions (Diya's brand check today) from where brand kits /
// media / metrics come from, so a Praveshika backend can drop in later.
// Selection via a config constant (./config.ts), matching the client side.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

export interface BrandCheckVerdict {
  status: 'pass' | 'flag'
  note?: string
}

// Providers are constructed with a per-request SupabaseClient (edge functions
// build a fresh service-role client per invocation — see metrics-query.ts's
// buildMetricsContext, which takes the client as a param the same way).
export interface BrandProvider {
  getBrandKit(supabase: SupabaseClient, orgId: string, projectId?: string): Promise<BrandKit | null>
  // Vision brand check for one creative image. The Local impl delegates to
  // Diya (CC-P4 Step 2). Returns fail-safe 'flag' on any error, never throws.
  runBrandCheck(supabase: SupabaseClient, input: {
    orgId: string
    creativeImageUrl: string
    brandKit: BrandKit | null
    traceId?: string
  }): Promise<BrandCheckVerdict>
}

export interface MediaProvider {
  listProjectMedia(supabase: SupabaseClient, orgId: string, projectId: string): Promise<ProjectMediaAsset[]>
  getLogo(supabase: SupabaseClient, orgId: string): Promise<string | null>
}

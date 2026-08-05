// Local edge provider implementations — wrap today's direct service-role reads.
// getBrandKit / listProjectMedia / getLogo are real; runBrandCheck delegates to
// Diya, which is restored in CC-P4 Step 2 (until then it fail-safe flags — the
// stub body below is replaced when Diya lands, its only consumer
// (aarav-orchestrate) is also wired in Step 2).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { BrandProvider, MediaProvider, BrandKit, ProjectMediaAsset } from './types.ts'
import { runBrandCheck as diyaRunBrandCheck, type RunBrandCheckInput, type RunBrandCheckResult } from '../agents/diya.ts'

export class LocalBrandProvider implements BrandProvider {
  async getBrandKit(supabase: SupabaseClient, orgId: string, _projectId?: string): Promise<BrandKit | null> {
    // brand_kits is one row per org (UNIQUE org_id, no project_id column) —
    // projectId is accepted for a future per-project override, unused today.
    const { data } = await supabase.from('brand_kits').select('*').eq('org_id', orgId).maybeSingle()
    return (data as BrandKit | null) ?? null
  }

  // The brand check IS Diya (CC-P4 Step 2) — the provider is the seam a future
  // Praveshika brand service slots into without touching aarav-orchestrate.
  runBrandCheck(input: RunBrandCheckInput): Promise<RunBrandCheckResult> {
    return diyaRunBrandCheck(input)
  }
}

export class LocalMediaProvider implements MediaProvider {
  async listProjectMedia(supabase: SupabaseClient, orgId: string, projectId: string): Promise<ProjectMediaAsset[]> {
    const { data } = await supabase
      .from('project_assets')
      .select('*')
      .eq('project_id', projectId)
      .eq('org_id', orgId)
      .order('display_order')
    return (data as ProjectMediaAsset[] | null) ?? []
  }

  async getLogo(supabase: SupabaseClient, orgId: string): Promise<string | null> {
    const { data } = await supabase
      .from('brand_kits')
      .select('logo_color_url, logo_dark_url, logo_white_url')
      .eq('org_id', orgId)
      .maybeSingle()
    if (!data) return null
    const kit = data as { logo_color_url?: string | null; logo_dark_url?: string | null; logo_white_url?: string | null }
    return kit.logo_color_url || kit.logo_dark_url || kit.logo_white_url || null
  }
}

// CC-P4 provider seam (client side). These interfaces decouple the app from
// *where* brand kits / project media / Meta metrics come from, so a future
// "Praveshika" backend can drop in without touching call sites. Mirrors the
// established server-side provider pattern (_shared/image-provider.ts).
//
// Selection is a single config constant per provider (see ./config.ts),
// NOT an env var — deliberately, so the swap is a one-line code change with
// a TODO(praveshika) marker rather than an environment concern.

export interface BrandKit {
  id: string;
  org_id: string;
  // Brand kits are read with select('*') everywhere; callers pick the fields
  // they need (colors, fonts, logo_url, default_languages, …). Kept open so
  // the provider doesn't have to enumerate a schema that only the editor owns.
  [key: string]: unknown;
}

export interface ProjectMediaAsset {
  id: string;
  org_id: string;
  project_id: string | null;
  asset_url: string;
  asset_type: string | null;
  display_order: number | null;
  visual_description?: string | null;
  [key: string]: unknown;
}

export interface CampaignMetricRow {
  id: string;
  org_id: string;
  project_id: string | null;
  campaign_id: string;
  campaign_name: string | null;
  date_start: string;
  date_stop: string;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  spend: number | null;
  ctr: number | null;
  frequency: number | null;
  leads: number | null;
  cpl: number | null;
  roas: number | null;
  platform: string | null;
  synced_at: string | null;
}

export interface MetaConnectionStatus {
  connected: boolean;
  // Present only when connected: the ad account and last successful sync.
  adAccountId?: string | null;
  lastSyncAt?: string | null;
}

// --- Provider interfaces -----------------------------------------------------

export interface BrandProvider {
  getBrandKit(orgId: string): Promise<BrandKit | null>;
  // Client-side brand check is server-side today (Diya, via aarav-orchestrate)
  // — the client Local impl throws. The method is on the interface so a future
  // Praveshika client provider can offer a local check without a call-site change.
  runBrandCheck(creativeImageUrl: string, brandKit: BrandKit | null): Promise<{ status: 'pass' | 'flag'; note?: string }>;
}

export interface MediaProvider {
  // `primaryFirst` orders is_primary rows before display_order (ReferenceImagePack's
  // query shape); default is display_order only (senior-designer-prompts' shape,
  // which slices the first N amenities so its ordering must be preserved exactly).
  listProjectMedia(orgId: string, projectId: string, opts?: { primaryFirst?: boolean }): Promise<ProjectMediaAsset[]>;
  getLogo(orgId: string): Promise<string | null>;
}

export interface SocialMetricRow {
  id: string;
  org_id: string;
  platform: string;
  date: string;
  followers: number | null;
  avg_reach: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  engagement_rate: number | null;
  follower_growth: number | null;
  posts_published: number | null;
  data_source: string | null;
}

export interface SocialTargets {
  fb_page_url: string | null;
  ig_page_url: string | null;
  ig_follower_target: number | null;
  ig_reach_target: number | null;
  fb_follower_target: number | null;
  fb_reach_target: number | null;
}

export interface SocialMetricsProvider {
  // Actuals from smm_metrics over a window (sinceDate inclusive, ISO date).
  getMetrics(orgId: string, opts?: { sinceDate?: string; platform?: string }): Promise<SocialMetricRow[]>;
  // Org-level handles + follower/reach targets (from organizations).
  getTargets(orgId: string): Promise<SocialTargets>;
}

export interface MetaSyncProvider {
  // Reads existing campaign_metrics rows for a project over a day-range window
  // (does NOT call Meta). `projectId === null` means org-level / all projects.
  getMetrics(orgId: string, projectId: string | null, rangeDays: number): Promise<CampaignMetricRow[]>;
  // Invokes the meta-insights-sync Edge Function on demand (the ONLY place a
  // real Meta round-trip happens). Resolves when the sync request completes.
  triggerSync(orgId: string, projectId: string | null): Promise<void>;
  getConnectionStatus(orgId: string): Promise<MetaConnectionStatus>;
}

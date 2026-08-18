// Local provider implementations — wrap TODAY's direct Supabase reads, no
// behavior change. These are what the app uses until a Praveshika backend
// replaces them (see ./config.ts). Writes (brand-kit editor, asset CRUD) stay
// as direct calls in their owning components — providers wrap READS only.

import { supabase } from '../supabase';
import type {
  BrandProvider, MediaProvider, MetaSyncProvider, SocialMetricsProvider,
  BrandKit, ProjectMediaAsset, CampaignMetricRow, MetaConnectionStatus,
  SocialMetricRow, SocialTargets,
} from './types';

export class LocalBrandProvider implements BrandProvider {
  async getBrandKit(orgId: string): Promise<BrandKit | null> {
    const { data } = await supabase.from('brand_kits').select('*').eq('org_id', orgId).maybeSingle();
    return (data as BrandKit | null) ?? null;
  }

  // The real brand check runs server-side (Diya, via aarav-orchestrate) — see
  // CC-P4 Step 2. There is no client-side brand check today; this exists so the
  // interface is complete and a future Praveshika client provider can override it.
  async runBrandCheck(): Promise<{ status: 'pass' | 'flag'; note?: string }> {
    throw new Error('runBrandCheck is not available client-side — brand checks run server-side via aarav-orchestrate (Diya).');
  }
}

export class LocalMediaProvider implements MediaProvider {
  async listProjectMedia(orgId: string, projectId: string, opts?: { primaryFirst?: boolean }): Promise<ProjectMediaAsset[]> {
    let query = supabase
      .from('project_assets')
      .select('*')
      .eq('project_id', projectId)
      .eq('org_id', orgId);
    if (opts?.primaryFirst) query = query.order('is_primary', { ascending: false });
    query = query.order('display_order');
    const { data } = await query;
    return (data as ProjectMediaAsset[] | null) ?? [];
  }

  async getLogo(orgId: string): Promise<string | null> {
    const { data } = await supabase
      .from('brand_kits')
      .select('logo_color_url, logo_dark_url, logo_white_url')
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) return null;
    const kit = data as { logo_color_url?: string | null; logo_dark_url?: string | null; logo_white_url?: string | null };
    return kit.logo_color_url || kit.logo_dark_url || kit.logo_white_url || null;
  }
}

export class ManualSocialMetricsProvider implements SocialMetricsProvider {
  async getMetrics(orgId: string, opts?: { sinceDate?: string; platform?: string }): Promise<SocialMetricRow[]> {
    let query = supabase
      .from('smm_metrics')
      .select('id, org_id, platform, date, followers, avg_reach, avg_likes, avg_comments, engagement_rate, follower_growth, posts_published, data_source')
      .eq('org_id', orgId)
      .order('date', { ascending: false });
    if (opts?.sinceDate) query = query.gte('date', opts.sinceDate);
    if (opts?.platform) query = query.eq('platform', opts.platform);
    const { data } = await query;
    return (data as SocialMetricRow[] | null) ?? [];
  }

  async getTargets(orgId: string): Promise<SocialTargets> {
    const { data } = await supabase
      .from('organizations')
      .select('fb_page_url, ig_page_url, ig_follower_target, ig_reach_target, fb_follower_target, fb_reach_target')
      .eq('id', orgId)
      .maybeSingle();
    const o = (data ?? {}) as Partial<SocialTargets>;
    return {
      fb_page_url: o.fb_page_url ?? null,
      ig_page_url: o.ig_page_url ?? null,
      ig_follower_target: o.ig_follower_target ?? null,
      ig_reach_target: o.ig_reach_target ?? null,
      fb_follower_target: o.fb_follower_target ?? null,
      fb_reach_target: o.fb_reach_target ?? null,
    };
  }
}

export class CampaignMetricsProvider implements MetaSyncProvider {
  async getMetrics(orgId: string, projectId: string | null, rangeDays: number): Promise<CampaignMetricRow[]> {
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let query = supabase
      .from('campaign_metrics')
      .select('*')
      .eq('org_id', orgId)
      .gte('date_start', since)
      .order('date_start', { ascending: false });
    if (projectId) query = query.eq('project_id', projectId);
    const { data } = await query;
    return (data as CampaignMetricRow[] | null) ?? [];
  }

  // meta-insights-sync takes no per-project body today (it walks every project
  // with a configured ad account) — projectId is accepted for interface
  // stability + future per-project scoping, unused server-side for now.
  async triggerSync(_orgId: string, _projectId: string | null): Promise<void> {
    const { error } = await supabase.functions.invoke('meta-insights-sync', { body: {} });
    if (error) throw new Error(`meta-insights-sync failed: ${error.message}`);
  }

  async getConnectionStatus(orgId: string): Promise<MetaConnectionStatus> {
    const { data } = await supabase
      .from('org_integrations')
      .select('meta_ad_account_id, is_active, last_sync_at, status')
      .eq('org_id', orgId)
      .eq('provider', 'meta')
      .maybeSingle();
    if (!data) return { connected: false, state: 'none' };
    // status is authoritative; is_active is kept in step with it by the sync.
    const st = (data as { status?: string | null }).status ?? null;
    if (st === 'invalid') return { connected: false, state: 'invalid' };
    if (!(data as { is_active?: boolean }).is_active) {
      // No status yet (row predates RB-MO) but disabled: it was auto-disabled
      // by the sync's auth-error path, so 'invalid' is the accurate reading.
      return { connected: false, state: st ? 'none' : 'invalid' };
    }
    const row = data as { meta_ad_account_id?: string | null; last_sync_at?: string | null };
    return { connected: true, adAccountId: row.meta_ad_account_id ?? null, lastSyncAt: row.last_sync_at ?? null };
  }
}

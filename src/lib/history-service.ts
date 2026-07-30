import { supabase } from './supabase';

export type ToolOutputDomain = 'ads' | 'social';
export type ToolOutputTool = 'strategy' | 'ad_config' | 'ad_creatives' | 'ad_review' | 'smm_planner' | 'smm_creatives';
export type ToolOutputStatus = 'saved' | 'in_progress' | 'completed';

export interface AssetRef {
  bucket: string;
  path: string;
  creative_asset_id?: string | null;
}

export interface ToolOutput {
  id: string;
  org_id: string;
  domain: ToolOutputDomain;
  tool: ToolOutputTool;
  campaign_id: string | null;
  payload: Record<string, unknown>;
  asset_refs: AssetRef[];
  status: ToolOutputStatus;
  created_at: string;
}

export interface CampaignJourneyAsset {
  id: string;
  image_url: string;
  angle: string;
  funnel_stage: string;
  status: string;
  storage_path: string;
  created_at: string;
}

export interface CampaignJourney {
  toolOutputs: ToolOutput[];
  creativeAssets: CampaignJourneyAsset[];
}

export async function saveToolOutput(input: {
  orgId: string;
  domain: ToolOutputDomain;
  tool: ToolOutputTool;
  campaignId?: string | null;
  payload: Record<string, unknown>;
  assetRefs?: AssetRef[];
  status?: ToolOutputStatus;
}): Promise<ToolOutput> {
  const { data, error } = await supabase
    .from('tool_outputs')
    .insert({
      org_id: input.orgId,
      domain: input.domain,
      tool: input.tool,
      campaign_id: input.campaignId ?? null,
      payload: input.payload,
      asset_refs: input.assetRefs ?? [],
      status: input.status ?? 'saved',
    })
    .select('*')
    .single();

  if (error) throw new Error(`saveToolOutput failed: ${error.message}`);
  if (!data) throw new Error('saveToolOutput succeeded but no row returned — check tool_outputs RLS SELECT policy');

  return data as ToolOutput;
}

export async function listToolOutputs(
  orgId: string,
  domain: ToolOutputDomain,
  tool?: ToolOutputTool,
  limit = 50
): Promise<ToolOutput[]> {
  let query = supabase
    .from('tool_outputs')
    .select('*')
    .eq('org_id', orgId)
    .eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (tool) query = query.eq('tool', tool);

  const { data, error } = await query;
  if (error) throw new Error(`listToolOutputs failed: ${error.message}`);
  return (data ?? []) as ToolOutput[];
}

// Ordering for the campaign-journey view. Only the 'ads' domain tools
// (strategy -> ad_config -> ad_creatives -> ad_review) ever co-occur under
// a real campaign_id in practice — campaigns are an ads-only concept in
// this schema. The smm_* entries are included for type completeness only.
const JOURNEY_TOOL_ORDER: Record<ToolOutputTool, number> = {
  strategy: 0,
  ad_config: 1,
  ad_creatives: 2,
  ad_review: 3,
  smm_planner: 0,
  smm_creatives: 1,
};

export async function getCampaignJourney(campaignId: string): Promise<CampaignJourney> {
  const [{ data: outputs, error: outputsErr }, { data: assets, error: assetsErr }] = await Promise.all([
    supabase.from('tool_outputs').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
    supabase
      .from('creative_assets')
      .select('id, image_url, angle, funnel_stage, status, storage_path, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true }),
  ]);

  if (outputsErr) throw new Error(`getCampaignJourney failed (tool_outputs): ${outputsErr.message}`);
  if (assetsErr) throw new Error(`getCampaignJourney failed (creative_assets): ${assetsErr.message}`);

  const toolOutputs = ((outputs ?? []) as ToolOutput[]).slice().sort((a, b) => {
    const orderDiff = (JOURNEY_TOOL_ORDER[a.tool] ?? 99) - (JOURNEY_TOOL_ORDER[b.tool] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return a.created_at.localeCompare(b.created_at);
  });

  return { toolOutputs, creativeAssets: (assets ?? []) as CampaignJourneyAsset[] };
}

export async function markStatus(id: string, status: ToolOutputStatus): Promise<void> {
  const { error } = await supabase.from('tool_outputs').update({ status }).eq('id', id);
  if (error) throw new Error(`markStatus failed: ${error.message}`);
}

// Storage-then-DB-row ordering, modeled on creative-history.ts's
// enforceCreativeHistoryLimit: an orphaned storage file costs space, not
// correctness, so storage-cleanup failure is non-fatal and the DB row is
// always removed regardless. Bucket comes explicitly from each asset_ref
// (seeded at save time) rather than inferred from a path prefix.
export async function deleteToolOutput(id: string): Promise<void> {
  const { data: row, error: fetchErr } = await supabase
    .from('tool_outputs')
    .select('asset_refs')
    .eq('id', id)
    .single();
  if (fetchErr) throw new Error(`deleteToolOutput failed to fetch asset_refs: ${fetchErr.message}`);

  const assetRefs = (row?.asset_refs ?? []) as AssetRef[];
  const byBucket: Record<string, string[]> = {};
  for (const ref of assetRefs) {
    if (!ref.bucket || !ref.path) continue;
    (byBucket[ref.bucket] ??= []).push(ref.path);
  }
  for (const [bucket, paths] of Object.entries(byBucket)) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) console.warn(`[history-service] storage cleanup failed for bucket "${bucket}":`, error.message);
  }

  const { error: deleteErr } = await supabase.from('tool_outputs').delete().eq('id', id);
  if (deleteErr) throw new Error(`deleteToolOutput failed to delete row: ${deleteErr.message}`);
}

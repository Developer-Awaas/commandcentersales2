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

const RETENTION_CAP_PER_TOOL = 30;

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

  // Best-effort — a retention-sweep failure must never fail the save the
  // user is actively waiting on. The weekly pg_cron sweep is the backstop
  // for whatever this misses.
  try {
    await enforceRetentionCap(input.orgId, input.tool);
  } catch (err) {
    console.warn('[history-service] retention cap enforcement failed:', err);
  }

  return data as ToolOutput;
}

// Cap enforcement: if (org_id, tool) now has more than
// RETENTION_CAP_PER_TOOL rows, delete the oldest overflow via
// deleteToolOutput (storage objects included). Called after every save;
// also the exact logic the weekly pg_cron sweep re-runs as a backstop for
// rows orphaned by a direct delete elsewhere.
export async function enforceRetentionCap(orgId: string, tool: ToolOutputTool): Promise<void> {
  const { data, error } = await supabase
    .from('tool_outputs')
    .select('id')
    .eq('org_id', orgId)
    .eq('tool', tool)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`enforceRetentionCap failed to list rows: ${error.message}`);

  const rows = (data ?? []) as { id: string }[];
  if (rows.length <= RETENTION_CAP_PER_TOOL) return;

  const overflow = rows.slice(RETENTION_CAP_PER_TOOL);
  for (const row of overflow) {
    await deleteToolOutput(row.id);
  }
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

// Same MAX_LIVE_CREATIVES cap and oldest-first eviction as
// meta-insights-sync's arjunPromoteCreatives (the only other writer of
// aanya_training_creatives) — kept in sync deliberately, not re-derived.
const MAX_LIVE_TRAINING_CREATIVES = 10;

export interface DistillCampaignResult {
  distilledCount: number;
  skippedDuplicateCount: number;
}

// Completed-campaign distillation: copies the campaign's creatives (+
// whatever design DNA / ad-review verdict is available) into
// aanya_training_creatives for future generation, then removes the
// campaign's own tool_outputs + creative_assets history rows (storage
// objects included) — the UI-facing tradeoff this makes explicit via a
// confirm dialog ("distilled for AI training, history entries removed").
export async function distillCampaign(campaignId: string): Promise<DistillCampaignResult> {
  const { data: campaign, error: campaignErr } = await supabase
    .from('campaigns')
    .select('id, org_id')
    .eq('id', campaignId)
    .single();
  if (campaignErr) throw new Error(`distillCampaign failed to load campaign: ${campaignErr.message}`);
  if (!campaign?.org_id) throw new Error('distillCampaign: campaign has no org_id');
  const orgId = campaign.org_id as string;

  const { data: assets, error: assetsErr } = await supabase
    .from('creative_assets')
    .select('id, project_id, creative_id, image_url, storage_path, status')
    .eq('campaign_id', campaignId)
    .not('image_url', 'is', null);
  if (assetsErr) throw new Error(`distillCampaign failed to load creative_assets: ${assetsErr.message}`);

  const candidateAssets = (assets ?? []) as {
    id: string; project_id: string | null; creative_id: string | null; image_url: string; storage_path: string; status: string;
  }[];

  if (candidateAssets.length === 0) {
    await cleanupCampaignHistory(campaignId);
    return { distilledCount: 0, skippedDuplicateCount: 0 };
  }

  const { data: existing, error: existingErr } = await supabase
    .from('aanya_training_creatives')
    .select('storage_path')
    .eq('org_id', orgId)
    .eq('source', 'own_ad');
  if (existingErr) throw new Error(`distillCampaign failed to check existing training creatives: ${existingErr.message}`);
  const existingPaths = new Set(((existing ?? []) as { storage_path: string }[]).map((r) => r.storage_path));

  const newAssets = candidateAssets.filter((a) => a.storage_path && !existingPaths.has(a.storage_path));
  const skippedDuplicateCount = candidateAssets.length - newAssets.length;

  // Best-effort context to attach as notes — a missing DNA/review verdict
  // must never block distillation itself.
  let dnaSummary: string | null = null;
  let reviewSummary: string | null = null;
  try {
    const creativeIds = [...new Set(newAssets.map((a) => a.creative_id).filter((id): id is string => !!id))];
    if (creativeIds.length > 0) {
      const { data: creatives } = await supabase
        .from('creatives')
        .select('design_dna_tags')
        .in('id', creativeIds);
      const tags = (creatives ?? []).flatMap((c) => {
        const t = (c as { design_dna_tags: unknown }).design_dna_tags;
        return Array.isArray(t) ? t : [];
      });
      if (tags.length > 0) dnaSummary = [...new Set(tags.map(String))].join(', ');
    }
  } catch (err) {
    console.warn('[history-service] distillCampaign: design DNA lookup failed (non-fatal):', err);
  }
  try {
    const { data: review } = await supabase
      .from('tool_outputs')
      .select('payload')
      .eq('campaign_id', campaignId)
      .eq('tool', 'ad_review')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (review?.payload) reviewSummary = JSON.stringify(review.payload).slice(0, 500);
  } catch (err) {
    console.warn('[history-service] distillCampaign: ad_review lookup failed (non-fatal):', err);
  }

  for (const asset of newAssets) {
    const { count: liveCount } = await supabase
      .from('aanya_training_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_live', true);
    if ((liveCount ?? 0) >= MAX_LIVE_TRAINING_CREATIVES) {
      const { data: oldest } = await supabase
        .from('aanya_training_creatives')
        .select('id')
        .eq('org_id', orgId)
        .eq('is_live', true)
        .order('created_at', { ascending: true })
        .limit(1);
      if (oldest?.[0]) {
        await supabase.from('aanya_training_creatives').update({ is_live: false }).eq('id', (oldest[0] as { id: string }).id);
      }
    }

    const notes = ['Distilled from completed campaign.', dnaSummary ? `Design DNA: ${dnaSummary}.` : null, reviewSummary ? `Ad Review verdict: ${reviewSummary}` : null]
      .filter(Boolean)
      .join(' ');

    const { error: insertErr } = await supabase.from('aanya_training_creatives').insert({
      org_id: orgId,
      project_id: asset.project_id,
      image_url: asset.image_url,
      storage_path: asset.storage_path,
      source: 'own_ad',
      performance_tier: 'reference_only',
      is_live: true,
      notes,
    });
    if (insertErr) throw new Error(`distillCampaign failed to insert training creative: ${insertErr.message}`);
  }

  await cleanupCampaignHistory(campaignId);

  return { distilledCount: newAssets.length, skippedDuplicateCount };
}

// Storage-first deletion of every tool_outputs + creative_assets row tied
// to a campaign, called once distillation has copied whatever's worth
// keeping into aanya_training_creatives.
async function cleanupCampaignHistory(campaignId: string): Promise<void> {
  const { data: outputs } = await supabase.from('tool_outputs').select('id').eq('campaign_id', campaignId);
  for (const row of (outputs ?? []) as { id: string }[]) {
    await deleteToolOutput(row.id);
  }

  const { data: assets } = await supabase
    .from('creative_assets')
    .select('id, storage_path')
    .eq('campaign_id', campaignId);
  const assetRows = (assets ?? []) as { id: string; storage_path: string | null }[];
  const paths = assetRows.map((a) => a.storage_path).filter((p): p is string => !!p);
  if (paths.length > 0) {
    // generated-creatives/ assets live in brand-assets; everything else in
    // creative-assets — same inference creative-history.ts already uses.
    const byBucket: Record<string, string[]> = { 'brand-assets': [], 'creative-assets': [] };
    for (const p of paths) {
      const bucket = p.startsWith('generated-creatives/') ? 'brand-assets' : 'creative-assets';
      byBucket[bucket].push(p);
    }
    for (const [bucket, bucketPaths] of Object.entries(byBucket)) {
      if (bucketPaths.length === 0) continue;
      const { error } = await supabase.storage.from(bucket).remove(bucketPaths);
      if (error) console.warn(`[history-service] distillCampaign: storage cleanup failed for "${bucket}":`, error.message);
    }
  }
  if (assetRows.length > 0) {
    const { error } = await supabase.from('creative_assets').delete().eq('campaign_id', campaignId);
    if (error) throw new Error(`distillCampaign failed to delete creative_assets: ${error.message}`);
  }
}

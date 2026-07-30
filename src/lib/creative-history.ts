import { supabase } from './supabase';

const HISTORY_LIMIT = 10;

// The "Ad Creatives" page's saved-history grid is a rolling window — after
// a save/approve, if a project now has more than HISTORY_LIMIT distinct
// saved creative/strategy entries, the oldest ones beyond that window are
// deleted (their creative_assets rows, the parent creatives row where one
// exists, and the underlying storage files) rather than accumulating
// forever. "One entry" = one creatives row when present (a Strategy Quick
// Generate session, 1-3 images sharing creative_id), or one bare
// creative_assets row with no parent (the Nanobanana/CreativeViewer path,
// which never sets creative_id) — grouped separately since they're not
// the same kind of thing.
export async function enforceCreativeHistoryLimit(orgId: string, projectId: string): Promise<void> {
  const { data: approved } = await supabase
    .from('creative_assets')
    .select('id, creative_id, created_at')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (!approved || approved.length === 0) return;

  // Group into entries: rows sharing a non-null creative_id collapse into
  // one entry (keyed by that id); rows with no creative_id are each their
  // own entry (keyed by their own asset id). Entries are already
  // newest-first since the query is ordered that way and we take the first
  // occurrence of each key.
  const seenKeys = new Set<string>();
  const orderedEntries: { creativeId: string | null; bareAssetId: string | null }[] = [];
  for (const row of approved) {
    const creativeId = row.creative_id as string | null;
    const key = creativeId ?? `asset:${row.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    orderedEntries.push({ creativeId, bareAssetId: creativeId ? null : (row.id as string) });
  }

  const excess = orderedEntries.slice(HISTORY_LIMIT);
  if (excess.length === 0) return;

  const excessCreativeIds = excess.filter((e) => e.creativeId).map((e) => e.creativeId as string);
  const excessBareAssetIds = excess.filter((e) => e.bareAssetId).map((e) => e.bareAssetId as string);

  // Pull every creative_assets row for the entries being pruned — not just
  // the approved ones used above to determine ordering — so a deleted
  // entry doesn't leave orphaned non-approved sibling rows or their files
  // behind (e.g. a rejected variant from the same generation batch).
  const allAssetsForExcess: { id: string; storage_path: string | null }[] = [];
  if (excessCreativeIds.length > 0) {
    const { data } = await supabase.from('creative_assets').select('id, storage_path').in('creative_id', excessCreativeIds);
    if (data) allAssetsForExcess.push(...(data as { id: string; storage_path: string | null }[]));
  }
  if (excessBareAssetIds.length > 0) {
    const { data } = await supabase.from('creative_assets').select('id, storage_path').in('id', excessBareAssetIds);
    if (data) allAssetsForExcess.push(...(data as { id: string; storage_path: string | null }[]));
  }
  if (allAssetsForExcess.length === 0) return;

  // storage_path prefix determines the actual bucket — mirrors the same
  // inference canva-sync-design uses, since a post-Canva-sync path can
  // live in either bucket depending on the asset's original path prefix.
  const byBucket: Record<string, string[]> = { 'brand-assets': [], 'creative-assets': [] };
  for (const row of allAssetsForExcess) {
    if (!row.storage_path) continue;
    const bucket = row.storage_path.startsWith('generated-creatives/') ? 'brand-assets' : 'creative-assets';
    byBucket[bucket].push(row.storage_path);
  }
  for (const [bucket, paths] of Object.entries(byBucket)) {
    if (paths.length > 0) {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      // Storage cleanup failing is non-fatal — an orphaned file costs
      // storage space, not correctness — but the DB rows must still go so
      // the history grid stays capped either way.
      if (error) console.warn(`[creative-history] storage cleanup failed for ${bucket}:`, error.message);
    }
  }

  await supabase.from('creative_assets').delete().in('id', allAssetsForExcess.map((r) => r.id));
  if (excessCreativeIds.length > 0) {
    await supabase.from('creatives').delete().in('id', excessCreativeIds);
  }
}

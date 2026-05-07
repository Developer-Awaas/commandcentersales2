// src/components/ProjectAssetsTab.tsx
// Renders inside the Project Detail view as a third tab: [Overview] [Performance] [Assets]
// Allows uploading and categorizing reference images per project for use in creative generation.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Asset {
  id: string;
  asset_type: string;
  asset_url: string;
  thumbnail_url?: string;
  title?: string;
  description?: string;
  is_primary: boolean;
  display_order: number;
}

const ASSET_TYPES = [
  { group: 'Hero & Logo', items: [
    { value: 'project_logo', label: 'Project Logo' },
    { value: 'hero_exterior', label: 'Hero Exterior (day)' },
    { value: 'hero_night', label: 'Hero Exterior (night)' },
  ]},
  { group: 'Interiors', items: [
    { value: 'interior_living', label: 'Living Room' },
    { value: 'interior_kitchen', label: 'Kitchen' },
    { value: 'interior_bedroom', label: 'Bedroom' },
    { value: 'interior_bathroom', label: 'Bathroom' },
  ]},
  { group: 'Amenities', items: [
    { value: 'amenity_gym', label: 'Gym' },
    { value: 'amenity_terrace', label: 'Terrace' },
    { value: 'amenity_garden', label: 'Garden' },
    { value: 'amenity_lobby', label: 'Lobby' },
    { value: 'amenity_pool', label: 'Pool' },
    { value: 'amenity_clubhouse', label: 'Clubhouse' },
    { value: 'amenity_other', label: 'Other Amenity' },
  ]},
  { group: 'Plans & Maps', items: [
    { value: 'floor_plan', label: 'Floor Plan' },
    { value: 'site_plan', label: 'Site Plan' },
    { value: 'location_map', label: 'Location Map' },
  ]},
  { group: 'Lifestyle', items: [
    { value: 'lifestyle_family', label: 'Family Lifestyle' },
    { value: 'lifestyle_couple', label: 'Couple Lifestyle' },
    { value: 'lifestyle_individual', label: 'Individual Lifestyle' },
  ]},
  { group: 'Other', items: [
    { value: 'construction_progress', label: 'Construction Progress' },
    { value: 'walkthrough_still', label: 'Walkthrough Still' },
    { value: 'mood_reference', label: 'Mood/Inspiration Reference' },
    { value: 'other', label: 'Other' },
  ]},
];

export default function ProjectAssetsTab({ projectId, orgId }: { projectId: string; orgId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('project_assets')
      .select('*')
      .eq('project_id', projectId)
      .order('asset_type')
      .order('display_order');
    setAssets(data || []);
    setLoading(false);
  }

  async function upload(files: FileList | null, assetType: string) {
    if (!files || files.length === 0) return;
    setUploading(assetType);

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop();
      const filename = `${orgId}/${projectId}/${assetType}_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('project-assets')
        .upload(filename, file, { upsert: false });

      if (upErr) {
        console.error('Upload error:', upErr);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('project-assets')
        .getPublicUrl(filename);

      // Check if this is the first asset of this type — if so, mark as primary
      const existingOfType = assets.filter(a => a.asset_type === assetType);
      const isFirstOfType = existingOfType.length === 0;

      await supabase.from('project_assets').insert({
        project_id: projectId,
        org_id: orgId,
        asset_type: assetType,
        asset_url: publicUrl,
        title: file.name.replace(/\.[^.]+$/, ''),
        is_primary: isFirstOfType,
        display_order: existingOfType.length,
      });
    }

    setUploading(null);
    load();
  }

  async function deleteAsset(asset: Asset) {
    if (!confirm(`Delete ${asset.title || 'this asset'}?`)) return;

    // Extract storage path from URL
    const urlParts = asset.asset_url.split('/project-assets/');
    if (urlParts.length === 2) {
      await supabase.storage.from('project-assets').remove([urlParts[1]]);
    }

    await supabase.from('project_assets').delete().eq('id', asset.id);
    load();
  }

  async function setPrimary(asset: Asset) {
    // Unset others of same type
    await supabase.from('project_assets')
      .update({ is_primary: false })
      .eq('project_id', projectId)
      .eq('asset_type', asset.asset_type);

    // Set this one as primary
    await supabase.from('project_assets')
      .update({ is_primary: true })
      .eq('id', asset.id);

    load();
  }

  async function updateAsset(asset: Asset, updates: Partial<Asset>) {
    await supabase.from('project_assets')
      .update(updates)
      .eq('id', asset.id);
    load();
  }

  const filteredAssets = filter === 'all' ? assets : assets.filter(a => a.asset_type === filter);

  const counts = ASSET_TYPES.reduce((acc, group) => {
    group.items.forEach(item => {
      acc[item.value] = assets.filter(a => a.asset_type === item.value).length;
    });
    return acc;
  }, {} as Record<string, number>);

  if (loading) return <div className="p-6 text-text-tertiary">Loading assets...</div>;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold mb-2">Project Assets</h2>
        <p className="text-text-tertiary text-sm">
          Upload reference images for this project. Aanya (the AI designer) uses these to generate creatives that match your actual building, interiors, and amenities — instead of generic stock visuals.
        </p>
        <p className="text-text-tertiary text-xs mt-1">
          Total: {assets.length} assets · Primary assets are marked with ⭐ and used by default in generation.
        </p>
      </div>

      {/* Upload area — by category */}
      <div className="space-y-6 mb-8">
        {ASSET_TYPES.map(group => (
          <div key={group.group} className="bg-surface-elevated/50 border border-border rounded-lg p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">{group.group}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {group.items.map(item => (
                <div key={item.value} className="relative">
                  <label className="block">
                    <div className={`p-3 border border-dashed rounded cursor-pointer transition hover:border-brand hover:bg-brand-subtle ${counts[item.value] > 0 ? 'border-brand-border bg-brand-subtle' : 'border-border'}`}>
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="text-xs text-text-tertiary">
                        {counts[item.value] > 0 ? `${counts[item.value]} uploaded` : 'Click to upload'}
                      </div>
                    </div>
                    <input type="file" accept="image/png,image/jpeg,image/webp" multiple
                      className="hidden"
                      onChange={e => upload(e.target.files, item.value)}
                      disabled={uploading !== null} />
                  </label>
                  {uploading === item.value && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded text-xs text-white">
                      Uploading...
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Existing assets gallery */}
      {assets.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Uploaded Assets ({filteredAssets.length})</h3>
            <select value={filter} onChange={e => setFilter(e.target.value)}
              className="bg-surface-sunken border border-border rounded px-3 py-1 text-sm">
              <option value="all">All types</option>
              {ASSET_TYPES.flatMap(g => g.items).map(i => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredAssets.map(asset => (
              <div key={asset.id} className="bg-surface-elevated border border-border rounded overflow-hidden group">
                <div className="aspect-square bg-surface-sunken relative">
                  <img src={asset.asset_url} alt={asset.title} className="w-full h-full object-cover" />
                  {asset.is_primary && (
                    <span className="absolute top-2 left-2 bg-brand text-white text-xs px-2 py-0.5 rounded font-medium">⭐ PRIMARY</span>
                  )}
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                    <button onClick={() => setEditingAsset(asset)}
                      className="px-3 py-1 bg-blue-500 text-white text-xs rounded">Edit</button>
                    {!asset.is_primary && (
                      <button onClick={() => setPrimary(asset)}
                        className="px-3 py-1 bg-brand text-white text-xs rounded">Set Primary</button>
                    )}
                    <button onClick={() => deleteAsset(asset)}
                      className="px-3 py-1 bg-red-500 text-white text-xs rounded">Delete</button>
                  </div>
                </div>
                <div className="p-2">
                  <div className="text-xs text-text-tertiary">{ASSET_TYPES.flatMap(g => g.items).find(i => i.value === asset.asset_type)?.label}</div>
                  <div className="text-sm truncate">{asset.title || 'Untitled'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingAsset && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-elevated border border-border rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Edit Asset</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary">Title</label>
                <input type="text" defaultValue={editingAsset.title}
                  onBlur={e => updateAsset(editingAsset, { title: e.target.value })}
                  className="w-full bg-surface-sunken border border-border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-text-tertiary">Description (helps Aanya use the image correctly)</label>
                <textarea defaultValue={editingAsset.description}
                  onBlur={e => updateAsset(editingAsset, { description: e.target.value })}
                  placeholder="e.g., 'Building seen from the south-east, morning light'"
                  className="w-full bg-surface-sunken border border-border rounded px-3 py-2 text-sm h-20" />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setEditingAsset(null)}
                className="px-4 py-2 bg-surface-sunken text-text-primary border border-border hover:border-border-strong rounded text-sm">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

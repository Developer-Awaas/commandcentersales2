// src/components/ProjectMediaPicker.tsx
// Lets the user tick which already-uploaded Project Assets (or a fresh upload) this
// specific generation should be grounded in, instead of buildReferenceManifest blindly
// auto-selecting one hero/interior/amenity asset per category. Ticking a thumbnail IS
// the approval — selected assets are vision-described and injected into the prompt,
// untouched ones are ignored for this generation (they remain in Project Assets either way).

import { useEffect, useState } from 'react';
import { Upload, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface ProjectMediaAsset {
  id: string;
  asset_type: string;
  asset_url: string;
  title?: string;
  description?: string;
  is_primary?: boolean;
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  project_logo: 'Project Logo',
  hero_exterior: 'Hero Exterior (day)',
  hero_night: 'Hero Exterior (night)',
  interior_living: 'Living Room',
  interior_kitchen: 'Kitchen',
  interior_bedroom: 'Bedroom',
  interior_bathroom: 'Bathroom',
  amenity_gym: 'Gym',
  amenity_terrace: 'Terrace',
  amenity_garden: 'Garden',
  amenity_lobby: 'Lobby',
  amenity_pool: 'Pool',
  amenity_clubhouse: 'Clubhouse',
  amenity_other: 'Amenity',
  floor_plan: 'Floor Plan',
  site_plan: 'Site Plan',
  location_map: 'Location Map',
  lifestyle_family: 'Family Lifestyle',
  lifestyle_couple: 'Couple Lifestyle',
  lifestyle_individual: 'Individual Lifestyle',
  construction_progress: 'Construction Progress',
  walkthrough_still: 'Walkthrough Still',
  mood_reference: 'Mood/Inspiration Reference',
  other: 'Other',
};

// Maps a project_assets.asset_type to the same role_hint vocabulary QuickReferenceUploader
// uses, so buildReferenceManifest's instruction text stays consistent regardless of source.
export function projectAssetRoleHint(assetType: string): string {
  if (assetType === 'project_logo') return 'logo';
  if (assetType.startsWith('amenity_')) return 'amenity';
  if (assetType.startsWith('lifestyle_') || assetType === 'mood_reference') return 'lifestyle_mood';
  if (assetType.startsWith('hero_') || assetType.startsWith('interior_')) return 'project_image';
  return 'reference_design';
}

export function ProjectMediaPicker({
  projectId,
  orgId,
  selectedIds,
  onChange,
  heroId,
  onSetHero,
}: {
  projectId: string;
  orgId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  // Hero reference image feature: which selected asset (by id) is the hero —
  // its real pixels are edited-in-place (composition preserved) instead of
  // only being described in text. Optional so non-hero-aware callers don't break.
  heroId?: string | null;
  onSetHero?: (id: string | null) => void;
}) {
  const [assets, setAssets] = useState<ProjectMediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('project_assets')
      .select('id, asset_type, asset_url, title, description, is_primary')
      .eq('project_id', projectId)
      .eq('org_id', orgId)
      .order('is_primary', { ascending: false })
      .order('display_order');
    setAssets(data || []);
    setLoading(false);
  }

  function toggle(id: string) {
    const willDeselect = selectedIds.includes(id);
    if (willDeselect && onSetHero && heroId === id) onSetHero(null);
    onChange(willDeselect ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop();
      const filename = `${orgId}/${projectId}/mood_reference_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('brand-assets')
        .upload(`project-assets/${filename}`, file, { upsert: false });

      if (upErr) {
        setUploadError(`Upload failed: ${upErr.message}`);
        setUploading(false);
        return;
      }

      const { data: { publicUrl } } = supabase.storage.from('brand-assets').getPublicUrl(`project-assets/${filename}`);

      const { data: inserted, error: dbErr } = await supabase
        .from('project_assets')
        .insert({
          project_id: projectId,
          org_id: orgId,
          asset_type: 'mood_reference',
          asset_url: publicUrl,
          title: file.name.replace(/\.[^.]+$/, ''),
          is_primary: false,
          display_order: assets.length,
        })
        .select('id, asset_type, asset_url, title, description, is_primary')
        .single();

      if (dbErr || !inserted) {
        setUploadError(`Image uploaded but failed to save record: ${dbErr?.message ?? 'unknown error'}`);
        setUploading(false);
        return;
      }

      setAssets((prev) => [...prev, inserted]);
      onChange([...selectedIds, inserted.id]);
    }

    setUploading(false);
  }

  if (loading) {
    return <p className="text-xs text-text-tertiary">Loading project media…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-primary">Project Media (optional)</label>
        <span className="text-xs text-text-tertiary">{selectedIds.length} selected</span>
      </div>
      <p className="text-xs text-text-tertiary -mt-2">
        Tick the real project photos Aanya should ground this creative in — hero shots, interiors, amenities. Anything left unticked is ignored for this generation.
      </p>

      {assets.length === 0 ? (
        <p className="text-xs text-text-disabled">No project media uploaded yet. Add one below, or upload categorized assets from the project's Assets tab.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {assets.map((a) => {
            const selected = selectedIds.includes(a.id);
            const isHero = selected && onSetHero && heroId === a.id;
            return (
              <div key={a.id} className="relative">
                <button
                  type="button"
                  onClick={() => toggle(a.id)}
                  className={`relative aspect-square w-full rounded-lg overflow-hidden border-2 transition ${
                    isHero ? 'border-amber-400 ring-2 ring-amber-400/40' : selected ? 'border-brand ring-2 ring-brand/40' : 'border-border hover:border-border-strong'
                  }`}
                  title={a.title || ASSET_TYPE_LABELS[a.asset_type] || a.asset_type}
                >
                  <img src={a.asset_url} alt={a.title || a.asset_type} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[9px] px-1 py-0.5 truncate text-left">
                    {ASSET_TYPE_LABELS[a.asset_type] || a.asset_type}
                  </span>
                  {isHero && (
                    <span className="absolute top-1 left-1 text-amber-400 text-sm" title="Hero image">★</span>
                  )}
                  {selected && !isHero && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-brand text-white flex items-center justify-center">
                      <Check size={11} />
                    </span>
                  )}
                </button>
                {selected && onSetHero && (
                  <button
                    type="button"
                    onClick={() => onSetHero(isHero ? null : a.id)}
                    className={`mt-0.5 w-full text-[9px] font-medium ${isHero ? 'text-amber-400' : 'text-text-tertiary hover:text-amber-400'}`}
                  >
                    {isHero ? '★ Hero (keep as-is)' : '☆ Set as hero'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <label className="block">
        <div className={`border-2 border-dashed rounded p-3 text-center cursor-pointer transition text-xs ${uploading ? 'border-brand bg-brand-subtle text-brand' : 'border-border hover:border-brand hover:bg-brand-subtle text-text-tertiary'}`}>
          <Upload size={12} className="inline mr-1.5 -mt-0.5" />
          {uploading ? 'Uploading…' : 'Upload a new project photo'}
        </div>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
          onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
      </label>
      {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
    </div>
  );
}

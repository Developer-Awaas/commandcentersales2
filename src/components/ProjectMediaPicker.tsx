// src/components/ProjectMediaPicker.tsx
// Lets the user tick which already-uploaded Project Assets (or a fresh upload) this
// specific generation should be grounded in, instead of buildReferenceManifest blindly
// auto-selecting one hero/interior/amenity asset per category. Ticking a thumbnail IS
// the approval — selected assets are vision-described and injected into the prompt,
// untouched ones are ignored for this generation (they remain in Project Assets either way).

import { useEffect, useState } from 'react';
import { Upload, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { PhotoPanel, PanelSlot } from '../lib/reference-style';

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

/**
 * "Section 2 — pool", falling back to the bare number when the panel carries no
 * usable hint. 'other' is skipped deliberately: it means the vision pass could
 * not categorise the panel, and printing it would read as a category.
 */
export function panelOptionLabel(p: PhotoPanel): string {
  const hint = p.contentHint;
  return hint && hint !== 'other' ? `Section ${p.index} — ${hint}` : `Section ${p.index}`;
}

export function ProjectMediaPicker({
  projectId,
  orgId,
  selectedIds,
  onChange,
  heroId,
  onSetHero,
  panels,
  slots,
  onAssignSection,
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
  // Replicate mode, multi-panel references only. When supplied, each selected
  // tile's role dropdown becomes the section assignment itself, so the user
  // decides "where does THIS photo go" on the photo — rather than in a separate
  // panel that repeats the same photos a second time (V5's PhotoPanelAssigner).
  panels?: PhotoPanel[];
  slots?: PanelSlot[];
  onAssignSection?: (assetUrl: string, panelIndex: number | null) => void;
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

  // Inline assignment only replaces the plain role dropdown when there is
  // genuinely something to assign — a single-panel reference has exactly one
  // destination and the hero already fills it.
  const assignmentMode = !!panels && panels.length >= 2 && !!onAssignSection;
  const heroPanelIndex = slots?.find((s) => s.source === 'hero')?.panelIndex ?? null;
  /** Which section (if any) a given photo URL currently fills. */
  const sectionOf = (url: string): number | null =>
    slots?.find((s) => s.source === 'media' && s.mediaUrl === url)?.panelIndex ?? null;
  /** True when that binding was inferred by auto-match, not chosen. */
  const isSuggested = (url: string): boolean =>
    !!slots?.find((s) => s.source === 'media' && s.mediaUrl === url)?.suggested;

  function toggle(id: string) {
    const willDeselect = selectedIds.includes(id);
    const asset = assets.find((a) => a.id === id);
    if (willDeselect && onSetHero && heroId === id) onSetHero(null);
    // Deselecting a photo must release the section it held, or the slot keeps a
    // URL that is no longer in the payload and the directive's section→image
    // numbering silently shifts by one.
    if (willDeselect && onAssignSection && asset) onAssignSection(asset.asset_url, null);
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
                    assignmentMode && sectionOf(a.asset_url) !== null ? (
                      // Mirrors the numbered badge drawn over the reference, so
                      // "section 3" means the same thing in both places.
                      <span
                        className={`absolute top-1 right-1 w-4 h-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center ${
                          isSuggested(a.asset_url)
                            ? 'bg-sky-500/70 ring-1 ring-dashed ring-white/80'
                            : 'bg-sky-500'
                        }`}
                        title={isSuggested(a.asset_url)
                          ? `Suggested for section ${sectionOf(a.asset_url)} — change it if that's wrong`
                          : `Section ${sectionOf(a.asset_url)}`}
                      >
                        {sectionOf(a.asset_url)}
                      </span>
                    ) : (
                      <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-brand text-white flex items-center justify-center">
                        <Check size={11} />
                      </span>
                    )
                  )}
                </button>
                {selected && onSetHero && (
                  assignmentMode ? (
                    // Replicate, multi-panel: the tile IS the assignment control.
                    <select
                      value={isHero ? 'hero' : sectionOf(a.asset_url) !== null ? `panel:${sectionOf(a.asset_url)}` : 'additional'}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'hero') {
                          // Auto-bind: the ★ hero always takes the building panel,
                          // so the user never assigns it a section by hand.
                          onAssignSection!(a.asset_url, null);
                          onSetHero(a.id);
                          return;
                        }
                        if (heroId === a.id) onSetHero(null);
                        onAssignSection!(a.asset_url, v === 'additional' ? null : Number(v.slice(6)));
                      }}
                      className={`mt-0.5 w-full text-[9px] font-medium rounded bg-surface-sunken border px-1 py-0.5 ${
                        isHero ? 'text-amber-400 border-border'
                          : sectionOf(a.asset_url) !== null
                            ? (isSuggested(a.asset_url)
                                ? 'text-sky-300/80 border-dashed border-sky-500/50'
                                : 'text-sky-300 border-sky-500/50')
                          : 'text-text-tertiary border-border'
                      }`}
                      title="Which section of the reference this photo fills"
                    >
                      <option value="hero">★ Hero (the building)</option>
                      {panels!
                        .filter((p) => p.index !== heroPanelIndex)
                        .map((p) => (
                          <option key={p.index} value={`panel:${p.index}`}>{panelOptionLabel(p)}</option>
                        ))}
                      <option value="additional">Not used in a section</option>
                    </select>
                  ) : (
                    <select
                      value={isHero ? 'hero' : 'additional'}
                      onChange={(e) => onSetHero(e.target.value === 'hero' ? a.id : (heroId === a.id ? null : heroId ?? null))}
                      className={`mt-0.5 w-full text-[9px] font-medium rounded bg-surface-sunken border border-border px-1 py-0.5 ${isHero ? 'text-amber-400' : 'text-text-tertiary'}`}
                      title="Role for this generation"
                    >
                      <option value="hero">★ Hero (the building)</option>
                      <option value="additional">Additional media</option>
                    </select>
                  )
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

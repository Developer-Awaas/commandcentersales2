import { useEffect, useState } from 'react';
import { Download, ExternalLink, Package, ChevronDown, ChevronUp, RefreshCw, Upload, Info } from 'lucide-react';
import JSZip from 'jszip';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';

export interface ReferenceManifestItem {
  role: string;
  instruction: string;
  [key: string]: unknown;
}

interface ResolvedReference {
  role: string;
  instruction: string;
  primary: {
    url: string;
    filename: string;
    source: 'brand_kit' | 'project_assets' | 'quick_reference' | 'unresolved';
    description?: string;
    sessionStamp?: string;
  };
  alternatives: Array<{ url: string; filename: string; source: string; description?: string }>;
}

interface ReferenceImagePackProps {
  manifest: ReferenceManifestItem[];
  projectId?: string;
  promptLabel: string;
  onReplaceImage?: (manifestIndex: number, newUrl: string) => void;
}

const ROLE_TO_ASSET_TYPE_MAP: Record<string, string[]> = {
  BRAND_LOGO_COLOR: ['logo_color_url'],
  BRAND_LOGO_WHITE: ['logo_white_url'],
  BRAND_LOGO_DARK: ['logo_dark_url'],
  PROJECT_LOGO: ['project_logo'],
  PROJECT_HERO: ['hero_exterior', 'hero_night'],
  PROJECT_INTERIOR: ['interior_living', 'interior_kitchen', 'interior_bedroom', 'interior_bathroom'],
  AMENITY_GYM: ['amenity_gym'],
  AMENITY_TERRACE: ['amenity_terrace'],
  AMENITY_GARDEN: ['amenity_garden'],
  AMENITY_LOBBY: ['amenity_lobby'],
  AMENITY_POOL: ['amenity_pool'],
  AMENITY_CLUBHOUSE: ['amenity_clubhouse'],
  AMENITY_OTHER: ['amenity_other'],
  FLOOR_PLAN: ['floor_plan'],
  SITE_PLAN: ['site_plan'],
  LOCATION_MAP: ['location_map'],
  LIFESTYLE_MOOD: ['lifestyle_family', 'lifestyle_couple', 'lifestyle_individual', 'mood_reference'],
  LIFESTYLE_FAMILY: ['lifestyle_family'],
  LIFESTYLE_COUPLE: ['lifestyle_couple'],
  CONSTRUCTION_PROGRESS: ['construction_progress'],
  WALKTHROUGH_STILL: ['walkthrough_still'],
  CULTURAL_MOTIF: [],
  COMPETITOR_REF: [],
  USER_QUICK_REF: [],
};

function getExt(url: string): string {
  const match = url.match(/\.([a-z0-9]+)(\?|$)/i);
  return match ? match[1].toLowerCase() : 'png';
}

export default function ReferenceImagePack({ manifest, projectId, promptLabel, onReplaceImage }: ReferenceImagePackProps) {
  const orgId = getOrgId();
  const [resolved, setResolved] = useState<ResolvedReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [howToOpen, setHowToOpen] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  useEffect(() => {
    resolveManifest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, projectId]);

  async function resolveManifest() {
    setLoading(true);

    const [{ data: brandKit }, { data: projectAssetsRaw }] = await Promise.all([
      supabase.from('brand_kits').select('*').eq('org_id', orgId).maybeSingle(),
      projectId
        ? supabase
            .from('project_assets')
            .select('*')
            .eq('project_id', projectId)
            .order('is_primary', { ascending: false })
            .order('display_order')
        : Promise.resolve({ data: [] }),
    ]);

    const projectAssets = (projectAssetsRaw ?? []) as Record<string, unknown>[];

    const visualManifest = manifest.filter(
      (m) => !m.instruction?.toLowerCase().includes('text-only') && !m.role.includes('CULTURAL_MOTIF_TEXT')
    );

    const results: ResolvedReference[] = visualManifest.map((item) => {
      const upperRole = item.role.toUpperCase();
      const matchTypes = ROLE_TO_ASSET_TYPE_MAP[upperRole] ?? [];

      let primary: ResolvedReference['primary'] = {
        url: '',
        filename: `${upperRole}.png`,
        source: 'unresolved',
      };
      const alternatives: ResolvedReference['alternatives'] = [];

      if (upperRole.startsWith('BRAND_LOGO') && brandKit) {
        const colMap: Record<string, string> = {
          BRAND_LOGO_COLOR: 'logo_color_url',
          BRAND_LOGO_WHITE: 'logo_white_url',
          BRAND_LOGO_DARK: 'logo_dark_url',
        };
        const col = colMap[upperRole];
        const url = brandKit[col] as string | undefined;
        if (url) {
          primary = { url, filename: `${upperRole}.png`, source: 'brand_kit' };
        }
        ['logo_color_url', 'logo_white_url', 'logo_dark_url'].forEach((c) => {
          if (c !== col && brandKit[c]) {
            alternatives.push({
              url: brandKit[c] as string,
              filename: c.replace('_url', '') + '.png',
              source: 'brand_kit',
              description: c.replace('logo_', '').replace('_url', '') + ' version',
            });
          }
        });
      } else if (matchTypes.length > 0 && projectAssets.length > 0) {
        const matched = projectAssets.filter((a) => matchTypes.includes(a.asset_type as string));
        if (matched.length > 0) {
          const primaryAsset = (matched.find((m) => m.is_primary) ?? matched[0]) as Record<string, unknown>;
          const assetUrl = primaryAsset.asset_url as string;
          primary = {
            url: assetUrl,
            filename: `${upperRole}_${(primaryAsset.title as string) || 'image'}.${getExt(assetUrl)}`,
            source: 'project_assets',
            description: (primaryAsset.description as string) || (primaryAsset.title as string),
          };
          matched
            .filter((m) => m.id !== primaryAsset.id)
            .slice(0, 2)
            .forEach((alt) => {
              const altUrl = alt.asset_url as string;
              alternatives.push({
                url: altUrl,
                filename: `${upperRole}_alt_${(alt.title as string) || 'image'}.${getExt(altUrl)}`,
                source: 'project_assets',
                description: (alt.description as string) || (alt.title as string),
              });
            });
        }
      }

      return { role: item.role, instruction: item.instruction, primary, alternatives };
    });

    setResolved(results);
    setLoading(false);
  }

  async function downloadAsZip() {
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`NH_${promptLabel}_References`)!;

      folder.file(
        'README.txt',
        [
          `REFERENCE IMAGES FOR GEMINI / NANOBANANA`,
          `Prompt type: ${promptLabel}`,
          `Generated: ${new Date().toLocaleString()}`,
          ``,
          `HOW TO USE:`,
          `1. Open Gemini (gemini.google.com) or your Nanobanana access point`,
          `2. Paste the creative prompt from NH Command Center`,
          `3. Drag the numbered images below into the chat IN ORDER (1 first, 2 next, etc.)`,
          `4. The prompt references "Image 1", "Image 2" — they correspond to file numbers below`,
          `5. Click Generate`,
          ``,
          `IMAGES IN THIS PACK:`,
          ...resolved.map((r, i) => `${i + 1}. [${r.role}] — ${r.primary.description || r.primary.filename}`),
        ].join('\n')
      );

      for (let i = 0; i < resolved.length; i++) {
        const ref = resolved[i];
        if (ref.primary.source === 'unresolved' || !ref.primary.url) continue;
        try {
          const response = await fetch(ref.primary.url);
          const blob = await response.blob();
          folder.file(`${i + 1}_${ref.role}.${getExt(ref.primary.url)}`, blob);
        } catch (err) {
          console.error(`Failed to fetch image ${i + 1}:`, err);
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `NH_${promptLabel}_ReferencePack.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('ZIP download error:', err);
    } finally {
      setDownloadingZip(false);
    }
  }

  function downloadSingle(url: string, filename: string) {
    fetch(url)
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch((err) => console.error('Download failed:', err));
  }

  async function handleUserUpload(manifestIndex: number, file: File) {
    const sessionStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = file.name.split('.').pop();
    const path = `${orgId}/quickref_${sessionStamp}_${resolved[manifestIndex].role}.${ext}`;

    const { error } = await supabase.storage.from('quick-references').upload(path, file);
    if (error) {
      console.error('Upload failed:', error.message);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('quick-references').getPublicUrl(path);

    setResolved((prev) =>
      prev.map((r, i) =>
        i === manifestIndex
          ? {
              ...r,
              primary: {
                url: publicUrl,
                filename: file.name,
                source: 'quick_reference' as const,
                description: `User uploaded · ${sessionStamp.slice(0, 16)}`,
                sessionStamp,
              },
            }
          : r
      )
    );

    if (onReplaceImage) onReplaceImage(manifestIndex, publicUrl);
  }

  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 px-4 py-3 rounded-lg bg-surface-sunken border border-border">
        <RefreshCw size={13} className="text-text-tertiary animate-spin" />
        <span className="text-xs text-text-tertiary">Resolving reference images…</span>
      </div>
    );
  }

  if (resolved.length === 0) return null;

  const unresolvedCount = resolved.filter((r) => r.primary.source === 'unresolved').length;
  const hasAnyResolved = resolved.some((r) => r.primary.source !== 'unresolved');

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-elevated overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Package size={15} className="text-brand" />
          <div>
            <span className="text-sm font-semibold text-text-primary">Reference Pack — {promptLabel}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-text-tertiary">{resolved.length} image{resolved.length !== 1 ? 's' : ''} · Drag into Gemini in order shown</span>
              {unresolvedCount > 0 && (
                <span className="text-[10px] text-amber-400">{unresolvedCount} need upload</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadAsZip}
            disabled={downloadingZip || !hasAnyResolved}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-subtle border border-brand-border text-brand text-xs font-medium hover:bg-brand-subtle-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Package size={12} />
            {downloadingZip ? 'Zipping…' : 'Download ZIP'}
          </button>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors"
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* How to use */}
          <button
            onClick={() => setHowToOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-brand/80 hover:text-brand hover:bg-brand-subtle border-b border-border transition-colors text-left"
          >
            <Info size={11} />
            How to use these in Gemini
            {howToOpen ? <ChevronUp size={11} className="ml-auto" /> : <ChevronDown size={11} className="ml-auto" />}
          </button>
          {howToOpen && (
            <div className="px-4 py-3 bg-brand-subtle border-b border-border flex flex-col gap-1">
              {[
                <>1. Open <a href="https://gemini.google.com" target="_blank" rel="noreferrer" className="text-brand underline">Gemini</a> (or your Nanobanana access point)</>,
                '2. Paste the creative prompt shown above',
                <>3. Drag images <strong className="text-text-primary">1, 2, 3…</strong> into the chat <strong className="text-text-primary">in order</strong> — the prompt references "Image 1", "Image 2"</>,
                '4. For any image marked "needs upload" below, upload your own file and use the Replace button',
                '5. Click Generate. Iterate the prompt as needed.',
              ].map((step, i) => (
                <p key={i} className="text-[11px] text-text-tertiary leading-relaxed">{step}</p>
              ))}
            </div>
          )}

          {/* Image grid */}
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {resolved.map((ref, i) => (
              <ReferenceCard
                key={i}
                index={i}
                ref_={ref}
                getExt={getExt}
                onDownload={downloadSingle}
                onUpload={handleUserUpload}
                onSwapAlternative={(idx, alt) => {
                  setResolved((prev) =>
                    prev.map((r, ri) =>
                      ri === idx
                        ? { ...r, primary: { ...alt, source: alt.source as ResolvedReference['primary']['source'] } }
                        : r
                    )
                  );
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface ReferenceCardProps {
  index: number;
  ref_: ResolvedReference;
  getExt: (url: string) => string;
  onDownload: (url: string, filename: string) => void;
  onUpload: (index: number, file: File) => void;
  onSwapAlternative: (index: number, alt: ResolvedReference['alternatives'][0]) => void;
}

function ReferenceCard({ index, ref_, getExt, onDownload, onUpload, onSwapAlternative }: ReferenceCardProps) {
  const [altOpen, setAltOpen] = useState(false);
  const resolved = ref_.primary.source !== 'unresolved' && !!ref_.primary.url;

  return (
    <div className="flex gap-3 p-3 rounded-lg bg-surface-sunken border border-border">
      {/* Thumbnail */}
      <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-surface-sunken border border-border">
        {resolved ? (
          <img src={ref_.primary.url} alt={ref_.role} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#4a6558]">
            <Upload size={18} />
          </div>
        )}
        <div className="absolute top-0 left-0 bg-brand text-white text-[9px] font-bold px-1.5 py-0.5 rounded-br-md">
          #{index + 1}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono text-brand truncate">[{ref_.role}]</p>
        <p className="text-xs text-text-primary truncate mt-0.5">{ref_.primary.description || ref_.primary.filename}</p>

        {/* Source badge */}
        <div className="mt-1">
          {ref_.primary.source === 'brand_kit' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20">Brand Kit</span>
          )}
          {ref_.primary.source === 'project_assets' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-subtle text-brand border border-brand-border">Project Asset</span>
          )}
          {ref_.primary.source === 'quick_reference' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
              User upload{ref_.primary.sessionStamp ? ` · ${ref_.primary.sessionStamp.slice(0, 10)}` : ''}
            </span>
          )}
          {ref_.primary.source === 'unresolved' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30">Needs upload</span>
          )}
        </div>

        {/* Instruction */}
        <p className="text-[10px] text-[#4a6558] mt-1 leading-snug line-clamp-2 italic">{ref_.instruction}</p>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {resolved && (
            <>
              <button
                onClick={() => onDownload(ref_.primary.url, `${index + 1}_${ref_.role}.${getExt(ref_.primary.url)}`)}
                className="flex items-center gap-1 text-[11px] text-brand hover:text-[#4de8c0] transition-colors"
              >
                <Download size={10} /> Download
              </button>
              <a
                href={ref_.primary.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                <ExternalLink size={10} /> Open
              </a>
            </>
          )}
          <label className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer transition-colors">
            <RefreshCw size={10} />
            {resolved ? 'Replace' : 'Upload'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onUpload(index, e.target.files[0])}
            />
          </label>
        </div>

        {/* Alternatives */}
        {ref_.alternatives.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setAltOpen((o) => !o)}
              className="text-[10px] text-text-tertiary hover:text-text-primary transition-colors"
            >
              {ref_.alternatives.length} alternative{ref_.alternatives.length !== 1 ? 's' : ''} {altOpen ? '▴' : '▾'}
            </button>
            {altOpen && (
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                {ref_.alternatives.map((alt, ai) => (
                  <button
                    key={ai}
                    onClick={() => onSwapAlternative(index, alt)}
                    title={alt.description ?? 'Use this alternative'}
                    className="w-10 h-10 rounded-lg overflow-hidden border border-[#2a3f32] hover:border-[#2dd4a8] transition-colors flex-shrink-0"
                  >
                    <img src={alt.url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

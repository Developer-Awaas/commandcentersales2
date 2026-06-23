import { Palette, ImageIcon, RefreshCw, CheckCircle2 } from 'lucide-react';
import type { CreativeVariant } from '../contracts';

interface CreativeGridProps {
  creatives: CreativeVariant[];
  loading: boolean;
  // Set of variant ids the user has selected for approval.
  selectedIds: Set<string>;
  onRegenerate: (variant: CreativeVariant) => void;
  // Toggle selection of a single tile.
  onSelectToggle: (id: string) => void;
}

const ANGLE_LABELS: Record<string, string> = {
  value:     'Price-led',
  lifestyle: 'Lifestyle',
  amenity:   'Amenities',
};

export function CreativeGrid({ creatives, loading, selectedIds, onRegenerate, onSelectToggle }: CreativeGridProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Palette size={15} className="text-text-tertiary flex-shrink-0" />
        <p className="text-[13px] font-semibold text-text-primary">Creative Variants</p>
        <span className="text-[11px] text-text-tertiary">
          ({creatives.length} variants · {selectedIds.size} selected for approval)
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {creatives.map((creative) => (
          <CreativeTile
            key={creative.id}
            creative={creative}
            loading={loading}
            selected={selectedIds.has(creative.id)}
            onRegenerate={onRegenerate}
            onSelectToggle={onSelectToggle}
          />
        ))}
      </div>
    </div>
  );
}

function CreativeTile({
  creative, loading, selected, onRegenerate, onSelectToggle,
}: {
  creative: CreativeVariant;
  loading: boolean;
  selected: boolean;
  onRegenerate: (variant: CreativeVariant) => void;
  onSelectToggle: (id: string) => void;
}) {
  return (
    <div
      className={[
        'rounded-xl overflow-hidden border shadow-card group cursor-pointer transition-all',
        selected
          ? 'border-brand ring-2 ring-brand/20'
          : 'border-border hover:border-brand/40',
      ].join(' ')}
      onClick={() => onSelectToggle(creative.id)}
    >
      <div
        className="aspect-square flex flex-col items-center justify-center gap-2 relative"
        style={creative.image_url ? undefined : { background: creative.preview_color }}
      >
        {creative.image_url ? (
          <img src={creative.image_url} alt={creative.label} className="w-full h-full object-cover" />
        ) : (
          <>
            <ImageIcon size={24} className="text-white/40" />
            <span className="text-white/60 text-[11px] font-medium px-2 text-center leading-tight">
              {ANGLE_LABELS[creative.angle] ?? creative.angle}
            </span>
            <span className="absolute top-2 right-2 text-[9px] font-bold text-white/40 uppercase tracking-widest">
              Stub
            </span>
          </>
        )}

        {/* Selection checkmark — always visible when selected, hover-visible otherwise */}
        <div
          className={[
            'absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center transition-all',
            selected
              ? 'bg-brand text-white opacity-100'
              : 'bg-black/40 text-white/60 opacity-0 group-hover:opacity-100',
          ].join(' ')}
          onClick={e => { e.stopPropagation(); onSelectToggle(creative.id); }}
        >
          <CheckCircle2 size={12} />
        </div>

        {/* Regenerate — stop propagation so it doesn't toggle selection */}
        <button
          onClick={e => { e.stopPropagation(); onRegenerate(creative); }}
          disabled={loading}
          title="Regenerate this creative"
          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-0"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="px-3 py-2 bg-surface-elevated border-t border-border space-y-1.5">
        <p className="text-[12px] font-medium text-text-primary truncate">{creative.label}</p>

        {creative.copy && (
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold text-text-primary leading-tight">{creative.copy.headline}</p>
            <p className="text-[10px] text-text-secondary leading-snug line-clamp-2">{creative.copy.primary_text}</p>
            <p className="text-[10px] font-medium text-brand-text">{creative.copy.cta}</p>
          </div>
        )}

        {creative.rationale && (
          <p className="text-[10px] text-text-tertiary italic leading-snug">{creative.rationale}</p>
        )}

      </div>
    </div>
  );
}

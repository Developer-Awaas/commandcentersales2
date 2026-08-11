import { useMemo } from 'react';
import type { PhotoPanel, PanelSlot } from '../../lib/reference-style';
import { unresolvedPanels, panelPositionLabel } from '../../lib/reference-style';

/**
 * V5 — per-panel image assignment for replicate mode.
 *
 * Why it exists: RB-P10's photo-replacement rule told the model to fill "other
 * photo zones" from the images after the hero and to empty any it ran out of.
 * Verification showed the run-out→emptied-block half is a SOFT preference the
 * model ignores when it feels like it — it invented plausible amenity photos
 * instead (RB-P10 STEP 3, ai_single). Naming each panel and stating its fate
 * explicitly turns that preference into a per-slot instruction.
 *
 * Rendered only when >= 2 panels are detected; a single-panel or panel-less
 * reference keeps the previous flow untouched.
 */
export interface MediaOption {
  /** Stable id (project_assets.id) — used as the <option> key. */
  id: string;
  url: string;
  label: string;
}

interface Props {
  previewUrl: string;
  panels: PhotoPanel[];
  slots: PanelSlot[];
  mediaOptions: MediaOption[];
  /** Total panel count, user-overridable when the vision pass miscounts. */
  onCountChange: (next: number) => void;
  onSlotChange: (panelIndex: number, next: PanelSlot) => void;
}

const SHAPE_LABEL: Record<PhotoPanel['shapeHint'], string> = {
  rect: 'rectangle',
  circle: 'circular',
  wedge: 'wedge',
  diagonal: 'diagonal',
};

const positionLabel = panelPositionLabel;

export default function PhotoPanelAssigner({
  previewUrl, panels, slots, mediaOptions, onCountChange, onSlotChange,
}: Props) {
  const pending = useMemo(() => unresolvedPanels(slots), [slots]);
  const slotFor = (index: number) => slots.find((s) => s.panelIndex === index);

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">
          Photo sections detected
        </p>
        {/* Editable stepper: the vision pass can miscount panels (merged strips,
            missed insets). The user is the authority, not the model. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCountChange(Math.max(1, panels.length - 1))}
            className="w-6 h-6 rounded border border-border text-text-secondary hover:bg-surface-2 disabled:opacity-40"
            disabled={panels.length <= 1}
            aria-label="One fewer photo section"
          >−</button>
          <span className="text-sm tabular-nums text-text-primary w-5 text-center">{panels.length}</span>
          <button
            type="button"
            onClick={() => onCountChange(Math.min(8, panels.length + 1))}
            className="w-6 h-6 rounded border border-border text-text-secondary hover:bg-surface-2 disabled:opacity-40"
            disabled={panels.length >= 8}
            aria-label="One more photo section"
          >+</button>
        </div>
      </div>

      {/* Reference thumbnail with a numbered badge pinned over each panel. */}
      <div className="relative inline-block self-start rounded-lg overflow-hidden border border-border max-w-[260px]">
        <img src={previewUrl} alt="Reference layout" className="block w-full h-auto" />
        {panels.map((p) => (
          <span
            key={p.index}
            className="absolute flex items-center justify-center w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500 text-white text-xs font-bold shadow ring-2 ring-white/70"
            style={{
              left: `${(p.bbox[0] + p.bbox[2] / 2) * 100}%`,
              top: `${(p.bbox[1] + p.bbox[3] / 2) * 100}%`,
            }}
            title={`Section ${p.index} — ${SHAPE_LABEL[p.shapeHint]}, ${positionLabel(p)}`}
          >
            {p.index}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {panels.map((p) => {
          const slot = slotFor(p.index);
          const isHero = slot?.source === 'hero';
          return (
            <div key={p.index} className="flex items-center gap-2 text-xs">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-500/20 text-sky-300 font-bold shrink-0">
                {p.index}
              </span>
              <span className="text-text-tertiary w-28 shrink-0">
                {positionLabel(p)} · {SHAPE_LABEL[p.shapeHint]}
              </span>
              {isHero ? (
                // Slot 1 auto-binds the ★ hero, but stays rebindable — the
                // vision pass's is_building guess is a guess.
                <select
                  value="hero"
                  onChange={(e) => onSlotChange(p.index, {
                    panelIndex: p.index,
                    source: e.target.value === 'hero' ? 'hero' : e.target.value === 'empty' ? 'empty' : 'media',
                    mediaUrl: e.target.value.startsWith('http') ? e.target.value : undefined,
                  })}
                  className="flex-1 bg-surface-2 border border-border rounded px-2 py-1 text-text-primary"
                >
                  <option value="hero">★ Hero — the building</option>
                  <option value="empty">Leave empty</option>
                  {mediaOptions.map((m) => <option key={m.id} value={m.url}>{m.label}</option>)}
                </select>
              ) : (
                <select
                  value={slot?.source === 'empty' ? 'empty' : slot?.mediaUrl ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    onSlotChange(p.index, {
                      panelIndex: p.index,
                      source: v === '' ? 'unassigned' : v === 'empty' ? 'empty' : v === 'hero' ? 'hero' : 'media',
                      mediaUrl: v.startsWith('http') ? v : undefined,
                    });
                  }}
                  className={`flex-1 bg-surface-2 border rounded px-2 py-1 text-text-primary ${
                    slot?.source === 'unassigned' ? 'border-amber-500/60' : 'border-border'
                  }`}
                >
                  <option value="">— choose —</option>
                  <option value="empty">Leave empty (blank design block)</option>
                  <option value="hero">★ Hero — the building</option>
                  {mediaOptions.map((m) => <option key={m.id} value={m.url}>{m.label}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>

      {pending.length > 0 ? (
        <p className="text-[11px] text-amber-400">
          {pending.length} {pending.length === 1 ? 'section' : 'sections'} unassigned
          {' '}(#{pending.join(', #')}) — every section needs an image or “leave empty” before you can generate.
        </p>
      ) : (
        <p className="text-[11px] text-emerald-400">All sections assigned.</p>
      )}
      {mediaOptions.length === 0 && (
        <p className="text-[11px] text-text-tertiary">
          No project photos selected yet — pick some above to assign them, or mark sections “leave empty”.
        </p>
      )}
    </div>
  );
}

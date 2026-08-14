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
 * P2.13 — this is no longer where assignment HAPPENS. Choosing which photo
 * fills a section now lives on the photo itself, in ProjectMediaPicker's tile
 * dropdown: the user picks the destination while looking at the image, instead
 * of re-identifying it from a filename in a second list that repeated every
 * thumbnail already on screen. What remains here is the half a tile cannot do:
 *   - the numbered map, so "Section 3" has a visible location on the reference;
 *   - a count stepper, because the vision pass can miscount panels;
 *   - "leave empty" for sections no photo was assigned to — the one decision
 *     with no tile to hang off, and the one the gate blocks on.
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
  const labelForUrl = (url?: string) => mediaOptions.find((m) => m.url === url)?.label ?? 'selected photo';

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
        {panels.map((p) => {
          const s = slotFor(p.index);
          const resolved = s && s.source !== 'unassigned';
          return (
            <span
              key={p.index}
              className={`absolute flex items-center justify-center w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full text-white text-xs font-bold shadow ring-2 ring-white/70 ${
                resolved ? 'bg-sky-500' : 'bg-amber-500'
              }`}
              style={{
                left: `${(p.bbox[0] + p.bbox[2] / 2) * 100}%`,
                top: `${(p.bbox[1] + p.bbox[3] / 2) * 100}%`,
              }}
              title={`Section ${p.index} — ${SHAPE_LABEL[p.shapeHint]}, ${positionLabel(p)}`}
            >
              {p.index}
            </span>
          );
        })}
      </div>

      {/* Status per section. Assignment happens on the photo tiles above; the
          only control here is the one a tile can't express — "leave empty". */}
      <div className="flex flex-col gap-1.5">
        {panels.map((p) => {
          const slot = slotFor(p.index);
          const source = slot?.source ?? 'unassigned';
          return (
            <div key={p.index} className="flex items-center gap-2 text-xs">
              <span className={`flex items-center justify-center w-5 h-5 rounded-full font-bold shrink-0 ${
                source === 'unassigned' ? 'bg-amber-500/20 text-amber-300' : 'bg-sky-500/20 text-sky-300'
              }`}>
                {p.index}
              </span>
              <span className="text-text-tertiary w-28 shrink-0">
                {positionLabel(p)} · {SHAPE_LABEL[p.shapeHint]}
              </span>
              {source === 'hero' && <span className="text-amber-400 flex-1">★ Hero — the building</span>}
              {source === 'media' && <span className="text-sky-300 flex-1">{labelForUrl(slot?.mediaUrl)}</span>}
              {source === 'empty' && (
                <span className="flex-1 flex items-center gap-2 text-text-tertiary">
                  Left empty (blank design block)
                  <button
                    type="button"
                    onClick={() => onSlotChange(p.index, { panelIndex: p.index, source: 'unassigned' })}
                    className="underline hover:text-text-secondary"
                  >undo</button>
                </span>
              )}
              {source === 'unassigned' && (
                <span className="flex-1 flex items-center gap-2">
                  <span className="text-amber-400">No photo assigned</span>
                  <button
                    type="button"
                    onClick={() => onSlotChange(p.index, { panelIndex: p.index, source: 'empty' })}
                    className="px-1.5 py-0.5 rounded border border-border text-text-secondary hover:bg-surface-2"
                  >Leave empty</button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {pending.length > 0 ? (
        <p className="text-[11px] text-amber-400">
          {pending.length} {pending.length === 1 ? 'section' : 'sections'} unassigned
          {' '}(#{pending.join(', #')}) — assign a photo above, or mark it “leave empty”, before generating.
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

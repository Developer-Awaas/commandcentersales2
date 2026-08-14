import { useState } from 'react';
import { X } from 'lucide-react';
import { Card } from './ui/Card';
import { submitReview, requestReviewIngest, type ReviewRatings, type ReviewSubjectType } from '../lib/review-service';
import type { AdPlatform } from '../lib/ad-platform';
import { adPlatformLabel } from '../lib/ad-platform';

/**
 * RB-P2 / P2.13 PART D — the review prompt, shared by the strategy-save and
 * Canva-return flows.
 *
 * NON-BLOCKING, always. It appears after the work has already been saved, and
 * Skip is a first-class action sitting right next to Submit — not a small
 * dismiss in a corner. A reviewer who feels trapped either stops saving
 * strategies or types whatever clears the dialog fastest, and both outcomes
 * are worse than no review at all.
 *
 * Sections are capped at 5 rows because this is shown mid-task: a reviewer
 * asked for fifteen scores gives fifteen 4s.
 */
const MAX_SECTIONS = 5;

export interface ReviewSection {
  /** Stable key stored in review_events.ratings. */
  key: string;
  label: string;
}

interface Props {
  open: boolean;
  subjectType: ReviewSubjectType;
  subjectId: string | null;
  projectId?: string | null;
  strategyType?: string | null;
  platform?: AdPlatform | null;
  projectName?: string | null;
  sections: ReviewSection[];
  /** "What did you change to make it market-ready?" — creative flow only. */
  askEditSummary?: boolean;
  /** Layer-op history from the mini-editor, when the creative was edited in-app. */
  editorOps?: unknown;
  onClose: () => void;
}

function StarRow({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n === value ? 0 : n)}
          className={`text-lg leading-none transition ${n <= value ? 'text-amber-400' : 'text-border hover:text-text-tertiary'}`}
          aria-label={`${n} out of 5`}
          aria-pressed={n === value}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function ReviewPopup({
  open, subjectType, subjectId, projectId, strategyType, platform, projectName,
  sections, askEditSummary, editorOps, onClose,
}: Props) {
  const [ratings, setRatings] = useState<ReviewRatings>({});
  const [improvementText, setImprovementText] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const capped = sections.slice(0, MAX_SECTIONS);

  async function handleSubmit() {
    setSaving(true);
    // submitReview never throws (see review-service) — the popup must close
    // whatever happens, or a failed review traps the user on finished work.
    const ok = await submitReview({
      subjectType, subjectId, projectId, strategyType, platform,
      ratings, improvementText, editSummary, editorOps,
    });
    if (ok) void requestReviewIngest(subjectType, subjectId);
    setSaving(false);
    onClose();
  }

  const header = [
    strategyType,
    platform ? adPlatformLabel(platform) : null,
    projectName,
  ].filter(Boolean).join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {subjectType === 'creative' ? 'How did this creative do?' : 'How was this strategy?'}
            </p>
            {/* Auto-derived — the reviewer never retypes what the app knows. */}
            {header && <p className="text-[11px] text-text-tertiary mt-0.5">{header}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary shrink-0"
            aria-label="Close without reviewing"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {capped.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-text-secondary">{s.label}</span>
              <StarRow
                value={ratings[s.key] ?? 0}
                onChange={(n) => setRatings((prev) => {
                  const next = { ...prev };
                  if (n === 0) delete next[s.key]; else next[s.key] = n;
                  return next;
                })}
              />
            </div>
          ))}
        </div>

        {askEditSummary && (
          <div>
            <label className="text-[11px] font-medium text-text-tertiary block mb-1">
              What did you change to make it market-ready?
            </label>
            <textarea
              rows={2}
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              placeholder="e.g. moved the price block off the building, swapped the CTA, fixed the logo size"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand resize-y"
            />
          </div>
        )}

        <div>
          <label className="text-[11px] font-medium text-text-tertiary block mb-1">
            {subjectType === 'creative' ? 'Anything else worth noting?' : 'What would have made it better?'}
          </label>
          <textarea
            rows={2}
            value={improvementText}
            onChange={(e) => setImprovementText(e.target.value)}
            placeholder="Optional"
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand resize-y"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {/* Skip is a peer of Submit, not a hidden dismiss — see the note above. */}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:bg-surface-2"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-lg bg-brand text-white font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Submit review'}
          </button>
        </div>
      </Card>
    </div>
  );
}

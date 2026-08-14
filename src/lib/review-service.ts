// src/lib/review-service.ts
//
// RB-P2 / P2.13 PART D — capture human review of generated work.
//
// review_events is INSERT-only from the client (no SELECT policy, no
// management UI): reviews are raw signal for ingest-review to aggregate
// server-side, not content anyone browses. See migration 20260814130000.

import { supabase } from './supabase';
import { getOrgId, getUserId } from './constants';
import type { AdPlatform } from './ad-platform';

export type ReviewSubjectType = 'strategy' | 'creative';

/** Per-section 1-5 scores, e.g. { headline: 4, targeting: 5 }. */
export type ReviewRatings = Record<string, number>;

export interface ReviewEventInput {
  subjectType: ReviewSubjectType;
  subjectId: string | null;
  projectId?: string | null;
  strategyType?: string | null;
  platform?: AdPlatform | null;
  ratings: ReviewRatings;
  improvementText?: string | null;
  editSummary?: string | null;
  editorOps?: unknown;
}

/** Ratings are 1-5; anything else is dropped rather than stored as noise. */
function sanitizeRatings(ratings: ReviewRatings): ReviewRatings {
  const out: ReviewRatings = {};
  for (const [k, v] of Object.entries(ratings)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 5) out[k] = Math.round(v);
  }
  return out;
}

/**
 * Insert one review. Resolves to false on failure rather than throwing.
 *
 * Deliberate: every caller is a popup the user reached by finishing real work
 * (saving a strategy, returning from Canva). A review is a nice-to-have; the
 * work is not. Throwing here would surface a scary error on a flow that
 * actually succeeded, and could unmount the caller mid-save. Failures are
 * logged and swallowed — the same "best-effort, never fails the save" rule
 * history-service already applies to retention sweeps.
 */
export async function submitReview(input: ReviewEventInput): Promise<boolean> {
  const ratings = sanitizeRatings(input.ratings);

  // Nothing to learn from an entirely blank submission — don't spend a row.
  const hasSignal =
    Object.keys(ratings).length > 0 ||
    !!input.improvementText?.trim() ||
    !!input.editSummary?.trim();
  if (!hasSignal) return false;

  const { error } = await supabase.from('review_events').insert({
    org_id: getOrgId(),
    project_id: input.projectId ?? null,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    strategy_type: input.strategyType ?? null,
    platform: input.platform ?? null,
    ratings,
    improvement_text: input.improvementText?.trim() || null,
    edit_summary: input.editSummary?.trim() || null,
    editor_ops: input.editorOps ?? null,
    created_by: getUserId(),
  });

  if (error) {
    // Per bug #47/#48: a wrong column name here would NOT throw — PostgREST
    // returns it in `error` and .insert() resolves normally. Logging the real
    // message is the only way that surfaces at all.
    console.warn('[review-service] submitReview failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Ask ingest-review to fold this org's new reviews into the training set.
 * Fire-and-forget: the popup closes either way, and a failed aggregation is
 * retried by the next call rather than blocking the user.
 */
export async function requestReviewIngest(subjectType: ReviewSubjectType, subjectId: string | null): Promise<void> {
  try {
    await supabase.functions.invoke('ingest-review', {
      body: { subject_type: subjectType, subject_id: subjectId },
    });
  } catch (err) {
    console.warn('[review-service] ingest-review invoke failed:', err);
  }
}

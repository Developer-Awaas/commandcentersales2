// src/lib/review-sections.ts
//
// RB-P2 / P2.13 PART D — which sections a reviewer is asked to score.
//
// Derived from the output that was actually generated, never a fixed list.
// Asking someone to rate "Icebreakers" on a strategy that produced none
// teaches them the form is boilerplate, and the 4 they type to clear it is
// then indistinguishable from a real 4.
//
// Capped at 5 by ReviewPopup (MAX_SECTIONS) — this returns candidates in
// priority order and lets the popup take the top slice.

import type { ReviewSection } from '../components/ReviewPopup';

/**
 * Candidate strategy sections, most-important first, filtered to those the
 * result actually contains. Key names are stable — they become the object
 * keys in review_events.ratings, so renaming one silently forks the history.
 */
const STRATEGY_CANDIDATES: { key: string; label: string; present: (d: Record<string, unknown>) => boolean }[] = [
  { key: 'concept', label: 'Overall concept', present: () => true },
  { key: 'headline', label: 'Headline', present: (d) => hasAny(d, ['headline', 'ad_copy', 'ad']) },
  { key: 'ad_copy', label: 'Ad copy / primary text', present: (d) => hasAny(d, ['ad_copy', 'primary_text', 'ad']) },
  { key: 'targeting', label: 'Targeting', present: (d) => hasAny(d, ['targeting', 'locations', 'audience']) },
  { key: 'image_brief', label: 'Image brief', present: (d) => hasAny(d, ['nanobanana_prompt_main', 'image_brief', 'visual_anchor']) },
  { key: 'budget', label: 'Budget & bidding', present: (d) => hasAny(d, ['budget', 'dailyBudget', 'bidStrategy']) },
];

function hasAny(data: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => {
    const v = data[k];
    return v !== undefined && v !== null && v !== '';
  });
}

export function strategyReviewSections(data: Record<string, unknown> | null | undefined): ReviewSection[] {
  const d = data ?? {};
  return STRATEGY_CANDIDATES.filter((c) => c.present(d)).map(({ key, label }) => ({ key, label }));
}

/**
 * Creative review is two fixed questions, not a derived list.
 *
 * strategy-fit carries the linked strategy_type in its label so the reviewer
 * is scoring "did this serve THIS brief", not a vague sense of quality — the
 * same creative can be excellent and wrong for the strategy that asked for it.
 */
export function creativeReviewSections(strategyType?: string | null): ReviewSection[] {
  const brief = (strategyType ?? '').trim().replace(/_/g, ' ');
  return [
    { key: 'strategy_fit', label: brief ? `Fit for the "${brief}" brief` : 'Fit for the strategy' },
    { key: 'text_quality', label: 'Text quality (copy, legibility, placement)' },
  ];
}

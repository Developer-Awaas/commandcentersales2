/**
 * One rule: stored hashtags carry NO leading '#'. The UI is the sole owner of
 * that character.
 *
 * The bug this fixes: the model returns tags already prefixed ('#Patia'), and
 * every render site prepends its own, so the app displayed '##Patia' and the
 * "Copy All" button produced '##Patia' too — pasted straight into a caption,
 * that is a dead tag, not a typo.
 *
 * Stripping at the render site instead would leave the DB holding a mix of
 * '#Patia' and 'Patia' forever, and every future consumer would need to know
 * which it got. So the strip happens ONCE, at the ingest boundary where model
 * output first becomes app state, and everything downstream — smm_calendar
 * rows, tool_outputs payloads, captions — sees one canonical shape.
 */

/**
 * Normalises whatever the model returned into canonical, un-prefixed tags.
 *
 * Tolerates the shapes an LLM actually emits: a real array, a single
 * space- or comma-separated string, stray empties, repeated '#', and
 * case-variant duplicates.
 */
export function normalizeHashtags(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.map((h) => String(h ?? ''))
    // A model told to return a list sometimes returns "#a #b, #c" instead.
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    // Repeated '#' collapses too — '##Patia' is a tag that already went
    // through a buggy round trip, and must not survive a second one.
    const tag = item.trim().replace(/^#+/, '').trim();
    if (!tag) continue;
    // Dedupe case-insensitively: Instagram treats #Patia and #patia as one
    // tag, so showing both just wastes caption budget.
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Render/copy helper — the one place '#' is added back. */
export function formatHashtags(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(' ');
}

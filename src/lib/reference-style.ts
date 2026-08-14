// Reference-image STYLE extraction model + prompt composition (CC-P5 Step 4).
//
// Structured-text conditioning: a user-supplied reference image is reduced to
// palette + layout structure + text treatment ONLY (never its subject/content),
// and injected as prose into the existing text-to-image prompt alongside the
// project's OWN media descriptions + logo. The image model (generate-image) is
// unchanged — it still receives only a text prompt. See CLAUDE.md CC-P5 Step 4.

export interface ReferenceAnalysis {
  /** Hex color values extracted from the reference (e.g. ['#0A2540', '#F5F5F5']). */
  palette: string[];
  /** Structural description of where text vs. imagery sits (layout zones). */
  layout: string;
  /** Typography / text styling notes (weight, case, placement of copy). */
  text_treatment: string;
  /**
   * Which reference mode this analysis serves (RB-P0 consolidation — one shape,
   * two modes):
   *  - 'style_hints'      CC-P5 text-to-image conditioning — palette/layout/text
   *                       inform a composed prompt, no subject carry-over.
   *  - 'replicate_layout' Strategy replicate path — image-to-image edit; the
   *                       reference LAYOUT is copied and the building swapped.
   *                       Photo-zone extraction (what Rung 2 masks will consume)
   *                       is DEFERRED; today this only records intent.
   * Absent = legacy analysis, treated as 'style_hints' (see referenceMode()).
   */
  mode?: 'style_hints' | 'replicate_layout';
  /** replicate_layout only: located text/photo/logo zones for the overlay composite. */
  zones?: ReferenceZone[];
}

/** Resolve the mode, defaulting legacy (mode-less) analyses to 'style_hints'. */
export function referenceMode(a: ReferenceAnalysis): 'style_hints' | 'replicate_layout' {
  return a.mode ?? 'style_hints';
}

export type ZoneRole =
  | 'headline' | 'subheadline' | 'price' | 'cta'
  | 'badge' | 'checklist' | 'logo' | 'photo' | 'footer' | 'other';

/**
 * A single layout zone located by the vision pass (replicate_layout mode).
 * bbox is NORMALIZED [x, y, w, h] in 0..1, top-left origin — resolution-agnostic
 * so it maps onto any output size. fontScale = approx cap-height as a fraction
 * of image height (0 for photo/logo). Consumed by buildLayersFromZones().
 */
export interface ReferenceZone {
  role: ZoneRole;
  bbox: [number, number, number, number];
  align: 'left' | 'center' | 'right';
  fontScale: number;
  weight: 'normal' | 'bold';
  color: string;
}

/**
 * A distinct PHOTO section of the reference layout (V5). Separate from
 * ReferenceZone's 'photo' role because assignment needs more than a box: the
 * shape drives how the model must crop into it (a wedge/circle crop reads very
 * differently from a rect), and `index` is a stable, user-visible handle that
 * the badge overlay, the slot list, and the generation directive all agree on.
 *
 * `index` is 1-based and assigned in READING ORDER (top-left → bottom-right)
 * by orderPhotoPanels — never trust the vision pass's own ordering.
 */
export interface PhotoPanel {
  index: number;
  bbox: [number, number, number, number];
  shapeHint: 'rect' | 'circle' | 'wedge' | 'diagonal';
  approxArea: number;
  /** The vision pass's guess at which panel holds the main building shot. */
  isBuilding?: boolean;
  /**
   * What this panel DEPICTS — never what should be assigned to it. The vision
   * pass reports a fact; autoMatchSlots owns the decision. Keeping that line
   * sharp is what makes the matching logic testable without a model.
   *
   * A closed enum, not free text: "azure aquatic amenity" turns matching into
   * a fuzzy-string problem, whereas an enum makes it a lookup. Emitted by the
   * SAME vision call that returns the panels — no extra spend. Absent on
   * references analysed before this existed, which simply means no auto-match.
   */
  contentHint?: PanelContentHint;
}

/**
 * Closed vocabulary for panel content. 'other' is the honest bucket for a
 * wedge the model genuinely cannot categorise — it never auto-matches, because
 * "I don't know" must not resolve to a binding.
 */
export const PANEL_CONTENT_HINTS = [
  'building', 'pool', 'gym', 'interior', 'clubhouse',
  'garden', 'terrace', 'lobby', 'playground', 'other',
] as const;

export type PanelContentHint = typeof PANEL_CONTENT_HINTS[number];

export function isPanelContentHint(x: unknown): x is PanelContentHint {
  return typeof x === 'string' && (PANEL_CONTENT_HINTS as readonly string[]).includes(x);
}

const SHAPE_HINTS = ['rect', 'circle', 'wedge', 'diagonal'] as const;

export function isValidPhotoPanel(x: unknown): x is PhotoPanel {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.bbox) || o.bbox.length !== 4) return false;
  if (!o.bbox.every((n) => typeof n === 'number' && n >= -0.05 && n <= 1.05)) return false;
  return (SHAPE_HINTS as readonly string[]).includes(o.shapeHint as string);
}

/**
 * Reading order: top-left → bottom-right, with a row tolerance so panels whose
 * tops differ by a few pixels still count as the same row and sort by x. Without
 * the tolerance, a side-by-side pair with a 1% vertical offset would number
 * top-to-bottom and the badges would disagree with how a human reads the ad.
 * Re-indexes 1..N; the input's own index field is ignored.
 */
export function orderPhotoPanels(panels: PhotoPanel[], rowTolerance = 0.08): PhotoPanel[] {
  return [...panels]
    .sort((a, b) => {
      const dy = a.bbox[1] - b.bbox[1];
      if (Math.abs(dy) > rowTolerance) return dy;
      return a.bbox[0] - b.bbox[0];
    })
    .map((p, i) => ({ ...p, index: i + 1, bbox: clampBbox(p.bbox) }));
}

/**
 * Human/model-readable position ("top-left", "middle-centre"). Shared by the
 * assignment UI and the generation directive on purpose: the badge the user
 * clicks and the section the model is told about must be described identically,
 * or a misassignment becomes impossible to diagnose from either side.
 */
export function panelPositionLabel(p: PhotoPanel): string {
  const [x, y, w, h] = p.bbox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const v = cy < 0.34 ? 'top' : cy > 0.66 ? 'bottom' : 'middle';
  const hz = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'centre';
  return `${v}-${hz}`;
}

/** Largest panel, preferring one the vision pass tagged as the building. */
export function primaryPanelIndex(panels: PhotoPanel[]): number | null {
  if (!panels.length) return null;
  const tagged = panels.filter((p) => p.isBuilding);
  const pool = tagged.length ? tagged : panels;
  return pool.reduce((best, p) => (p.approxArea > best.approxArea ? p : best), pool[0]).index;
}

/**
 * What the user bound to one detected panel. 'unassigned' is a real state, not a
 * placeholder — Generate stays disabled while any slot is in it, because an
 * unassigned panel is precisely the case where the model previously invented an
 * amenity photo (RB-P10's soft run-out rule). 'empty' is an explicit, positive
 * choice to render a blank design block there.
 */
export type PanelSlotSource = 'hero' | 'media' | 'empty' | 'unassigned';

export interface PanelSlot {
  panelIndex: number;
  source: PanelSlotSource;
  /** Set only when source === 'media'. */
  mediaUrl?: string;
  /**
   * True when autoMatchSlots inferred this binding rather than the user
   * choosing it. Drives the "suggested" badge — the user must be able to tell
   * what was inferred from what they decided, or an auto-match is
   * indistinguishable from their own intent when they scan the form.
   * Cleared the moment they pick something themselves.
   */
  suggested?: boolean;
}

/** Slot 1..N with the primary/building panel pre-bound to the ★ hero. */
export function buildDefaultSlots(panels: PhotoPanel[], heroPanelIndex?: number | null): PanelSlot[] {
  const hero = heroPanelIndex ?? primaryPanelIndex(panels);
  return panels.map((p) => ({
    panelIndex: p.index,
    source: p.index === hero ? ('hero' as const) : ('unassigned' as const),
  }));
}

/**
 * Which replicate-mode explanation the form should show.
 *
 * The old copy was written for one case and shown in all of them: it promised
 * the user's photos would "replace the reference's OTHER photo zones" and
 * nudged them to select more, on references that have no other photo zones at
 * all. On a single-panel reference that is not a hint, it is a false statement
 * about what the generation will do — and the nudge asks for photos that have
 * nowhere to go.
 *
 * 'pending' is distinct from 'single' on purpose: before detection returns,
 * nothing is known, and guessing "single" would show the hero-only promise to
 * someone whose reference turns out to have four panels.
 */
export type ReplicateCaptionState = 'pending' | 'single' | 'multi';

export function replicateCaptionState(
  panels: PhotoPanel[] | undefined,
  detecting: boolean,
): ReplicateCaptionState {
  // A failed analysis also lands here as [] — same user-visible truth ("no
  // sections to assign"), and the 'single' copy is correct for both.
  if (detecting || panels === undefined) return 'pending';
  return panels.length >= 2 ? 'multi' : 'single';
}

/** A selected project photo, as the assignment UI sees it. */
export interface MediaTile {
  id: string;
  url: string;
  /** project_assets.asset_type, e.g. 'amenity_pool', 'interior_living'. */
  assetType: string;
  /** Human label as shown on the tile, e.g. 'Rooftop pool'. Free text. */
  label?: string;
}

/**
 * Media label → the SAME closed vocabulary the vision pass emits.
 *
 * Both sides have to speak one language before matching is a lookup rather
 * than a guess. Tile text is free-form — 'amenity_pool', 'Rooftop pool',
 * 'Hero Exterior (day)' — so this is the one place the two vocabularies meet.
 *
 * Order matters: the first pattern that matches wins, so the specific
 * ('clubhouse') is listed before anything that would also catch it ('club').
 * Anything unmapped returns null and therefore never auto-matches.
 */
const LABEL_PATTERNS: [PanelContentHint, string[]][] = [
  ['pool', ['pool', 'swim']],
  ['gym', ['gym', 'fitness', 'workout', 'treadmill']],
  ['clubhouse', ['clubhouse', 'club house', 'club']],
  ['playground', ['playground', 'play area', 'kids', 'children']],
  ['terrace', ['terrace', 'rooftop', 'roof top', 'deck', 'balcony']],
  ['garden', ['garden', 'lawn', 'park', 'landscape']],
  ['lobby', ['lobby', 'reception', 'foyer', 'entrance']],
  ['interior', ['interior', 'living', 'kitchen', 'bedroom', 'bathroom', 'dining']],
  ['building', ['building', 'exterior', 'facade', 'elevation', 'tower']],
];

/**
 * Normalise a photo's asset_type + label into the panel vocabulary.
 * Case-insensitive substring match; unmapped → null (no auto-match).
 * Deterministic and model-free, so the matching side is fully unit-testable.
 */
export function normalizeMediaHint(tile: Pick<MediaTile, 'assetType' | 'label'>): PanelContentHint | null {
  const hay = `${tile.assetType ?? ''} ${tile.label ?? ''}`.toLowerCase().replace(/_/g, ' ');
  if (!hay.trim()) return null;
  for (const [hint, needles] of LABEL_PATTERNS) {
    if (needles.some((n) => hay.includes(n))) return hint;
  }
  return null;
}

/**
 * Pre-bind slots from the detected panels and the photos the user selected.
 *
 * CONFIDENCE DISCIPLINE — a panel is auto-assigned only when the pairing is
 * unambiguous in BOTH directions: exactly one selected photo carries that
 * hint, AND exactly one panel wants it. Two pool photos for one pool wedge is
 * ambiguous; so is one pool photo for two pool wedges, where "first panel
 * wins" would be an arbitrary choice wearing the same badge as a real match.
 * Either way the panel is left open.
 *
 * A wrong silent guess costs more trust than an unassigned slot costs effort:
 * the user has no reason to look twice at a slot that already looks decided,
 * which is how RB-P10's invented-photo failure reappears in a new place.
 * Auto-assignments are flagged `suggested` so the UI can show what was
 * inferred rather than chosen. Explicit prior choices are never overwritten.
 *
 * 'building' is excluded — that panel is the ★ hero's, bound separately.
 * 'other' is excluded because it means "cannot categorise", and an admission
 * of uncertainty must not resolve into a binding.
 */
export function autoMatchSlots(
  panels: PhotoPanel[],
  tiles: MediaTile[],
  heroPanelIndex?: number | null,
  prior: PanelSlot[] = [],
): PanelSlot[] {
  const hero = heroPanelIndex ?? primaryPanelIndex(panels);
  const decided = new Map(prior.filter((s) => s.source !== 'unassigned').map((s) => [s.panelIndex, s]));
  const takenUrls = new Set(
    prior.filter((s) => s.source === 'media' && s.mediaUrl).map((s) => s.mediaUrl as string),
  );

  const matchable = (h: PanelContentHint | null | undefined): h is PanelContentHint =>
    !!h && h !== 'other' && h !== 'building';

  // Count demand (panels still needing a photo) and supply (unclaimed photos)
  // per hint BEFORE assigning anything, so the decision cannot depend on the
  // order panels happen to be iterated in.
  const openPanels = panels.filter((p) => !decided.has(p.index) && p.index !== hero);
  const demand = new Map<PanelContentHint, number>();
  for (const p of openPanels) {
    if (matchable(p.contentHint)) demand.set(p.contentHint, (demand.get(p.contentHint) ?? 0) + 1);
  }

  const supply = new Map<PanelContentHint, MediaTile[]>();
  for (const t of tiles) {
    if (takenUrls.has(t.url)) continue;
    const h = normalizeMediaHint(t);
    if (matchable(h)) (supply.get(h) ?? supply.set(h, []).get(h)!).push(t);
  }

  return panels.map((p) => {
    const existing = decided.get(p.index);
    if (existing) return existing;
    if (p.index === hero) return { panelIndex: p.index, source: 'hero' as const };

    const hint = p.contentHint;
    if (!matchable(hint)) return { panelIndex: p.index, source: 'unassigned' as const };

    const candidates = supply.get(hint) ?? [];
    // Unambiguous means one-to-one. Anything else stays open.
    if (candidates.length !== 1 || demand.get(hint) !== 1) {
      return { panelIndex: p.index, source: 'unassigned' as const };
    }
    return {
      panelIndex: p.index,
      source: 'media' as const,
      mediaUrl: candidates[0].url,
      suggested: true,
    };
  });
}

/** Panel indices still awaiting a decision (drives the disabled-button subtitle). */
export function unresolvedPanels(slots: PanelSlot[]): number[] {
  return slots
    .filter((s) => s.source === 'unassigned' || (s.source === 'media' && !s.mediaUrl))
    .map((s) => s.panelIndex);
}

export function slotsResolved(slots: PanelSlot[]): boolean {
  return unresolvedPanels(slots).length === 0;
}

/**
 * Media URLs in slot order, excluding the hero (which is always IMAGE 2 and is
 * pushed by the caller first) and excluding empty/unassigned slots. This is the
 * exact order the generation payload must attach them in for the directive's
 * "section N → image N+1" mapping to be true.
 */
export function slotMediaInOrder(slots: PanelSlot[]): string[] {
  return slots
    .slice()
    .sort((a, b) => a.panelIndex - b.panelIndex)
    .filter((s) => s.source === 'media' && !!s.mediaUrl)
    .map((s) => s.mediaUrl as string);
}

const ZONE_ROLES: ZoneRole[] = ['headline','subheadline','price','cta','badge','checklist','logo','photo','footer','other'];

export function isValidReferenceZone(x: unknown): x is ReferenceZone {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (!ZONE_ROLES.includes(o.role as ZoneRole)) return false;
  if (!Array.isArray(o.bbox) || o.bbox.length !== 4) return false;
  if (!o.bbox.every((n) => typeof n === 'number' && n >= -0.05 && n <= 1.05)) return false;
  if (o.align !== 'left' && o.align !== 'center' && o.align !== 'right') return false;
  return true;
}

/** Clamp a bbox into the unit square (the vision pass occasionally overshoots). */
export function clampBbox(b: [number, number, number, number]): [number, number, number, number] {
  const x = Math.min(Math.max(b[0], 0), 1);
  const y = Math.min(Math.max(b[1], 0), 1);
  return [x, y, Math.min(Math.max(b[2], 0), 1 - x), Math.min(Math.max(b[3], 0), 1 - y)];
}

function vOverlap(a: ReferenceZone, b: ReferenceZone): number {
  const [ , ay, , ah] = a.bbox; const [ , by, , bh] = b.bbox;
  const top = Math.max(ay, by); const bot = Math.min(ay + ah, by + bh);
  return Math.max(0, bot - top);
}

/**
 * Merge fragmented same-role heading zones — the vision pass frequently splits
 * one visual heading into 2 boxes (script + serif line, wrapped subhead). Only
 * headline/subheadline are merged (badges/checklist items are intentionally
 * distinct). Returns a new array; input is not mutated.
 */
export function dedupeZones(zones: ReferenceZone[]): ReferenceZone[] {
  const mergeable = new Set<ZoneRole>(['headline', 'subheadline']);
  const out: ReferenceZone[] = [];
  for (const z of zones) {
    const prior = mergeable.has(z.role)
      ? out.find((o) => o.role === z.role && (vOverlap(o, z) > 0 || Math.abs((o.bbox[1] + o.bbox[3]) - z.bbox[1]) < 0.04))
      : undefined;
    if (prior) {
      const x0 = Math.min(prior.bbox[0], z.bbox[0]);
      const y0 = Math.min(prior.bbox[1], z.bbox[1]);
      const x1 = Math.max(prior.bbox[0] + prior.bbox[2], z.bbox[0] + z.bbox[2]);
      const y1 = Math.max(prior.bbox[1] + prior.bbox[3], z.bbox[1] + z.bbox[3]);
      prior.bbox = [x0, y0, x1 - x0, y1 - y0];
      prior.fontScale = Math.max(prior.fontScale, z.fontScale);
    } else {
      out.push({ ...z, bbox: clampBbox(z.bbox) });
    }
  }
  return out;
}

/** Runtime schema guard — the analysis comes from an LLM, so validate it. */
export function isValidReferenceAnalysis(x: unknown): x is ReferenceAnalysis {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.palette)) return false;
  if (!o.palette.every((c) => typeof c === 'string')) return false;
  if (typeof o.layout !== 'string') return false;
  if (typeof o.text_treatment !== 'string') return false;
  if (o.mode !== undefined && o.mode !== 'style_hints' && o.mode !== 'replicate_layout') return false;
  return true;
}

/** Keep only well-formed '#rrggbb' / '#rgb' hex values (defensive vs. LLM noise). */
export function sanitizePalette(palette: string[]): string[] {
  return palette
    .map((c) => c.trim())
    .filter((c) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c))
    .slice(0, 8);
}

/**
 * Compose the STYLE REFERENCE block appended to each image-gen prompt. The
 * hard rule (no subject carry-over) is stated inline so it survives even if the
 * upstream analysis prompt's guard is ever weakened — the reference informs
 * palette/layout/text-treatment only; the imagery depicts THIS project.
 */
export function buildReferenceStyleBlock(
  analysis: ReferenceAnalysis,
  projectMediaDescriptions: string[],
  logoUrl: string | null,
): string {
  const palette = sanitizePalette(analysis.palette);
  const lines: string[] = [];
  lines.push('## STYLE REFERENCE (structure, palette & typography ONLY)');
  lines.push(
    'HARD RULE: Use the reference for visual STYLE only — its color palette, ' +
    'layout structure, and text treatment. DO NOT copy the reference image\'s ' +
    'subject, people, building, or scene. The property/imagery in the output ' +
    'MUST depict THIS project, described below.',
  );
  if (palette.length) lines.push(`- Color palette (use these hex values): ${palette.join(', ')}`);
  if (analysis.layout.trim()) lines.push(`- Layout structure: ${analysis.layout.trim()}`);
  if (analysis.text_treatment.trim()) lines.push(`- Text treatment: ${analysis.text_treatment.trim()}`);
  const media = projectMediaDescriptions.map((d) => d.trim()).filter(Boolean);
  if (media.length) {
    lines.push('- Depict THIS project, per its own reference photos:');
    media.forEach((d, i) => lines.push(`  (${i + 1}) ${d}`));
  }
  if (logoUrl) lines.push(`- Include the brand logo (reference: ${logoUrl}).`);
  return lines.join('\n');
}

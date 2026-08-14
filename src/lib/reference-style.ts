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
   * Short free-text noun for what the reference shows in this panel ("swimming
   * pool", "gym", "living room"). Emitted by the SAME vision call that returns
   * the panels — no extra spend — and used only to PRE-BIND a matching project
   * photo (autoMatchSlots). Deliberately not an enum: a rigid vocabulary gets
   * violated by the model and then matches nothing, whereas keyword scoring
   * degrades gracefully to "no match" and the gate still forces a decision.
   */
  contentHint?: string;
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
}

/**
 * Synonyms per asset_type token. The vision pass writes what it SEES ("swimming
 * pool"), the picker stores what the user FILED it as ('amenity_pool') — these
 * two vocabularies only overlap by luck, so the bridge is explicit.
 */
const HINT_SYNONYMS: Record<string, string[]> = {
  exterior: ['exterior', 'building', 'facade', 'tower', 'elevation', 'block', 'apartment'],
  night: ['night', 'dusk', 'evening', 'lit'],
  living: ['living', 'lounge', 'drawing', 'sofa'],
  kitchen: ['kitchen', 'modular', 'counter'],
  bedroom: ['bedroom', 'bed'],
  bathroom: ['bathroom', 'bath', 'washroom', 'shower'],
  pool: ['pool', 'swimming'],
  gym: ['gym', 'fitness', 'workout', 'treadmill'],
  terrace: ['terrace', 'rooftop', 'deck', 'balcony'],
  garden: ['garden', 'park', 'lawn', 'landscape', 'green'],
  lobby: ['lobby', 'reception', 'entrance', 'foyer'],
  clubhouse: ['clubhouse', 'club'],
  plan: ['plan', 'layout', 'floorplan', 'floor plan'],
  map: ['map', 'location', 'connectivity'],
  family: ['family', 'people', 'couple', 'children', 'lifestyle'],
};

/**
 * How well a panel's content hint matches a project photo's asset_type.
 * 0 = no evidence. Exported for the unit test — an auto-binding that silently
 * pairs the pool photo with the gym's section is worse than no binding at all,
 * because the user has no reason to look twice at a slot that looks decided.
 */
export function panelTileScore(panel: PhotoPanel, assetType: string): number {
  const hint = (panel.contentHint ?? '').toLowerCase();
  if (!hint) return 0;
  // 'amenity_pool' → ['amenity','pool']; the family prefix is dropped because
  // 'amenity' matches every amenity hint and would flatten the ranking.
  const tokens = assetType.toLowerCase().split('_').filter((t) => t && t !== 'amenity' && t !== 'hero' && t !== 'interior' && t !== 'lifestyle');
  let score = 0;
  for (const token of tokens) {
    for (const kw of HINT_SYNONYMS[token] ?? [token]) {
      if (hint.includes(kw)) score += 1;
    }
  }
  return score;
}

/**
 * Pre-bind slots from the detected panels and the photos the user actually
 * selected: the ★ hero takes the building panel, and every other panel takes
 * the best-matching unused photo BY CONTENT, never by mere ordering.
 *
 * A panel with no positive match stays 'unassigned' on purpose. Filling it
 * with "whatever is left over" would satisfy the gate while pairing images
 * arbitrarily — the failure this whole flow exists to prevent (RB-P10's
 * invented amenity photos) is precisely a plausible-looking wrong answer.
 * Existing explicit choices in `prior` are never overwritten.
 */
export function autoMatchSlots(
  panels: PhotoPanel[],
  tiles: MediaTile[],
  heroPanelIndex?: number | null,
  prior: PanelSlot[] = [],
): PanelSlot[] {
  const hero = heroPanelIndex ?? primaryPanelIndex(panels);
  const taken = new Set<string>();
  // Anything the user already decided is authoritative and locks its photo.
  for (const s of prior) {
    if (s.source === 'media' && s.mediaUrl) taken.add(s.mediaUrl);
  }

  return panels.map((p) => {
    const existing = prior.find((s) => s.panelIndex === p.index);
    if (existing && existing.source !== 'unassigned') return existing;
    if (p.index === hero) return { panelIndex: p.index, source: 'hero' as const };

    let best: { tile: MediaTile; score: number } | null = null;
    for (const t of tiles) {
      if (taken.has(t.url)) continue;
      const score = panelTileScore(p, t.assetType);
      if (score > 0 && (!best || score > best.score)) best = { tile: t, score };
    }
    if (!best) return { panelIndex: p.index, source: 'unassigned' as const };
    taken.add(best.tile.url);
    return { panelIndex: p.index, source: 'media' as const, mediaUrl: best.tile.url };
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

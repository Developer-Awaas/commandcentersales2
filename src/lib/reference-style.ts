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

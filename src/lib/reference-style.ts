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
}

/** Runtime schema guard — the analysis comes from an LLM, so validate it. */
export function isValidReferenceAnalysis(x: unknown): x is ReferenceAnalysis {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.palette)) return false;
  if (!o.palette.every((c) => typeof c === 'string')) return false;
  if (typeof o.layout !== 'string') return false;
  if (typeof o.text_treatment !== 'string') return false;
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

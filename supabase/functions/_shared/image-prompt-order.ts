/**
 * T-012 — constraints before prose.
 *
 * Aanya's Stage 2 writes a nine-section image prompt (SECTION 1 SCENE
 * NARRATIVE … SECTION 9 TECHNICAL SPECS). Measured on TEST 2026-09-17, real
 * Lead Gen prompts run 5.3k–6.6k characters, and the sections that constrain
 * the output — 7 BRAND & PROJECT ELEMENTS, 8 NEGATIVE PROMPTS, 9 TECHNICAL
 * SPECS — all start past 3.9k. Under the old 4,000-character cut every one of
 * them was dropped silently, which is why brand colours, negative prompts and
 * the aspect/quality specs never reached the model.
 *
 * The cut is now the provider ceiling rather than 4,000, so this reordering is
 * belt-and-braces: whatever the limit, a prompt that has to lose something
 * loses descriptive prose (sections 1–6) instead of the constraints. Anything
 * ahead of SECTION 1 (the hero-edit preamble and its "no logos" override) is a
 * constraint too and stays at the very front.
 *
 * Idempotent, and a no-op on any prompt that is not nine-section shaped (SMM
 * nanoPrompts, replicate-mode prompts).
 */

const SECTION_1 = /^SECTION 1:/m
const SECTION_7 = /^SECTION 7:/m

export function prioritizeConstraints(prompt: string): string {
  const s1 = prompt.search(SECTION_1)
  const s7 = prompt.search(SECTION_7)
  // Missing either header → not a nine-section prompt. s7 < s1 → already reordered.
  if (s1 < 0 || s7 < 0 || s7 < s1) return prompt

  const preamble = prompt.slice(0, s1)
  const prose = prompt.slice(s1, s7).trim()
  const constraints = prompt.slice(s7).trim()
  return `${preamble}${constraints}\n\n${prose}\n`
}

/**
 * STEP 2 — golden-set harness for the replicate/blank directives.
 *
 * WHY THIS EXISTS: every prompt change so far was verified by generating one
 * image and looking at it. n=1 against a stochastic model is not evidence — a
 * rule can be dropped entirely and still pass one lucky run, which is how the
 * wireframe class survived several "verified" passes. This runs a FIXED set and
 * scores each cell against a deterministic checklist, so a regression shows up
 * as a FAIL row rather than a vibe.
 *
 * It IMPORTS the real directive builders. Restating prompt text in a harness is
 * the specific mistake that made a prior finding a false alarm for a day
 * (CLAUDE.md, replicate-live-check) — a harness that tests its own copy of the
 * prompt tests nothing.
 *
 *   npx tsx scripts/prompt-eval.ts
 *
 * Cost: 6 cells x 1 image (SINGLE_IMAGE, medium) + 6 Haiku vision calls
 * — roughly $0.25 a run. Writes PNGs + table to scripts/replay-out/prompt-eval/.
 *
 * GOLDEN SET: driven by the manifest below, NOT hardcoded bytes. Each entry
 * points at a local reference image. The three named references live in the
 * reviewer's uploads and are not in this repo or in TEST storage, so drop them
 * at the paths below (or override with EVAL_REF_DIR) before the table means
 * what its rows claim.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildReplicateLayoutPrompt, buildReplicatePrompt } from '../src/lib/senior-designer-prompts';
import type { PhotoPanel, PanelSlot } from '../src/lib/reference-style';

const REF_DIR = process.env.EVAL_REF_DIR ?? 'scripts/eval-refs';
const OUT_DIR = 'scripts/replay-out/prompt-eval';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';

/** One reference + the panel geometry that goes with it. */
interface GoldenRef {
  key: string;
  file: string;
  /** What this reference is meant to stress. */
  stresses: string;
  panels?: PhotoPanel[];
  slots?: PanelSlot[];
}

const GOLDEN: GoldenRef[] = [
  {
    key: 'crystal-garden',
    file: 'crystal-garden.png',
    stresses: 'text sitting ON the background (CASE 2 — must clear seamlessly, no ghost plate)',
  },
  {
    key: 'grand-mark',
    file: 'grand-mark.png',
    stresses: 'text INSIDE containers (CASE 1 — containers kept, FILLED, never wireframe)',
  },
  {
    key: 'gali',
    file: 'gali.png',
    stresses: 'multi-panel photos (V5 assignment — assigned panels filled, EMPTY ones solid blocks, zero invented photos)',
    panels: [
      { index: 1, bbox: [0.18, 0.16, 0.64, 0.42], shapeHint: 'rect',   approxArea: 0.27, isBuilding: true,  contentHint: 'building' },
      { index: 2, bbox: [0.06, 0.66, 0.26, 0.18], shapeHint: 'circle', approxArea: 0.05, isBuilding: false, contentHint: 'pool' },
      { index: 3, bbox: [0.37, 0.66, 0.26, 0.18], shapeHint: 'wedge',  approxArea: 0.05, isBuilding: false, contentHint: 'gym' },
      { index: 4, bbox: [0.68, 0.66, 0.26, 0.18], shapeHint: 'wedge',  approxArea: 0.05, isBuilding: false, contentHint: 'other' },
    ],
    slots: [
      { panelIndex: 1, source: 'hero' },
      { panelIndex: 2, source: 'media', mediaUrl: 'pool' },
      { panelIndex: 3, source: 'empty' },
      { panelIndex: 4, source: 'empty' },
    ],
  },
];

/** Deliberate leak bait — none of it may appear in any output. */
const COPY = {
  headline: 'Live Above It All',
  price: '₹82 Lac onwards',
  cta: 'Book a Site Visit',
  location: 'Patia, Bhubaneswar',
  contact: '+91 90000 11111',
};

/**
 * YES/NO checklist per cell type. Deterministic on purpose: a judge asked "is
 * this good?" returns prose that cannot be diffed between runs. Every question
 * is phrased so YES = pass, so a row is scored by counting NOs.
 */
function checklistFor(kind: 'blank' | 'ai', ref: GoldenRef): string[] {
  const common = [
    'Is the output FREE of the reference\'s company name, logo, wordmark, QR code and phone digits?',
    'Is the layout geometry (panels, bands, positions, proportions) the same as the reference?',
  ];
  if (kind === 'blank') {
    return [
      ...common,
      'Is the output completely FREE of readable characters, in any script?',
      'Are all retained containers SOLID FILLED blocks — with NO outline-only, stroke-only, dashed or transparent wireframe boxes anywhere?',
      'Are areas where floating text used to sit now clean background, with NO leftover plate, pill or coloured patch?',
      ...(ref.panels ? ['Are the photo sections marked EMPTY rendered as plain solid colour blocks, with NO invented or copied photograph in them?'] : []),
    ];
  }
  return [
    ...common,
    `Does every readable string in the output come ONLY from this list: "${COPY.headline}", "${COPY.price}", "${COPY.cta}", "${COPY.location}", "${COPY.contact}"?`,
    'Are containers that received no text DISSOLVED — with the background continuing through, rather than left as empty boxes?',
    ...(ref.panels ? ['Are the photo sections marked EMPTY rendered as plain solid colour blocks, with NO invented or copied photograph in them?'] : []),
  ];
}

function directiveFor(kind: 'blank' | 'ai', ref: GoldenRef): string {
  const assignment = ref.panels && ref.slots ? { panels: ref.panels, slots: ref.slots } : undefined;
  return kind === 'blank'
    ? buildReplicateLayoutPrompt(1, assignment)
    : buildReplicatePrompt(COPY, 1, assignment);
}

async function generate(prompt: string, refB64: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({
      prompt,
      quality: 'medium',
      width: 1080, height: 1080,
      heroImage: { base64: refB64, mimeType: 'image/png' },
    }),
  });
  const json = await res.json().catch(() => ({})) as { base64?: string; error?: string };
  if (!json.base64) { console.error('   gen failed:', json.error ?? res.status); return null; }
  return json.base64;
}

/** Cheap judge: one Haiku vision call, forced to answer the checklist YES/NO. */
async function judge(imageB64: string, checklist: string[]): Promise<boolean[]> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/claude-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageB64 } },
          {
            type: 'text',
            text: 'Answer each question about the image with exactly YES or NO, one per line, ' +
              'numbered, no explanation:\n' + checklist.map((q, i) => `${i + 1}. ${q}`).join('\n'),
          },
        ],
      }],
    }),
  });
  const json = await res.json().catch(() => ({})) as { content?: { text?: string }[] };
  const text = json.content?.[0]?.text ?? '';
  // Missing/unparseable answers count as FAIL — an unreadable judge must never
  // silently score as a pass.
  return checklist.map((_, i) => {
    const line = text.split('\n').find((l) => l.trim().startsWith(String(i + 1)));
    return !!line && /\bYES\b/i.test(line);
  });
}

async function main() {
  if (!SUPABASE_URL || !ANON) { console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY required'); process.exit(1); }
  mkdirSync(OUT_DIR, { recursive: true });

  const missing = GOLDEN.filter((g) => !existsSync(join(REF_DIR, g.file)));
  if (missing.length) {
    console.error(`\nGolden references missing from ${REF_DIR}/:`);
    for (const m of missing) console.error(`  - ${m.file}   (${m.stresses})`);
    console.error('\nThese are the reviewer\'s own uploads and are not in the repo or TEST storage.');
    console.error('Drop them in (or set EVAL_REF_DIR) and re-run — the table is meaningless without them.\n');
    process.exit(2);
  }

  const rows: string[][] = [];
  for (const ref of GOLDEN) {
    const refB64 = readFileSync(join(REF_DIR, ref.file)).toString('base64');
    for (const kind of ['blank', 'ai'] as const) {
      const cell = `${ref.key}/${kind}`;
      process.stdout.write(`\n▶ ${cell} … `);
      const img = await generate(directiveFor(kind, ref), refB64);
      if (!img) { rows.push([cell, 'GEN FAIL', '-', '-']); continue; }
      writeFileSync(join(OUT_DIR, `${ref.key}-${kind}.png`), Buffer.from(img, 'base64'));

      const checks = checklistFor(kind, ref);
      const answers = await judge(img, checks);
      const failed = checks.filter((_, i) => !answers[i]);
      rows.push([
        cell,
        failed.length ? 'FAIL' : 'PASS',
        `${answers.filter(Boolean).length}/${checks.length}`,
        failed.length ? failed.map((q) => q.slice(0, 58) + '…').join(' | ') : '',
      ]);
      process.stdout.write(failed.length ? `FAIL (${failed.length})` : 'PASS');
    }
  }

  const pad = (v: string, n: number) => v.padEnd(n);
  console.log('\n\n' + pad('CELL', 22) + pad('RESULT', 9) + pad('SCORE', 8) + 'FAILED CHECKS');
  for (const r of rows) console.log(pad(r[0], 22) + pad(r[1], 9) + pad(r[2], 8) + r[3]);
  console.log(`\nPNGs: ${OUT_DIR}/`);
}

main();

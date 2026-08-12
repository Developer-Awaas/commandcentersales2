/**
 * replicate-live-check.ts — live check for AI-mode replicate generation.
 *
 * WHY THIS EXISTS: V5's verification used a hand-written prompt in a throwaway
 * script, which had drifted from the real one — it omitted RB-P10's DISSOLVE
 * rule that buildReplicatePrompt actually carries. The run then "found" a copy
 * leak (image 1's phone number and amenity captions surviving into the output)
 * that may only have existed in the harness. A harness that re-authors the
 * prompt tests a prompt nobody ships.
 *
 * So this one IMPORTS buildReplicatePrompt and the panel types from src/ —
 * there is no prompt text in this file, and there must never be. It mirrors
 * StrategyResult.tsx's call shape exactly:
 *   buildReplicatePrompt(aiCopy, buildingViews, { panels, slots })
 *   heroImages = [styleRef(base64), hero(url), ...slotMediaInOrder(slots)(url)]
 *   buildingViews = max(1, heroImages.length - 1)
 *
 * The reference creative is generated here rather than fetched: TEST has no
 * multi-panel reference ad, and a synthetic one can carry deliberate LEAK BAIT
 * (a competitor phone number, company name, price and amenity captions). Any of
 * those strings appearing in the output is a real copy-integrity failure.
 *
 * Run:  npx tsx scripts/replicate-live-check.ts [--aspect 4:5] [--quality medium]
 * Reqs: `canvas` + `tsx`; .env.local pointing at TEST. Costs one image gen.
 * Out:  scripts/replay-out/replicate-live/{reference,output}.png + prompt.txt
 */
import { createCanvas } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import type { PhotoPanel, PanelSlot } from '../src/lib/reference-style';

// src/lib/supabase.ts reads its config at module load, so .env.local has to be
// in process.env BEFORE the src/ modules are pulled in — hence the dynamic
// imports in main() rather than static ones up here.
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^(VITE_[A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const OUT_DIR = 'scripts/replay-out/replicate-live';
const ORG_ID = '1a0f7ac3-8053-4aee-824c-75f27681ce64';
const PROJECT = '325e5a88-79e1-4747-a085-89034d762c41';
const W = 1080, H = 1350;

// Deliberate leak bait — none of these may appear in the output.
const BAIT = {
  company: 'SKYLINE REALTORS',
  phone: '+91 98111 22333',
  price: '₹ 2.40 Cr*',
  headline: 'LUXURY 4BHK VILLAS',
  // Must NOT overlap the amenities passed as our own copy below, or a survivor
  // is unattributable ("Clubhouse" in both lists made the first run ambiguous).
  captions: ['Jogging Track', 'Yoga Deck', 'Amphitheatre'],
};

/** A 4-photo-panel ad: one big hero panel + a 3-up captioned strip. */
function syntheticReference(): { base64: string; panels: PhotoPanel[] } {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#0f2740'; g.fillRect(0, 0, W, H);

  // Panel 1 — main building photo (a flat stand-in; the model replaces it anyway).
  const p1 = { x: 60, y: 190, w: 960, h: 620 };
  g.fillStyle = '#6b7f93'; g.fillRect(p1.x, p1.y, p1.w, p1.h);
  g.fillStyle = '#8fa3b8'; g.fillRect(p1.x + 300, p1.y + 160, 360, 460);

  // Panels 2-4 — a captioned amenity strip.
  const strip = [0, 1, 2].map((i) => ({ x: 60 + i * 330, y: 880, w: 300, h: 220 }));
  strip.forEach((s, i) => {
    g.fillStyle = i % 2 ? '#7d8fa2' : '#5f7285';
    g.fillRect(s.x, s.y, s.w, s.h);
    g.fillStyle = '#ffffff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
    g.fillText(BAIT.captions[i], s.x + s.w / 2, s.y + s.h + 34);
  });

  g.textAlign = 'left';
  g.fillStyle = '#e8c766'; g.font = 'bold 46px sans-serif'; g.fillText(BAIT.company, 60, 92);
  g.fillStyle = '#ffffff'; g.font = 'bold 64px sans-serif'; g.fillText(BAIT.headline, 60, 165);
  g.fillStyle = '#e8c766'; g.font = 'bold 52px sans-serif'; g.fillText(BAIT.price, 60, 1200);
  g.fillStyle = '#ffffff'; g.font = 'bold 40px sans-serif'; g.fillText(BAIT.phone, 60, 1270);

  const panels: PhotoPanel[] = [
    { index: 1, bbox: [p1.x / W, p1.y / H, p1.w / W, p1.h / H], shapeHint: 'rect', approxArea: (p1.w * p1.h) / (W * H), isBuilding: true },
    ...strip.map((s, i): PhotoPanel => ({
      index: i + 2,
      bbox: [s.x / W, s.y / H, s.w / W, s.h / H],
      shapeHint: 'rect',
      approxArea: (s.w * s.h) / (W * H),
    })),
  ];
  return { base64: c.toDataURL('image/png').split(',')[1], panels };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (n: string, d: string) => args[args.indexOf(`--${n}`) + 1] ?? d;
  const quality = arg('quality', 'medium');
  const url = process.env.VITE_SUPABASE_URL ?? '', key = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  if (!url || !key) throw new Error('.env.local missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

  // The whole point of this harness: the prompt comes from the shipped builder.
  const { buildReplicatePrompt } = await import('../src/lib/senior-designer-prompts');
  const { slotMediaInOrder } = await import('../src/lib/reference-style');
  const publicUrl = (bucket: string, p: string) => `${url}/storage/v1/object/public/${bucket}/${p}`;

  const { base64, panels } = syntheticReference();
  const heroUrl = publicUrl('project-assets', `${ORG_ID}/${PROJECT}/hero_exterior.png`);
  const poolUrl = publicUrl('project-assets', `${ORG_ID}/${PROJECT}/amenity_pool.png`);

  // Panel 1 → hero, panel 2 → a real amenity photo, panels 3-4 → EMPTY. The
  // empty pair is the V5 regression target; the leak bait is the RB-P8 one.
  const slots: PanelSlot[] = [
    { panelIndex: 1, source: 'hero' },
    { panelIndex: 2, source: 'media', mediaUrl: poolUrl },
    { panelIndex: 3, source: 'empty' },
    { panelIndex: 4, source: 'empty' },
  ];

  const heroImages = [{ base64, mimeType: 'image/png' } as const, { url: heroUrl }, ...slotMediaInOrder(slots).map((u) => ({ url: u }))];
  const buildingViews = Math.max(1, heroImages.length - 1);
  const prompt = buildReplicatePrompt({
    headline: 'Ananta Enclave',
    subheadline: 'Ready-to-move 3BHK homes',
    price: '₹ 68 L onwards',
    location: 'Patia, Bhubaneswar',
    contact: '+91 90000 11111',
    cta: 'Book a site visit',
    amenities: ['Swimming Pool', 'Clubhouse', '24×7 Security'],
  }, buildingViews, { panels, slots });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'reference.png'), Buffer.from(base64, 'base64'));
  fs.writeFileSync(path.join(OUT_DIR, 'prompt.txt'), prompt);
  console.log(`reference: 4 panels, bait=${[BAIT.company, BAIT.phone, BAIT.price, ...BAIT.captions].join(' | ')}`);
  console.log(`prompt: ${prompt.length} chars (from buildReplicatePrompt) → ${OUT_DIR}/prompt.txt`);

  const res = await fetch(`${url}/functions/v1/generate-image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt, width: 1080, height: 1350, quality, async: true, orgId: ORG_ID,
      projectId: PROJECT, feature: 'replicate-live-check',
      heroImage: heroImages[0], supportingImages: heroImages.slice(1),
    }),
  });
  const body = await res.json() as { jobId?: string; error?: string };
  if (!body.jobId) throw new Error(`no jobId: HTTP ${res.status} ${body.error ?? ''}`);
  console.log(`job ${body.jobId} queued — polling storage (image_jobs itself is not anon-readable)`);

  // The job's output path is deterministic, and the bucket is public — so the
  // finished PNG can be polled without the authenticated session the RLS-scoped
  // image_jobs row would need. A job that FAILS never produces one: on timeout,
  // read the row's `error` column for the real reason.
  const objUrl = publicUrl('creative-assets', `image-jobs/${ORG_ID}/${body.jobId}.png`);
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const img = await fetch(objUrl);
    if (!img.ok) continue;
    fs.writeFileSync(path.join(OUT_DIR, 'output.png'), Buffer.from(await img.arrayBuffer()));
    console.log(`done → ${OUT_DIR}/output.png`);
    console.log(`CHECK BY EYE: none of [${[BAIT.company, BAIT.phone, BAIT.price, ...BAIT.captions].join(', ')}] may appear; panels 3-4 must be flat colour blocks, not photos.`);
    return;
  }
  throw new Error(`timed out — query: select status, error from image_jobs where id = '${body.jobId}';`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * replay-composite.ts — STANDING offline replay harness for the text-overlay
 * compositing path (NO patching — that layer was removed). Given a creative id
 * (TEST db) it fetches the persisted clean_template_url + overlay_zones +
 * text_layers, runs the EXACT production compositor (renderTextLayers) under
 * node-canvas, and writes:
 *
 *   scripts/replay-out/<id>/composited.png  — template + placed text/logo layers
 *   scripts/replay-out/<id>/debug.png       — clean template + zone outlines
 *   scripts/replay-out/<id>/zones.json      — zone/layer metadata (no patch verdicts)
 *
 * --synthetic additionally renders a case exercising every layer feature (sizes,
 * colors, chip backing, logo, z-order) to scripts/replay-out/synthetic/ and asserts
 * recomposite DETERMINISM (same inputs → identical output hash).
 *
 * Run:  npx tsx scripts/replay-composite.ts <creativeId> [--synthetic] [--refetch]
 * Reqs: `canvas` + `tsx` (npm i --no-save canvas tsx); TEST linked via supabase CLI.
 */
import { createCanvas, Image as NodeImage } from 'canvas';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---- DOM shims so the real browser-oriented compositor runs under node ---------
const bufMap = new Map<string, Buffer>(); // url -> decoded image bytes (pre-fetched)
const nativeSrc = Object.getOwnPropertyDescriptor(NodeImage.prototype, 'src')!;
(globalThis as Record<string, unknown>).Image = function ShimImage(this: unknown) {
  const img = new NodeImage();
  Object.defineProperty(img, 'src', {
    configurable: true,
    get() { return nativeSrc.get!.call(img); },
    set(v: string) {
      if (typeof v === 'string' && !v.startsWith('data:')) {
        const b = bufMap.get(v);
        if (!b) { setTimeout(() => img.onerror?.(new Error('no prefetched buffer for ' + v)), 0); return; }
        nativeSrc.set!.call(img, b); return;
      }
      nativeSrc.set!.call(img, v);
    },
  });
  return img;
};
(globalThis as Record<string, unknown>).document = {
  createElement: (t: string) => { if (t === 'canvas') return createCanvas(1, 1); throw new Error('shim: <' + t + '>'); },
};

interface Zone { role: string; bbox: [number, number, number, number]; align: 'left' | 'center' | 'right' }
interface Input {
  id: string; clean_template_url: string; overlay_zones: Zone[];
  text_layers: Array<Record<string, unknown> & { placed?: boolean; kind?: string; text: string; xPct: number; yPct: number }>;
  primary_color?: string; model_used?: string;
}

function fetchInput(id: string, refetch: boolean): Input {
  const file = path.join('scripts/replay-fixtures', id + '.input.json');
  if (!refetch && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const sql = `select json_build_object('id',ca.id,'clean_template_url',ca.clean_template_url,'overlay_zones',ca.overlay_zones,'text_layers',ca.text_layers,'model_used',ca.model_used,'primary_color',(select bk.primary_color from brand_kits bk where bk.org_id=ca.org_id limit 1)) as row from creative_assets ca where ca.id='${id}';`;
  const raw = execSync(`npx supabase db query --linked "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const row = JSON.parse(raw.slice(raw.indexOf('{'))).rows[0].row as Input;
  fs.mkdirSync('scripts/replay-fixtures', { recursive: true });
  fs.writeFileSync(file, JSON.stringify(row, null, 2));
  return row;
}

async function prefetch(url: string): Promise<void> {
  if (bufMap.has(url) || url.startsWith('data:')) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status} ${url}`);
  bufMap.set(url, Buffer.from(await res.arrayBuffer()));
}

const pngFromDataUrl = (dataUrl: string, W: number, H: number): Buffer => {
  const im = new NodeImage(); im.src = dataUrl;
  const c = createCanvas(W, H); c.getContext('2d').drawImage(im, 0, 0, W, H);
  return c.toBuffer('image/png');
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);

// A tiny self-contained logo (data URI) for the synthetic case — a gold ring.
function syntheticLogoDataUrl(): string {
  const c = createCanvas(200, 200); const g = c.getContext('2d');
  g.fillStyle = '#c9a961'; g.beginPath(); g.arc(100, 100, 90, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1a2332'; g.font = 'bold 70px sans-serif'; g.textAlign = 'center'; g.fillText('A', 100, 125);
  return c.toDataURL('image/png');
}

// RB-P4 blank-template evidence: self-contained (no TEST fetch). Generates a
// deliberately TEXT-FREE template, then feeds renderTextLayers the essentials
// ALL as placed:false suggestion chips (the new blank-mode behavior). The
// composite must equal the clean-template-only render — i.e. NOTHING is drawn,
// proving blank mode leaves the design text-free and everything stays a chip.
async function runBlank() {
  const { renderTextLayers } = await import('../src/lib/text-layers.ts');
  const doc = (globalThis as Record<string, unknown>).document as { createElement: (t: string) => { width: number; height: number; getContext: (c: string) => CanvasRenderingContext2D; toDataURL: (t?: string) => string } };
  const W = 1080, H = 1080;
  const c = doc.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#bcd4e6'); grad.addColorStop(1, '#e8eef2');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = '#5b6b7a'; g.fillRect(300, 520, 480, 420); // a building block — no text anywhere
  const templateUrl = c.toDataURL('image/png');

  const chips: TextLayer[] = [
    { id: 'name',  text: 'Ananta Enclave',      placed: false, xPct: 8,  yPct: 12, fontSizePx: 64, fontWeight: 'bold',   color: '#12324f', align: 'left' },
    { id: 'head',  text: '3BHK homes in Patia', placed: false, xPct: 8,  yPct: 30, fontSizePx: 40, fontWeight: 'normal', color: '#12324f', align: 'left' },
    { id: 'price', text: '₹ 68 L onwards',       placed: false, xPct: 8,  yPct: 70, fontSizePx: 44, fontWeight: 'bold',   color: '#c9a961', align: 'left' },
    { id: 'cta',   text: 'WhatsApp us today',    placed: false, xPct: 8,  yPct: 90, fontSizePx: 30, fontWeight: 'normal', color: '#12324f', align: 'left' },
    { id: 'logo',  kind: 'logo', imageUrl: syntheticLogoDataUrl(), text: '', placed: false, xPct: 80, yPct: 4, widthPct: 14, heightPct: 9, fontSizePx: 0, fontWeight: 'normal', color: '#000', align: 'left' },
  ];
  const rendered = await renderTextLayers(templateUrl, chips, W, H);
  const cleanOnly = await renderTextLayers(templateUrl, [], W, H);
  const dir = 'scripts/replay-out/blank'; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'blank-template.png'), pngFromDataUrl(rendered, W, H));
  const [hr, hc] = [sha(Buffer.from(rendered)), sha(Buffer.from(cleanOnly))];
  console.log(`blank-template: ${chips.length} essentials ALL as placed:false chips → ${dir}/blank-template.png`);
  console.log(`  allChipsUnplaced hash=${hr}  cleanTemplateOnly hash=${hc}  → ${hr === hc ? 'IDENTICAL — nothing composited, template stays text-free ✓' : 'MISMATCH ✗'}`);
  if (hr !== hc) process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--blank')) { await runBlank(); return; }
  const id = args.find((a) => !a.startsWith('--'));
  if (!id) { console.error('usage: tsx scripts/replay-composite.ts <creativeId> [--synthetic] [--refetch] | --blank'); process.exit(1); }
  const input = fetchInput(id, args.includes('--refetch'));
  await prefetch(input.clean_template_url);

  const { renderTextLayers } = await import('../src/lib/text-layers.ts');
  type TextLayer = import('../src/lib/text-layers.ts').TextLayer;

  const clean = new NodeImage(); clean.src = bufMap.get(input.clean_template_url)!;
  const W = clean.width, H = clean.height;
  const layers = input.text_layers as unknown as TextLayer[];

  // composited.png — the REAL production path: template + placed text/logo layers.
  const composed = await renderTextLayers(input.clean_template_url, layers, W, H);
  const outDir = path.join('scripts/replay-out', id);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'composited.png'), pngFromDataUrl(composed, W, H));

  // debug.png — clean template + zone outlines (metadata only, no patch verdicts).
  const dc = createCanvas(W, H); const dctx = dc.getContext('2d');
  dctx.drawImage(clean, 0, 0, W, H);
  input.overlay_zones.forEach((z) => {
    const [x, y, w, h] = [z.bbox[0] * W, z.bbox[1] * H, z.bbox[2] * W, z.bbox[3] * H];
    dctx.lineWidth = 2; dctx.strokeStyle = '#38bdf8'; dctx.strokeRect(x, y, w, h);
    dctx.font = 'bold 18px sans-serif'; dctx.fillStyle = '#000'; dctx.fillRect(x, y, 180, 22);
    dctx.fillStyle = '#fff'; dctx.fillText(`${z.role} ${(z.bbox[2] * z.bbox[3] * 100).toFixed(1)}%`, x + 3, y + 17);
  });
  fs.writeFileSync(path.join(outDir, 'debug.png'), dc.toBuffer('image/png'));
  fs.writeFileSync(path.join(outDir, 'zones.json'), JSON.stringify({
    id, dims: { W, H }, model_used: input.model_used,
    zones: input.overlay_zones.map((z) => ({ role: z.role, areaPct: +(z.bbox[2] * z.bbox[3] * 100).toFixed(2) })),
    layers: layers.map((l) => ({ kind: l.kind ?? 'text', placed: l.placed !== false, text: (l.text || '').slice(0, 40) })),
  }, null, 2));
  console.log(`replayed ${id}: template + ${layers.filter((l) => l.placed !== false).length} placed layers (NO patching). → ${outDir}`);

  if (args.includes('--synthetic')) {
    const s: TextLayer[] = [
      // RB-P5: image layer (new type) at 70% opacity, aspect locked (contain).
      { id: '1', type: 'image', name: 'Logo', imageUrl: syntheticLogoDataUrl(), text: '', opacity: 70, aspectLocked: true, xPct: 4, yPct: 3, widthPct: 14, heightPct: 9, fontSizePx: 0, fontWeight: 'normal', color: '#000', align: 'left' },
      // second image layer, aspect UNLOCKED (stretch) + 50% opacity — exercises both.
      { id: '1b', type: 'image', name: 'Stretched mark', imageUrl: syntheticLogoDataUrl(), text: '', opacity: 50, aspectLocked: false, xPct: 78, yPct: 4, widthPct: 18, heightPct: 6, fontSizePx: 0, fontWeight: 'normal', color: '#000', align: 'left' },
      // legacy kind:'logo' (no type) must still render as an image (back-compat).
      { id: '1c', kind: 'logo', imageUrl: syntheticLogoDataUrl(), text: '', xPct: 40, yPct: 4, widthPct: 12, heightPct: 8, fontSizePx: 0, fontWeight: 'normal', color: '#000', align: 'left' },
      { id: '2', text: 'BIG BOLD HEADLINE', xPct: 6, yPct: 16, widthPct: 88, fontSizePx: 72, fontWeight: 'bold', color: '#ffffff', align: 'left' },
      { id: '3', text: 'A smaller gold subhead', opacity: 60, xPct: 6, yPct: 30, widthPct: 80, fontSizePx: 40, fontWeight: 'normal', color: '#c9a961', align: 'left' },
      { id: '4', text: 'Centered chip-backed line', xPct: 50, yPct: 46, widthPct: 70, fontSizePx: 34, fontWeight: 'bold', color: '#ffffff', align: 'center', backgroundColor: 'rgba(15,23,42,0.85)', paddingPx: 16, borderRadiusPx: 14 },
      { id: '5', text: 'Book Now  →', xPct: 6, yPct: 90, fontSizePx: 30, fontWeight: 'bold', color: '#1a2332', align: 'left', backgroundColor: '#c9a961', paddingPx: 18, borderRadiusPx: 28 },
      { id: '6', text: 'unplaced suggestion (not rendered)', placed: false, xPct: 6, yPct: 60, fontSizePx: 30, fontWeight: 'normal', color: '#fff', align: 'left' },
      { id: '7', text: 'HIDDEN (excluded)', hidden: true, xPct: 6, yPct: 72, fontSizePx: 30, fontWeight: 'bold', color: '#f00', align: 'left' },
    ];
    const synDir = 'scripts/replay-out/synthetic'; fs.mkdirSync(synDir, { recursive: true });
    const a = await renderTextLayers(input.clean_template_url, s, W, H);
    const b = await renderTextLayers(input.clean_template_url, s, W, H);
    fs.writeFileSync(path.join(synDir, 'synthetic.png'), pngFromDataUrl(a, W, H));
    const [ha, hb] = [sha(Buffer.from(a)), sha(Buffer.from(b))];
    console.log(`synthetic: every feature exercised → ${synDir}/synthetic.png`);
    console.log(`determinism: hashA=${ha} hashB=${hb} → ${ha === hb ? 'IDENTICAL ✓' : 'MISMATCH ✗'}`);
    if (ha !== hb) process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

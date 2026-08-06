/**
 * replay-composite.ts — STANDING offline replay harness for the text-overlay
 * compositing path. Given a creative id (TEST db), it fetches the persisted
 * re-composite inputs (clean_template_url + overlay_zones + text_layers + brand
 * primary), then runs the EXACT production path (sampleRing → planPatch/decidePatches
 * → renderTextLayers) under node-canvas and writes:
 *
 *   scripts/replay-out/<id>/composited.png  — what the user saw (real render)
 *   scripts/replay-out/<id>/debug.png       — zone boxes + per-zone verdict + area
 *   scripts/replay-out/<id>/decisions.json  — per-zone verdicts, variances, colors
 *
 * Every future overlay bug gets replayed here first — never re-tested live.
 *
 * Run:  npx tsx scripts/replay-composite.ts <creativeId> [--refetch]
 * Reqs: `canvas` + `tsx` (npm i --no-save canvas tsx); TEST linked via supabase CLI.
 */
import { createCanvas, Image as NodeImage } from 'canvas';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---- DOM shims so the real browser-oriented compositor runs under node ---------
// Real node-canvas Image instances (so ctx.drawImage accepts them), but with the
// native `src` setter wrapped to resolve a pre-fetched URL → Buffer (node-canvas
// can't fetch http). data: URIs pass straight through to the native setter.
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

// ---- input fetch (cache or linked CLI) ----------------------------------------
interface Zone { role: string; bbox: [number, number, number, number]; align: 'left' | 'center' | 'right'; weight?: 'normal' | 'bold'; color?: string }
interface Input {
  id: string; clean_template_url: string; overlay_zones: Zone[];
  text_layers: Array<Record<string, unknown> & { placed?: boolean; text: string; xPct: number; yPct: number }>;
  primary_color?: string; accent_color?: string; model_used?: string;
}

function fetchInput(id: string, refetch: boolean): Input {
  const file = path.join('scripts/replay-fixtures', id + '.input.json');
  if (!refetch && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const sql = `select json_build_object('id',ca.id,'clean_template_url',ca.clean_template_url,'overlay_zones',ca.overlay_zones,'text_layers',ca.text_layers,'model_used',ca.model_used,'primary_color',(select bk.primary_color from brand_kits bk where bk.org_id=ca.org_id limit 1),'accent_color',(select bk.accent_color from brand_kits bk where bk.org_id=ca.org_id limit 1)) as row from creative_assets ca where ca.id='${id}';`;
  const raw = execSync(`npx supabase db query --linked "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const row = JSON.parse(raw.slice(raw.indexOf('{'))).rows[0].row as Input;
  fs.mkdirSync('scripts/replay-fixtures', { recursive: true });
  fs.writeFileSync(file, JSON.stringify(row, null, 2));
  return row;
}

async function prefetch(url: string): Promise<void> {
  if (bufMap.has(url)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status} ${url}`);
  bufMap.set(url, Buffer.from(await res.arrayBuffer()));
}

const areaFrac = (b: [number, number, number, number]) => b[2] * b[3];

async function main() {
  const id = process.argv[2];
  if (!id) { console.error('usage: tsx scripts/replay-composite.ts <creativeId> [--refetch]'); process.exit(1); }
  const input = fetchInput(id, process.argv.includes('--refetch'));
  await prefetch(input.clean_template_url);

  // Import the REAL production modules AFTER shims are installed.
  const { renderTextLayers, sampleRing } = await import('../src/lib/text-layers.ts');
  const { textZonePlateSpecs, photoZones: photoZonesOf } = await import('../src/lib/zone-layers.ts');
  const { planPatch } = await import('../src/lib/zone-patch.ts');
  let decidePatches: undefined | ((recs: unknown[]) => { zones: Array<Record<string, unknown>>; globalPatchingDisabled: boolean });
  try { decidePatches = (await import('../src/lib/zone-patch.ts') as Record<string, unknown>).decidePatches as typeof decidePatches; } catch { /* not present until the fix */ }

  const zones = input.overlay_zones;
  const layers = input.text_layers;
  const plateSpecs = textZonePlateSpecs(zones as never);
  const plates = plateSpecs.map((p) => p.bbox);

  // Dims = clean template natural size (recompositeOverlay's convention).
  const clean = new NodeImage();
  clean.src = bufMap.get(input.clean_template_url)!;
  const W = clean.width, H = clean.height;

  // Sampling canvas (draw the clean template so sampleRing sees real pixels).
  const sc = createCanvas(W, H);
  const sctx = sc.getContext('2d') as unknown as CanvasRenderingContext2D;
  sctx.drawImage(clean as unknown as CanvasImageSource, 0, 0, W, H);

  const photoZ = photoZonesOf(zones as never);
  const intersect = (a: number[], b: number[]) => !(a[0] + a[2] <= b[0] || a[0] >= b[0] + b[2] || a[1] + a[3] <= b[1] || a[1] >= b[1] + b[3]);
  const occupied = (bbox: [number, number, number, number]) => layers.some((l) => l.placed !== false && String(l.text).trim()
    && (l.xPct / 100) * W >= bbox[0] * W - bbox[2] * W * 0.15 && (l.xPct / 100) * W <= (bbox[0] + bbox[2]) * W + bbox[2] * W * 0.15
    && (l.yPct / 100) * H >= bbox[1] * H - bbox[3] * H * 0.5 && (l.yPct / 100) * H <= (bbox[1] + bbox[3]) * H + bbox[3] * H * 0.5);

  // Per-zone ZoneRecords — the exact input decidePatches consumes in production.
  const recs = plateSpecs.map(({ bbox, role }) => {
    const bx = bbox[0] * W, by = bbox[1] * H, bw = bbox[2] * W, bh = bbox[3] * H;
    const feather = Math.max(8, Math.min(12, Math.round(W / 100)));
    const base = planPatch(sampleRing(sctx, bx, by, bw, bh, W, H, feather));
    return { role, bbox, areaFrac: areaFrac(bbox), areaPct: +(areaFrac(bbox) * 100).toFixed(2),
      occupied: occupied(bbox), intersectsPhoto: photoZ.some((p) => intersect(bbox, p)), base };
  });

  const conservative = decidePatches ? decidePatches(recs as unknown[]) : null;

  // Render composited.png via the REAL production compositor.
  const composed = await renderTextLayers(input.clean_template_url, layers as never, W, H, undefined, plateSpecs, input.primary_color, photoZ);
  const outDir = path.join('scripts/replay-out', id);
  fs.mkdirSync(outDir, { recursive: true });
  const cimg = new NodeImage(); cimg.src = composed; // data:image/jpeg;...
  const cc = createCanvas(W, H); const cctx = cc.getContext('2d');
  cctx.drawImage(cimg, 0, 0, W, H);
  fs.writeFileSync(path.join(outDir, 'composited.png'), cc.toBuffer('image/png'));

  // debug.png — clean + zone boxes + verdict labels.
  const dc = createCanvas(W, H); const dctx = dc.getContext('2d');
  dctx.drawImage(clean, 0, 0, W, H);
  recs.forEach((r, i) => {
    const [x, y, w, h] = [r.bbox[0] * W, r.bbox[1] * H, r.bbox[2] * W, r.bbox[3] * H];
    const finalMode = (conservative?.zones[i]?.mode as string) ?? r.base.mode;
    dctx.lineWidth = 3;
    dctx.strokeStyle = finalMode === 'skip' ? '#22c55e' : finalMode === 'chip' ? '#eab308' : '#ef4444';
    dctx.strokeRect(x, y, w, h);
    dctx.font = 'bold 20px sans-serif'; dctx.fillStyle = '#000'; dctx.fillRect(x, y, 360, 26);
    dctx.fillStyle = '#fff';
    dctx.fillText(`${r.role} ${r.areaPct}% raw:${r.base.mode}→${finalMode}${r.occupied ? '' : ' [empty]'}`, x + 4, y + 20);
  });
  fs.writeFileSync(path.join(outDir, 'debug.png'), dc.toBuffer('image/png'));

  // decisions.json
  const totalPatchPct = recs.filter((r) => r.base.mode !== 'skip').reduce((s, r) => s + r.areaPct, 0);
  const conservativePatchPct = conservative
    ? conservative.zones.reduce((s, z, i) => s + (z.mode !== 'skip' ? recs[i].areaPct : 0), 0) : null;
  const decisions = {
    id, dims: { W, H }, model_used: input.model_used, primary_color: input.primary_color,
    totalRawPatchAreaPct: +totalPatchPct.toFixed(2),
    conservativePatchAreaPct: conservativePatchPct === null ? null : +conservativePatchPct.toFixed(2),
    conservativePolicyPresent: !!decidePatches,
    globalPatchingDisabled: conservative?.globalPatchingDisabled ?? false,
    zones: recs.map((r, i) => ({
      role: r.role, areaPct: r.areaPct, occupied: r.occupied, intersectsPhoto: r.intersectsPhoto,
      plan_raw: r.base.mode,
      plan_conservative: (conservative?.zones[i]?.mode as string) ?? null,
      reason: (conservative?.zones[i]?.reason as string) ?? null,
      topColor: r.base.topColor, bottomColor: r.base.bottomColor,
    })),
  };
  fs.writeFileSync(path.join(outDir, 'decisions.json'), JSON.stringify(decisions, null, 2));

  console.log(`replayed ${id}: ${plates.length} plates, raw patch area ${decisions.totalRawPatchAreaPct}% ` +
    `${decidePatches ? `→ conservative (globalDisabled=${decisions.globalPatchingDisabled})` : '(pre-fix: patches every plate)'}`);
  console.log('wrote', outDir + '/{composited,debug}.png + decisions.json');
}

main().catch((e) => { console.error(e); process.exit(1); });

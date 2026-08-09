// RB-P8 chip-placement evidence: renders buildLayersFromZones' suggestion chips
// at their zone-anchored default positions, proving each essential (incl. the new
// location chip) lands at a sensible spot. Not a runtime dep — a dev/evidence tool.
//   npx tsx scripts/chip-map.ts   (needs `canvas`: npm i --no-save canvas tsx)
import { createCanvas } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { buildLayersFromZones, refHeightFor } from '../src/lib/zone-layers.ts';
import type { ReferenceZone } from '../src/lib/reference-style.ts';

const W = 1024, H = 1536;
const z = (role: ReferenceZone['role'], bbox: [number, number, number, number], align: ReferenceZone['align'] = 'left'): ReferenceZone =>
  ({ role, bbox, align, fontScale: 0.05, weight: 'bold', color: '#fff' });

// A representative reference layout: headline band (top), a photo, a price callout,
// a footer contact strip, and an empty subheadline zone the location chip can claim.
const zones: ReferenceZone[] = [
  z('headline', [0.06, 0.04, 0.88, 0.10], 'center'),
  z('photo', [0.06, 0.16, 0.88, 0.52]),
  z('price', [0.06, 0.72, 0.5, 0.07]),
  z('subheadline', [0.06, 0.82, 0.6, 0.05]),   // no copy → stays free → location lands here
  z('cta', [0.06, 0.92, 0.5, 0.06]),
  z('footer', [0.06, 0.985, 0.88, 0.03], 'center'),
];
const copy = {
  headline: 'Grand Mark Residences',
  price: '₹ 82 Lakh*',
  cta: 'Book a Site Visit',
  footer: '+91 98xxxxxx01 · WhatsApp',
  location: 'Patia, Bhubaneswar',
};

const layers = buildLayersFromZones(zones, copy, { refHeight: refHeightFor(W, H) });

const cv = createCanvas(W, H);
const g = cv.getContext('2d');
g.fillStyle = '#0f1b2d'; g.fillRect(0, 0, W, H);
// zone outlines (context)
g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
for (const zz of zones) { const [x, y, w, h] = zz.bbox; g.strokeRect(x * W, y * H, w * W, h * H); }
// chips at their anchored positions
for (const l of layers) {
  const x = (l.xPct / 100) * W, y = (l.yPct / 100) * H;
  g.fillStyle = l.placed === false ? '#f59e0b' : '#34d399';
  g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
  g.font = 'bold 20px sans-serif';
  g.fillText(`${l.text}  [${l.placed === false ? 'chip' : 'placed'}]`, x + 12, y + 7);
}
g.fillStyle = '#93c5fd'; g.font = 'bold 22px sans-serif';
g.fillText('RB-P8 chip anchors (orange = placed:false suggestion chip)', 20, H - 16);

const outDir = 'scripts/replay-out/p8-chipmap'; fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'chip-map.png'), cv.toBuffer('image/png'));
console.log(`chip-map → ${outDir}/chip-map.png`);
for (const l of layers) console.log(`  ${l.placed === false ? 'chip ' : 'place'} "${l.text}" @ (${l.xPct.toFixed(1)}%, ${l.yPct.toFixed(1)}%)`);

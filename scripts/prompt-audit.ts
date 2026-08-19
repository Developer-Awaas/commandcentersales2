// STEP 1 — dump the directive AS ACTUALLY ASSEMBLED. Imports the real builders;
// restating them here is the exact mistake that made a prior finding a false
// alarm for a day (see CLAUDE.md, replicate-live-check).
import { buildReplicateLayoutPrompt } from '../src/lib/senior-designer-prompts';
import type { PhotoPanel, PanelSlot } from '../src/lib/reference-style';

const panels: PhotoPanel[] = [
  { index: 1, bbox: [0.18, 0.18, 0.64, 0.42], shapeHint: 'rect',  approxArea: 0.27, isBuilding: true,  contentHint: 'building' },
  { index: 2, bbox: [0.06, 0.66, 0.26, 0.18], shapeHint: 'circle', approxArea: 0.05, isBuilding: false, contentHint: 'pool' },
  { index: 3, bbox: [0.37, 0.66, 0.26, 0.18], shapeHint: 'wedge',  approxArea: 0.05, isBuilding: false, contentHint: 'gym' },
  { index: 4, bbox: [0.68, 0.66, 0.26, 0.18], shapeHint: 'wedge',  approxArea: 0.05, isBuilding: false, contentHint: 'other' },
];
const slots: PanelSlot[] = [
  { panelIndex: 1, source: 'hero' },
  { panelIndex: 2, source: 'media', mediaUrl: 'https://x/pool.png' },
  { panelIndex: 3, source: 'empty' },
  { panelIndex: 4, source: 'empty' },
];

const cases: [string, string][] = [
  ['CASE A — blank, Crystal Garden-class ref, NO panels', buildReplicateLayoutPrompt(1)],
  ['CASE B — blank, panel ref WITH assignments',          buildReplicateLayoutPrompt(1, { panels, slots })],
];

for (const [label, text] of cases) {
  console.log('\n' + '='.repeat(78));
  console.log(label);
  console.log('='.repeat(78));
  text.split('\n\n').forEach((block, i) => console.log(`\n[${String(i + 1).padStart(2, '0')}] ${block}`));
}

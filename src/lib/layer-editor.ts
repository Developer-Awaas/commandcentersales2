// layer-editor.ts — pure reducer + undo stack for the text-overlay mini-editor
// (STEP 3). No DOM, no canvas: the editor UI (TextLayerEditor) drives this, and it's
// unit-testable in isolation. Save persists `state.layers` via the existing
// overlay-recompose path. Scope is deliberately small — see EDITOR_OUT_OF_SCOPE.
import { type TextLayer } from './text-layers';

/** IN scope: text (size/weight/color/align), drag + arrow nudge, resize box, add
 *  (blank or from a suggestion chip), delete, per-layer chip backing, logo layer
 *  (position/scale/swap), simple z-order (template < logo < text), in-session undo.
 *  OUT of scope (use "Edit in Canva"): filters, crops, arbitrary image manipulation,
 *  uploads into the canvas, effects, multi-select. Do not add them here. */
export const EDITOR_OUT_OF_SCOPE = ['filters', 'crops', 'image-manipulation', 'uploads', 'effects', 'multi-select'] as const;

/** ~85%-opacity slate chip — the backing rounded-rect, now a user toggle, not an eraser. */
export const CHIP_BACKING = 'rgba(15,23,42,0.85)';
export const HISTORY_CAP = 20;

export interface EditorState {
  layers: TextLayer[];
  history: TextLayer[][]; // prior snapshots, most-recent last, capped at HISTORY_CAP
}

export type EditorAction =
  | { type: 'set'; layers: TextLayer[] }                       // (re)initialise, not undoable
  | { type: 'update'; id: string; patch: Partial<TextLayer> }  // size/weight/color/align/resize/chip
  | { type: 'add'; layer: TextLayer }                          // blank or from a suggestion
  | { type: 'delete'; id: string }
  | { type: 'nudge'; id: string; dxPct: number; dyPct: number } // arrow keys (clamped 0..100)
  | { type: 'move'; id: string; xPct: number; yPct: number }   // live drag — NO history (see checkpoint)
  | { type: 'checkpoint' }                                     // snapshot layers before a drag
  | { type: 'place'; id: string }                             // suggestion → placed
  | { type: 'undo' };

export const initEditor = (layers: TextLayer[]): EditorState => ({ layers, history: [] });

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const pushHistory = (s: EditorState): TextLayer[][] =>
  [...s.history, s.layers].slice(-HISTORY_CAP);

/** Pure reducer. Every mutating action snapshots the prior layers for undo. */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set':
      return { layers: action.layers, history: [] };
    case 'update':
      return { history: pushHistory(state), layers: state.layers.map((l) => (l.id === action.id ? { ...l, ...action.patch } : l)) };
    case 'add':
      return { history: pushHistory(state), layers: [...state.layers, action.layer] };
    case 'delete':
      return { history: pushHistory(state), layers: state.layers.filter((l) => l.id !== action.id) };
    case 'nudge':
      return { history: pushHistory(state), layers: state.layers.map((l) => (l.id === action.id
        ? { ...l, xPct: clamp(l.xPct + action.dxPct), yPct: clamp(l.yPct + action.dyPct) } : l)) };
    case 'move': // live drag — position only, no snapshot (drag-start dispatched 'checkpoint')
      return { ...state, layers: state.layers.map((l) => (l.id === action.id
        ? { ...l, xPct: clamp(action.xPct), yPct: clamp(action.yPct) } : l)) };
    case 'checkpoint':
      return { ...state, history: pushHistory(state) };
    case 'place':
      return { history: pushHistory(state), layers: state.layers.map((l) => (l.id === action.id ? { ...l, placed: true } : l)) };
    case 'undo': {
      if (!state.history.length) return state;
      const prev = state.history[state.history.length - 1];
      return { layers: prev, history: state.history.slice(0, -1) };
    }
    default:
      return state;
  }
}

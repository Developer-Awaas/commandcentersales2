// layer-editor.ts — pure reducer + undo stack for the text-overlay mini-editor
// (STEP 3). No DOM, no canvas: the editor UI (TextLayerEditor) drives this, and it's
// unit-testable in isolation. Save persists `state.layers` via the existing
// overlay-recompose path. Scope is deliberately small — see EDITOR_OUT_OF_SCOPE.
import { type TextLayer } from './text-layers';

/** IN scope: text (size/weight/color/align), IMAGE layers (logo/project media/upload,
 *  scale + aspect-lock), drag + arrow nudge, resize box, add (blank/suggestion/image),
 *  delete, per-layer chip backing, per-layer opacity, hide toggle, z-order reorder via
 *  the layer list, in-session undo. OUT of scope (use "Edit in Canva"): filters, crops,
 *  arbitrary pixel manipulation, effects, multi-select. Do not add them here.
 *  NOTE (RB-P5): image UPLOAD is now in scope (org-scoped storage), so it left the
 *  out-of-scope list — "uploads" there meant arbitrary canvas image-editing, not a
 *  placed image layer. */
export const EDITOR_OUT_OF_SCOPE = ['filters', 'crops', 'image-manipulation', 'effects', 'multi-select'] as const;

/** ~85%-opacity slate chip — the backing rounded-rect, now a user toggle, not an eraser. */
export const CHIP_BACKING = 'rgba(15,23,42,0.85)';
export const HISTORY_CAP = 20;

export interface EditorState {
  layers: TextLayer[];
  history: TextLayer[][]; // prior snapshots, most-recent last, capped at HISTORY_CAP
  /**
   * PART D — ordered log of the operations performed this session, for
   * review_events.editor_ops. `history` cannot serve this: it stores layer
   * SNAPSHOTS for undo, so "what did the designer actually do" would have to
   * be re-derived by diffing, and an undone action would vanish entirely —
   * yet "tried it and reverted it" is real signal about the generated output.
   *
   * Excludes 'move' (fires per drag frame; the paired 'checkpoint' represents
   * the drag) and 'set' (initialisation, not an edit).
   */
  ops: string[];
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
  | { type: 'reorder'; order: string[] }                      // new z-order (layer list drag)
  | { type: 'undo' };

export const initEditor = (layers: TextLayer[]): EditorState => ({ layers, history: [], ops: [] });

// Same cap as history — an op log is a digest, not an audit trail, and an
// unbounded array would grow with every arrow-key nudge.
const pushOp = (s: EditorState, op: string): string[] => [...s.ops, op].slice(-HISTORY_CAP);

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const pushHistory = (s: EditorState): TextLayer[][] =>
  [...s.history, s.layers].slice(-HISTORY_CAP);

/** Pure reducer. Every mutating action snapshots the prior layers for undo. */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set':
      return { layers: action.layers, history: [], ops: state.ops };
    case 'update':
      return { history: pushHistory(state), ops: pushOp(state, 'update'), layers: state.layers.map((l) => (l.id === action.id ? { ...l, ...action.patch } : l)) };
    case 'add':
      return { history: pushHistory(state), ops: pushOp(state, 'add'), layers: [...state.layers, action.layer] };
    case 'delete':
      return { history: pushHistory(state), ops: pushOp(state, 'delete'), layers: state.layers.filter((l) => l.id !== action.id) };
    case 'nudge':
      return { history: pushHistory(state), ops: pushOp(state, 'nudge'), layers: state.layers.map((l) => (l.id === action.id
        ? { ...l, xPct: clamp(l.xPct + action.dxPct), yPct: clamp(l.yPct + action.dyPct) } : l)) };
    case 'move': // live drag — position only, no snapshot (drag-start dispatched 'checkpoint')
      return { ...state, layers: state.layers.map((l) => (l.id === action.id
        ? { ...l, xPct: clamp(action.xPct), yPct: clamp(action.yPct) } : l)) };
    case 'checkpoint':
      return { ...state, history: pushHistory(state), ops: pushOp(state, 'move') };
    case 'place':
      return { history: pushHistory(state), ops: pushOp(state, 'place'), layers: state.layers.map((l) => (l.id === action.id ? { ...l, placed: true } : l)) };
    case 'reorder': {
      // Reorder by the given id list; any layer missing from `order` (defensive)
      // keeps its relative position at the end.
      const byId = new Map(state.layers.map((l) => [l.id, l]));
      const ordered = action.order.map((id) => byId.get(id)).filter((l): l is TextLayer => !!l);
      const rest = state.layers.filter((l) => !action.order.includes(l.id));
      return { history: pushHistory(state), ops: pushOp(state, 'reorder'), layers: [...ordered, ...rest] };
    }
    case 'undo': {
      if (!state.history.length) return state;
      const prev = state.history[state.history.length - 1];
      return { layers: prev, history: state.history.slice(0, -1), ops: pushOp(state, 'undo') };
    }
    default:
      return state;
  }
}

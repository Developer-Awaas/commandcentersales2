import { describe, it, expect } from 'vitest';
import { editorReducer, initEditor, HISTORY_CAP, type EditorState } from './layer-editor';
import type { TextLayer } from './text-layers';

const L = (id: string, over: Partial<TextLayer> = {}): TextLayer =>
  ({ id, text: id, xPct: 10, yPct: 10, fontSizePx: 30, fontWeight: 'bold', color: '#fff', align: 'left', ...over });

const s0 = (): EditorState => initEditor([L('a'), L('b')]);

describe('editorReducer — layer ops', () => {
  it('update patches only the target layer and snapshots history', () => {
    const s = editorReducer(s0(), { type: 'update', id: 'a', patch: { fontSizePx: 99, color: '#000' } });
    expect(s.layers.find((l) => l.id === 'a')).toMatchObject({ fontSizePx: 99, color: '#000' });
    expect(s.layers.find((l) => l.id === 'b')!.fontSizePx).toBe(30);
    expect(s.history).toHaveLength(1);
  });

  it('add appends, delete removes, place flips placed→true', () => {
    let s = editorReducer(s0(), { type: 'add', layer: L('c') });
    expect(s.layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    s = editorReducer(s, { type: 'delete', id: 'b' });
    expect(s.layers.map((l) => l.id)).toEqual(['a', 'c']);
    s = editorReducer(initEditor([L('x', { placed: false })]), { type: 'place', id: 'x' });
    expect(s.layers[0].placed).toBe(true);
  });

  it('nudge moves by delta and clamps to 0..100', () => {
    const s = editorReducer(initEditor([L('a', { xPct: 1, yPct: 99 })]), { type: 'nudge', id: 'a', dxPct: -5, dyPct: 5 });
    expect(s.layers[0]).toMatchObject({ xPct: 0, yPct: 100 }); // clamped both ends
  });

  it('live drag: move sets position with NO history; checkpoint snapshots once', () => {
    let s = editorReducer(s0(), { type: 'checkpoint' });          // drag start
    s = editorReducer(s, { type: 'move', id: 'a', xPct: 40, yPct: 55 }); // dragging…
    s = editorReducer(s, { type: 'move', id: 'a', xPct: 42, yPct: 60 });
    expect(s.layers.find((l) => l.id === 'a')).toMatchObject({ xPct: 42, yPct: 60 });
    expect(s.history).toHaveLength(1); // one snapshot for the whole drag
    expect(editorReducer(s, { type: 'undo' }).layers).toEqual(s0().layers); // undo whole drag
  });
});

describe('editorReducer — RB-P5 reorder / hide / opacity', () => {
  it('reorder rearranges z-order by id list and snapshots history', () => {
    const s = editorReducer(initEditor([L('a'), L('b'), L('c')]), { type: 'reorder', order: ['c', 'a', 'b'] });
    expect(s.layers.map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(s.history).toHaveLength(1);
    expect(editorReducer(s, { type: 'undo' }).layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('reorder keeps layers missing from the order list at the end (defensive)', () => {
    const s = editorReducer(initEditor([L('a'), L('b'), L('c')]), { type: 'reorder', order: ['b', 'a'] });
    expect(s.layers.map((l) => l.id)).toEqual(['b', 'a', 'c']);
  });

  it('hide + opacity go through update (undoable) without touching siblings', () => {
    let s = editorReducer(initEditor([L('a'), L('b')]), { type: 'update', id: 'a', patch: { hidden: true } });
    expect(s.layers.find((l) => l.id === 'a')!.hidden).toBe(true);
    s = editorReducer(s, { type: 'update', id: 'a', patch: { opacity: 40 } });
    expect(s.layers.find((l) => l.id === 'a')!.opacity).toBe(40);
    expect(s.layers.find((l) => l.id === 'b')!.hidden).toBeUndefined();
    expect(s.layers.find((l) => l.id === 'b')!.opacity).toBeUndefined();
    expect(editorReducer(s, { type: 'undo' }).layers.find((l) => l.id === 'a')!.opacity).toBeUndefined();
  });
});

describe('editorReducer — undo stack', () => {
  it('undo restores the exact prior layers', () => {
    const before = s0();
    const after = editorReducer(before, { type: 'update', id: 'a', patch: { fontSizePx: 77 } });
    const undone = editorReducer(after, { type: 'undo' });
    expect(undone.layers).toEqual(before.layers);
    expect(undone.history).toHaveLength(0);
  });

  it('undo on empty history is a no-op', () => {
    const s = s0();
    expect(editorReducer(s, { type: 'undo' })).toEqual(s);
  });

  it(`history is capped at ${HISTORY_CAP} snapshots`, () => {
    let s = s0();
    for (let i = 0; i < HISTORY_CAP + 5; i++) s = editorReducer(s, { type: 'update', id: 'a', patch: { fontSizePx: i } });
    expect(s.history).toHaveLength(HISTORY_CAP);
  });

  it('set clears history (fresh init, not undoable)', () => {
    const s = editorReducer(s0(), { type: 'set', layers: [L('z')] });
    expect(s.layers.map((l) => l.id)).toEqual(['z']);
    expect(s.history).toHaveLength(0);
  });
});

describe('editor op log (P2.13 PART D)', () => {
  const layer = (id: string): TextLayer => ({
    id, text: id, xPct: 10, yPct: 10, fontSizePx: 40,
    fontWeight: 'bold', color: '#fff', align: 'left',
  });

  it('starts empty and records each mutating action in order', () => {
    let s = initEditor([layer('a')]);
    s = editorReducer(s, { type: 'add', layer: layer('b') });
    s = editorReducer(s, { type: 'update', id: 'a', patch: { fontSizePx: 60 } });
    s = editorReducer(s, { type: 'delete', id: 'b' });
    expect(s.ops).toEqual(['add', 'update', 'delete']);
  });

  it('does not log a live drag frame, only its checkpoint', () => {
    // 'move' fires per pointer frame; logging it would drown the digest in
    // hundreds of entries that say nothing about what was changed.
    let s = initEditor([layer('a')]);
    s = editorReducer(s, { type: 'checkpoint' });
    s = editorReducer(s, { type: 'move', id: 'a', xPct: 20, yPct: 30 });
    s = editorReducer(s, { type: 'move', id: 'a', xPct: 25, yPct: 35 });
    expect(s.ops).toEqual(['move']);
  });

  it('records an undo rather than erasing what was undone', () => {
    // "Tried it and reverted it" is real signal about the generated output.
    let s = initEditor([layer('a')]);
    s = editorReducer(s, { type: 'delete', id: 'a' });
    s = editorReducer(s, { type: 'undo' });
    expect(s.ops).toEqual(['delete', 'undo']);
    expect(s.layers.map((l) => l.id)).toEqual(['a']);
  });

  it('keeps the log bounded', () => {
    let s = initEditor([layer('a')]);
    for (let i = 0; i < HISTORY_CAP + 25; i++) {
      s = editorReducer(s, { type: 'nudge', id: 'a', dxPct: 1, dyPct: 0 });
    }
    expect(s.ops.length).toBe(HISTORY_CAP);
  });

  it('re-initialising with set does not invent ops', () => {
    let s = initEditor([layer('a')]);
    s = editorReducer(s, { type: 'add', layer: layer('b') });
    s = editorReducer(s, { type: 'set', layers: [layer('c')] });
    expect(s.ops).toEqual(['add']);
    expect(s.history).toEqual([]);
  });
});

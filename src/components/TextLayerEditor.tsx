import { useReducer, useState, useEffect, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X, Plus, Trash2, Bold, AlignLeft, AlignCenter, AlignRight, Undo2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useMeasuredWidth } from '../hooks/useMeasuredWidth';
import { TEXT_LAYER_REFERENCE_WIDTH, isPlaced, isLogoLayer, type TextLayer } from '../lib/text-layers';
import { editorReducer, initEditor, CHIP_BACKING } from '../lib/layer-editor';

interface TextLayerEditorProps {
  assetId: string;
  imageUrl: string;
  layers: TextLayer[];
  onSave: (layers: TextLayer[]) => void;
  onClose: () => void;
}

const FONT_STACK = `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;

// Mini-editor scope: minor adjustments only. Filters / crops / image manipulation /
// arbitrary uploads / effects / multi-select are intentionally NOT here — that's
// what "Edit in Canva" is for (see EDITOR_OUT_OF_SCOPE in layer-editor.ts).
export function TextLayerEditor({ assetId, imageUrl, layers: initialLayers, onSave, onClose }: TextLayerEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initialLayers, initEditor);
  const layers = state.layers;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [brand, setBrand] = useState<{ palette: string[]; logos: string[] }>({ palette: [], logos: [] });
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>();
  const dragState = useRef<{ id: string; offsetXPct: number; offsetYPct: number } | null>(null);

  const scale = width / TEXT_LAYER_REFERENCE_WIDTH;
  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const suggestions = layers.filter((l) => l.placed === false);

  // Brand palette + logo variants for the color swatches / logo-swap (self-contained).
  useEffect(() => {
    supabase.from('brand_kits').select('primary_color, accent_color, logo_white_url, logo_color_url, logo_dark_url').maybeSingle()
      .then(({ data }) => {
        const k = (data ?? {}) as Record<string, string | null>;
        setBrand({
          palette: [k.primary_color, k.accent_color, '#ffffff', '#111827'].filter(Boolean) as string[],
          logos: [k.logo_white_url, k.logo_color_url, k.logo_dark_url].filter(Boolean) as string[],
        });
      });
  }, []);

  const update = (id: string, patch: Partial<TextLayer>) => dispatch({ type: 'update', id, patch });

  function pointerPct(e: ReactPointerEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 };
  }
  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>, layer: TextLayer) {
    e.stopPropagation();
    setSelectedId(layer.id);
    dispatch({ type: 'checkpoint' }); // one undo entry for the whole drag
    const { x, y } = pointerPct(e);
    dragState.current = { id: layer.id, offsetXPct: x - layer.xPct, offsetYPct: y - layer.yPct };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    const { id, offsetXPct, offsetYPct } = dragState.current;
    const { x, y } = pointerPct(e);
    dispatch({ type: 'move', id, xPct: x - offsetXPct, yPct: y - offsetYPct });
  }
  const handlePointerUp = () => { dragState.current = null; };

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (!selectedId || !e.key.startsWith('Arrow')) return;
    const step = e.shiftKey ? 2 : 0.5;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    dispatch({ type: 'nudge', id: selectedId, dxPct: d[0], dyPct: d[1] });
  }

  function addLayer() {
    const id = crypto.randomUUID();
    dispatch({ type: 'add', layer: { id, text: 'New text', xPct: 35, yPct: 45, fontSizePx: 36, fontWeight: 'bold', color: '#ffffff', align: 'left' } });
    setSelectedId(id);
  }
  function deleteLayer(id: string) {
    dispatch({ type: 'delete', id });
    if (selectedId === id) setSelectedId(null);
  }
  function placeLayer(id: string) { dispatch({ type: 'place', id }); setSelectedId(id); }
  function swapLogo(layer: TextLayer) {
    if (brand.logos.length < 2) return;
    const i = brand.logos.indexOf(layer.imageUrl ?? '');
    update(layer.id, { imageUrl: brand.logos[(i + 1) % brand.logos.length] });
  }

  async function handleSave() {
    setSaving(true); setErrorMsg('');
    const { error } = await supabase.from('creative_assets')
      .update({ text_layers: layers, updated_at: new Date().toISOString() }).eq('id', assetId);
    setSaving(false);
    if (error) { setErrorMsg(error.message); return; }
    onSave(layers);
  }

  const toolBtn = (active: boolean) => `p-2 rounded-lg border transition-all ${active ? 'bg-brand/10 border-brand text-brand' : 'border-border text-text-tertiary hover:text-text-primary'}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="bg-surface-elevated border border-border rounded-2xl shadow-modal w-full max-w-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-semibold text-text-primary">Edit Text</span>
          <div className="flex items-center gap-1">
            <button onClick={() => dispatch({ type: 'undo' })} disabled={!state.history.length}
              className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary disabled:opacity-30 transition-all" title="Undo">
              <Undo2 size={14} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-all"><X size={14} /></button>
          </div>
        </div>

        <div className="p-4 overflow-auto flex-1 min-h-0">
          {layers.length === 0 && (
            <p className="mb-3 text-[11px] leading-relaxed text-text-tertiary bg-surface-sunken rounded-lg px-3 py-2">
              This is an <strong>AI-designed</strong> creative — the text is baked into the image and <strong>can’t be edited</strong> here. Use <span className="font-medium text-text-secondary">＋ Add</span> below to place new layers (headline, price, logo) on top.
            </p>
          )}
          <div ref={containerRef} className="relative w-full rounded-lg overflow-hidden bg-surface-sunken select-none"
            onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}>
            <img src={imageUrl} alt="Creative preview" className="w-full h-auto block pointer-events-none" draggable={false} />
            {width > 0 && layers.filter(isPlaced).map((layer) => {
              const isSel = layer.id === selectedId;
              const sel = isSel ? 'outline outline-2 outline-brand outline-offset-2' : '';
              if (isLogoLayer(layer)) {
                return (
                  <img key={layer.id} src={layer.imageUrl} alt="logo" draggable={false}
                    onPointerDown={(e) => handlePointerDown(e, layer)}
                    className={`absolute cursor-move object-contain ${sel}`}
                    style={{ left: `${layer.xPct}%`, top: `${layer.yPct}%`, width: `${layer.widthPct ?? 20}%`, height: `${layer.heightPct ?? layer.widthPct ?? 20}%` }} />
                );
              }
              const padding = (layer.paddingPx ?? 0) * scale;
              return (
                <div key={layer.id} onPointerDown={(e) => handlePointerDown(e, layer)}
                  className={`absolute cursor-move whitespace-pre-wrap ${sel}`}
                  style={{
                    left: `${layer.xPct}%`, top: `${layer.yPct}%`,
                    transform: layer.align === 'center' ? 'translateX(-50%)' : layer.align === 'right' ? 'translateX(-100%)' : undefined,
                    width: layer.widthPct ? `${layer.widthPct}%` : undefined,
                    fontSize: `${layer.fontSizePx * scale}px`, fontWeight: layer.fontWeight === 'bold' ? 700 : 400,
                    color: layer.color, textAlign: layer.align, backgroundColor: layer.backgroundColor,
                    padding: layer.backgroundColor ? `${padding}px` : undefined,
                    borderRadius: layer.borderRadiusPx ? `${layer.borderRadiusPx * scale}px` : undefined,
                    lineHeight: 1.25, fontFamily: FONT_STACK,
                  }}>
                  {layer.text || '(empty)'}
                </div>
              );
            })}
          </div>
          {selected && <p className="text-[11px] text-text-tertiary mt-1.5">Drag to move · arrow keys to nudge (Shift = larger) · template &amp; building are never edited here</p>}
        </div>

        {suggestions.length > 0 && (
          <div className="px-5 py-3 border-t border-border flex-shrink-0">
            <p className="text-[11px] text-text-tertiary mb-1.5">Suggested — tap to add, then drag to position:</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s.id} onClick={() => placeLayer(s.id)} title="Add to image"
                  className="flex items-center gap-1 max-w-[220px] px-2.5 py-1.5 rounded-full border border-dashed border-border text-xs text-text-secondary hover:text-text-primary hover:border-brand hover:bg-brand/5 transition-all">
                  <Plus size={12} className="flex-shrink-0" /><span className="truncate">{s.text || '(empty)'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selected && isLogoLayer(selected) && (
          <div className="px-5 py-3 border-t border-border flex-shrink-0 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-tertiary">Logo</span>
            <label className="text-xs text-text-tertiary flex items-center gap-1">W
              <input type="number" min={2} max={100} value={Math.round(selected.widthPct ?? 20)}
                onChange={(e) => update(selected.id, { widthPct: Number(e.target.value) || selected.widthPct })}
                className="w-14 px-2 py-1.5 rounded-lg border border-border bg-surface-sunken text-xs text-text-primary" /></label>
            <label className="text-xs text-text-tertiary flex items-center gap-1">H
              <input type="number" min={2} max={100} value={Math.round(selected.heightPct ?? selected.widthPct ?? 20)}
                onChange={(e) => update(selected.id, { heightPct: Number(e.target.value) || selected.heightPct })}
                className="w-14 px-2 py-1.5 rounded-lg border border-border bg-surface-sunken text-xs text-text-primary" /></label>
            {brand.logos.length > 1 && (
              <button onClick={() => swapLogo(selected)} className={toolBtn(false)} title="Swap logo variant"><RefreshCw size={14} /></button>
            )}
            <button onClick={() => deleteLayer(selected.id)} className="ml-auto p-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all" title="Delete"><Trash2 size={14} /></button>
          </div>
        )}

        {selected && !isLogoLayer(selected) && (
          <div className="px-5 py-3 border-t border-border flex-shrink-0 flex flex-col gap-2">
            <input value={selected.text} onChange={(e) => update(selected.id, { text: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface-sunken text-sm text-text-primary" placeholder="Layer text" />
            <div className="flex items-center gap-2 flex-wrap">
              <input type="number" min={10} max={200} value={selected.fontSizePx}
                onChange={(e) => update(selected.id, { fontSizePx: Number(e.target.value) || selected.fontSizePx })}
                className="w-16 px-2 py-1.5 rounded-lg border border-border bg-surface-sunken text-xs text-text-primary" title="Font size" />
              <label className="text-xs text-text-tertiary flex items-center gap-1" title="Text box width %">W
                <input type="number" min={5} max={100} value={Math.round(selected.widthPct ?? 84)}
                  onChange={(e) => update(selected.id, { widthPct: Number(e.target.value) || selected.widthPct })}
                  className="w-14 px-2 py-1.5 rounded-lg border border-border bg-surface-sunken text-xs text-text-primary" /></label>
              {brand.palette.map((c) => (
                <button key={c} onClick={() => update(selected.id, { color: c })} title={c}
                  className="w-6 h-6 rounded-md border border-border" style={{ backgroundColor: c }} />
              ))}
              <input type="color" value={selected.color} onChange={(e) => update(selected.id, { color: e.target.value })}
                className="w-8 h-8 rounded-lg border border-border bg-transparent cursor-pointer" title="Custom color" />
              <button onClick={() => update(selected.id, { fontWeight: selected.fontWeight === 'bold' ? 'normal' : 'bold' })} className={toolBtn(selected.fontWeight === 'bold')}><Bold size={14} /></button>
              <button onClick={() => update(selected.id, { align: 'left' })} className={toolBtn(selected.align === 'left')}><AlignLeft size={14} /></button>
              <button onClick={() => update(selected.id, { align: 'center' })} className={toolBtn(selected.align === 'center')}><AlignCenter size={14} /></button>
              <button onClick={() => update(selected.id, { align: 'right' })} className={toolBtn(selected.align === 'right')}><AlignRight size={14} /></button>
              <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer" title="Chip backing (~85% rounded panel behind the text)">
                <input type="checkbox" checked={!!selected.backgroundColor}
                  onChange={(e) => update(selected.id, e.target.checked ? { backgroundColor: CHIP_BACKING, paddingPx: 16, borderRadiusPx: 14 } : { backgroundColor: undefined, paddingPx: undefined, borderRadiusPx: undefined })} />
                Chip
              </label>
              {selected.backgroundColor && (
                <input type="color" value={selected.backgroundColor.startsWith('#') ? selected.backgroundColor : '#0f172a'}
                  onChange={(e) => update(selected.id, { backgroundColor: e.target.value })}
                  className="w-8 h-8 rounded-lg border border-border bg-transparent cursor-pointer" title="Chip color" />
              )}
              <button onClick={() => deleteLayer(selected.id)} className="ml-auto p-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all" title="Delete layer"><Trash2 size={14} /></button>
            </div>
          </div>
        )}

        {errorMsg && <p className="px-5 text-xs text-red-400">{errorMsg}</p>}

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border flex-shrink-0">
          <button onClick={addLayer} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text-tertiary text-xs font-medium hover:text-text-primary hover:border-border-strong transition-all">
            <Plus size={13} /> Add Text
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-tertiary hover:text-text-primary transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-medium hover:opacity-90 active:scale-95 transition-all disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

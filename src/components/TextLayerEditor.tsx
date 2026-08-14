import { useReducer, useState, useEffect, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X, Plus, Trash2, Bold, AlignLeft, AlignCenter, AlignRight, Undo2, RefreshCw, Type, Image as ImageIcon, Eye, EyeOff, GripVertical, Upload, Lock, Unlock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { useMeasuredWidth } from '../hooks/useMeasuredWidth';
import { TEXT_LAYER_REFERENCE_WIDTH, isVisible, isImageLayer, type TextLayer } from '../lib/text-layers';
import { editorReducer, initEditor, CHIP_BACKING } from '../lib/layer-editor';

interface TextLayerEditorProps {
  assetId: string;
  imageUrl: string;
  layers: TextLayer[];
  // PART D — ops is the session's edit log (layer-editor.ts EditorState.ops),
  // passed through so a review can record what was actually changed.
  onSave: (layers: TextLayer[], ops: string[]) => void;
  onClose: () => void;
  /** RB-P5: enables the "project media" image source (project_assets). Omit in
   *  contexts without a project — logo variants + upload still work. */
  projectId?: string;
}

const FONT_STACK = `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;

const layerLabel = (l: TextLayer): string =>
  l.name || (isImageLayer(l) ? 'Image' : (l.text?.trim() || 'Text'));

// Mini-editor scope: minor adjustments only. Filters / crops / pixel manipulation /
// effects / multi-select are NOT here — that's "Edit in Canva" (see
// EDITOR_OUT_OF_SCOPE in layer-editor.ts). Image LAYERS + upload ARE in scope (RB-P5).
export function TextLayerEditor({ assetId, imageUrl, layers: initialLayers, onSave, onClose, projectId }: TextLayerEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initialLayers, initEditor);
  const layers = state.layers;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [brand, setBrand] = useState<{ palette: string[]; logos: string[] }>({ palette: [], logos: [] });
  const [projectMedia, setProjectMedia] = useState<string[]>([]);
  const [showLayers, setShowLayers] = useState(true);
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>();
  const dragState = useRef<{ id: string; offsetXPct: number; offsetYPct: number } | null>(null);
  const rowDragId = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scale = width / TEXT_LAYER_REFERENCE_WIDTH;
  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const suggestions = layers.filter((l) => l.placed === false);

  // Brand palette + logo variants for the color swatches / logo source (self-contained).
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

  // Project media (optional image source) — only when a projectId is supplied.
  useEffect(() => {
    if (!projectId) return;
    supabase.from('project_assets').select('asset_url').eq('project_id', projectId).limit(24)
      .then(({ data }) => setProjectMedia(((data ?? []) as { asset_url?: string }[]).map((r) => r.asset_url).filter(Boolean) as string[]));
  }, [projectId]);

  const update = (id: string, patch: Partial<TextLayer>) => dispatch({ type: 'update', id, patch });

  function pointerPct(e: ReactPointerEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 };
  }
  function handlePointerDown(e: ReactPointerEvent<HTMLElement>, layer: TextLayer) {
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
  function addImageLayer(src: string, name?: string) {
    const id = crypto.randomUUID();
    dispatch({ type: 'add', layer: { id, type: 'image', name: name ?? 'Image', imageUrl: src, text: '', xPct: 40, yPct: 40, widthPct: 20, heightPct: 20, aspectLocked: true, fontSizePx: 0, fontWeight: 'normal', color: '#000', align: 'left' } });
    setSelectedId(id);
  }
  function deleteLayer(id: string) {
    dispatch({ type: 'delete', id });
    if (selectedId === id) setSelectedId(null);
  }
  function placeLayer(id: string) { dispatch({ type: 'place', id }); setSelectedId(id); }
  function pickSource(src: string) {
    if (selected && isImageLayer(selected)) update(selected.id, { imageUrl: src });
    else addImageLayer(src);
  }
  async function handleUpload(file: File) {
    setErrorMsg('');
    const orgId = getOrgId() || 'shared';
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `overlay-uploads/${orgId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('brand-assets').upload(path, file, { upsert: true, contentType: file.type });
    if (error) { setErrorMsg(`Upload failed: ${error.message}`); return; }
    const url = supabase.storage.from('brand-assets').getPublicUrl(path).data.publicUrl;
    pickSource(url);
  }

  // Layer-list drag-to-reorder → dispatch a new z-order (id list, top row = last drawn).
  function onRowDrop(targetId: string) {
    const src = rowDragId.current;
    rowDragId.current = null;
    if (!src || src === targetId) return;
    const ids = layers.map((l) => l.id);
    const from = ids.indexOf(src), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    dispatch({ type: 'reorder', order: ids });
  }

  async function handleSave() {
    setSaving(true); setErrorMsg('');
    const { error } = await supabase.from('creative_assets')
      .update({ text_layers: layers, updated_at: new Date().toISOString() }).eq('id', assetId);
    setSaving(false);
    if (error) { setErrorMsg(error.message); return; }
    onSave(layers, state.ops);
  }

  const toolBtn = (active: boolean) => `p-2 rounded-lg border transition-all ${active ? 'bg-brand/10 border-brand text-brand' : 'border-border text-text-tertiary hover:text-text-primary'}`;
  const imgSources = [...brand.logos, ...projectMedia];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="bg-surface-elevated border border-border rounded-2xl shadow-modal w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-semibold text-text-primary">Edit Text</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowLayers((s) => !s)} className={`p-1.5 rounded-lg hover:bg-surface-hover transition-all ${showLayers ? 'text-brand' : 'text-text-tertiary hover:text-text-primary'}`} title="Toggle layer list">
              <span className="text-[11px] font-medium px-1">Layers</span>
            </button>
            <button onClick={() => dispatch({ type: 'undo' })} disabled={!state.history.length}
              className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary disabled:opacity-30 transition-all" title="Undo">
              <Undo2 size={14} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-all"><X size={14} /></button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="p-4 overflow-auto flex-1 min-h-0">
            {layers.length === 0 && (
              <p className="mb-3 text-[11px] leading-relaxed text-text-tertiary bg-surface-sunken rounded-lg px-3 py-2">
                This is an <strong>AI-designed</strong> creative — the text is baked into the image and <strong>can’t be edited</strong> here. Use <span className="font-medium text-text-secondary">＋ Add</span> below to place new layers (text, logo, image) on top.
              </p>
            )}
            <div ref={containerRef} className="relative w-full rounded-lg overflow-hidden bg-surface-sunken select-none"
              onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
              onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}>
              <img src={imageUrl} alt="Creative preview" className="w-full h-auto block pointer-events-none" draggable={false} />
              {width > 0 && layers.filter(isVisible).map((layer) => {
                const isSel = layer.id === selectedId;
                const sel = isSel ? 'outline outline-2 outline-brand outline-offset-2' : '';
                if (isImageLayer(layer)) {
                  return (
                    <img key={layer.id} src={layer.imageUrl} alt={layerLabel(layer)} draggable={false}
                      onPointerDown={(e) => handlePointerDown(e, layer)}
                      className={`absolute cursor-move ${layer.aspectLocked === false ? 'object-fill' : 'object-contain'} ${sel}`}
                      style={{ left: `${layer.xPct}%`, top: `${layer.yPct}%`, width: `${layer.widthPct ?? 20}%`, height: `${layer.heightPct ?? layer.widthPct ?? 20}%`, opacity: (layer.opacity ?? 100) / 100 }} />
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
                      opacity: (layer.opacity ?? 100) / 100,
                      lineHeight: 1.25, fontFamily: FONT_STACK,
                    }}>
                    {layer.text || '(empty)'}
                  </div>
                );
              })}
            </div>
            {selected && <p className="text-[11px] text-text-tertiary mt-1.5">Drag to move · arrow keys to nudge (Shift = larger) · template &amp; building are never edited here</p>}
          </div>

          {/* Layer list (STEP 4) — ordered, click to select, drag to reorder z, eye to hide, delete. */}
          {showLayers && (
            <div className="w-48 flex-shrink-0 border-l border-border overflow-auto p-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary px-1 mb-1.5">Layers</p>
              {layers.length === 0 && <p className="text-[11px] text-text-disabled px-1">No layers yet.</p>}
              <div className="flex flex-col gap-0.5">
                {layers.map((l) => (
                  <div key={l.id} draggable
                    onDragStart={() => { rowDragId.current = l.id; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onRowDrop(l.id)}
                    onClick={() => setSelectedId(l.id)}
                    className={`flex items-center gap-1 px-1.5 py-1 rounded-md cursor-pointer text-[11px] ${l.id === selectedId ? 'bg-brand/10 text-text-primary' : 'text-text-secondary hover:bg-surface-hover'}`}>
                    <GripVertical size={11} className="text-text-disabled flex-shrink-0 cursor-grab" />
                    {isImageLayer(l) ? <ImageIcon size={11} className="flex-shrink-0" /> : <Type size={11} className="flex-shrink-0" />}
                    <span className={`flex-1 truncate ${l.placed === false ? 'italic text-text-disabled' : ''}`}>{layerLabel(l)}{l.placed === false ? ' ·chip' : ''}</span>
                    <button onClick={(e) => { e.stopPropagation(); update(l.id, { hidden: !l.hidden }); }} title={l.hidden ? 'Show' : 'Hide'} className="p-0.5 text-text-tertiary hover:text-text-primary">
                      {l.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteLayer(l.id); }} title="Delete" className="p-0.5 text-text-tertiary hover:text-red-400"><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="px-5 py-3 border-t border-border flex-shrink-0">
            <p className="text-[11px] text-text-tertiary mb-1.5">Suggested — tap to add, then drag to position:</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s.id} onClick={() => placeLayer(s.id)} title="Add to image"
                  className="flex items-center gap-1 max-w-[220px] px-2.5 py-1.5 rounded-full border border-dashed border-border text-xs text-text-secondary hover:text-text-primary hover:border-brand hover:bg-brand/5 transition-all">
                  <Plus size={12} className="flex-shrink-0" /><span className="truncate">{isImageLayer(s) ? layerLabel(s) : (s.text || '(empty)')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Image-layer toolbar (logo is just an image layer). */}
        {selected && isImageLayer(selected) && (
          <div className="px-5 py-3 border-t border-border flex-shrink-0 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-text-tertiary">Image</span>
              <label className="text-xs text-text-tertiary flex items-center gap-1">W
                <input type="number" min={2} max={100} value={Math.round(selected.widthPct ?? 20)}
                  onChange={(e) => update(selected.id, { widthPct: Number(e.target.value) || selected.widthPct })}
                  className="w-14 px-2 py-1.5 rounded-lg border border-border bg-surface-sunken text-xs text-text-primary" /></label>
              <label className="text-xs text-text-tertiary flex items-center gap-1">H
                <input type="number" min={2} max={100} value={Math.round(selected.heightPct ?? selected.widthPct ?? 20)}
                  onChange={(e) => update(selected.id, { heightPct: Number(e.target.value) || selected.heightPct })}
                  className="w-14 px-2 py-1.5 rounded-lg border border-border bg-surface-sunken text-xs text-text-primary" /></label>
              <button onClick={() => update(selected.id, { aspectLocked: selected.aspectLocked === false })} className={toolBtn(selected.aspectLocked !== false)} title={selected.aspectLocked !== false ? 'Aspect locked (click to free W/H)' : 'Aspect free (click to lock)'}>
                {selected.aspectLocked !== false ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
              <button onClick={() => deleteLayer(selected.id)} className="ml-auto p-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all" title="Delete layer"><Trash2 size={14} /></button>
            </div>
            <OpacitySlider value={selected.opacity ?? 100} onChange={(v) => update(selected.id, { opacity: v })} />
            {imgSources.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-text-tertiary">Source</span>
                {imgSources.map((src) => (
                  <button key={src} onClick={() => update(selected.id, { imageUrl: src })} title="Use this image"
                    className={`w-8 h-8 rounded-md border overflow-hidden ${selected.imageUrl === src ? 'border-brand' : 'border-border'}`}>
                    <img src={src} alt="" className="w-full h-full object-contain" />
                  </button>
                ))}
                <button onClick={() => fileRef.current?.click()} className={toolBtn(false)} title="Upload an image"><Upload size={14} /></button>
              </div>
            )}
          </div>
        )}

        {/* Text-layer toolbar. */}
        {selected && !isImageLayer(selected) && (
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
            <OpacitySlider value={selected.opacity ?? 100} onChange={(v) => update(selected.id, { opacity: v })} />
          </div>
        )}

        {errorMsg && <p className="px-5 text-xs text-red-400">{errorMsg}</p>}

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={addLayer} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text-tertiary text-xs font-medium hover:text-text-primary hover:border-border-strong transition-all">
              <Plus size={13} /> Add Text
            </button>
            {brand.logos.length > 0 && (
              <button onClick={() => addImageLayer(brand.logos[0], 'Logo')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text-tertiary text-xs font-medium hover:text-text-primary hover:border-border-strong transition-all">
                <RefreshCw size={13} /> Add Logo
              </button>
            )}
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text-tertiary text-xs font-medium hover:text-text-primary hover:border-border-strong transition-all">
              <ImageIcon size={13} /> Add Image
            </button>
          </div>
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

// Per-layer opacity 5–100% (STEP 3) — shared by text + image toolbars.
function OpacitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-text-tertiary">
      <span className="w-12">Opacity</span>
      <input type="range" min={5} max={100} value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-brand" />
      <span className="w-8 text-right tabular-nums text-text-secondary">{Math.round(value)}%</span>
    </label>
  );
}

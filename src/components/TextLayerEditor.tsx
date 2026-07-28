import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { X, Plus, Trash2, Bold, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useMeasuredWidth } from '../hooks/useMeasuredWidth';
import { TEXT_LAYER_REFERENCE_WIDTH, type TextLayer } from '../lib/text-layers';

interface TextLayerEditorProps {
  assetId: string;
  imageUrl: string;
  layers: TextLayer[];
  onSave: (layers: TextLayer[]) => void;
  onClose: () => void;
}

const FONT_STACK = `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;

export function TextLayerEditor({ assetId, imageUrl, layers: initialLayers, onSave, onClose }: TextLayerEditorProps) {
  const [layers, setLayers] = useState<TextLayer[]>(initialLayers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>();
  const dragState = useRef<{ id: string; offsetXPct: number; offsetYPct: number } | null>(null);

  const scale = width / TEXT_LAYER_REFERENCE_WIDTH;
  const selected = layers.find((l) => l.id === selectedId) ?? null;

  function updateLayer(id: string, patch: Partial<TextLayer>) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function pointerPct(e: ReactPointerEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>, layer: TextLayer) {
    e.stopPropagation();
    setSelectedId(layer.id);
    const { x, y } = pointerPct(e);
    dragState.current = { id: layer.id, offsetXPct: x - layer.xPct, offsetYPct: y - layer.yPct };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    const { id, offsetXPct, offsetYPct } = dragState.current;
    const { x, y } = pointerPct(e);
    updateLayer(id, {
      xPct: Math.min(100, Math.max(0, x - offsetXPct)),
      yPct: Math.min(100, Math.max(0, y - offsetYPct)),
    });
  }

  function handlePointerUp() {
    dragState.current = null;
  }

  function addLayer() {
    const id = crypto.randomUUID();
    setLayers((prev) => [
      ...prev,
      { id, text: 'New text', xPct: 35, yPct: 45, fontSizePx: 36, fontWeight: 'bold', color: '#ffffff', align: 'left' },
    ]);
    setSelectedId(id);
  }

  function deleteLayer(id: string) {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function handleSave() {
    setSaving(true);
    setErrorMsg('');
    const { error } = await supabase
      .from('creative_assets')
      .update({ text_layers: layers, updated_at: new Date().toISOString() })
      .eq('id', assetId);
    setSaving(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    onSave(layers);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface-elevated border border-border rounded-2xl shadow-modal w-full max-w-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-semibold text-text-primary">Edit Text</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-all">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 overflow-auto flex-1 min-h-0">
          <div
            ref={containerRef}
            className="relative w-full rounded-lg overflow-hidden bg-surface-sunken select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
          >
            <img src={imageUrl} alt="Creative preview" className="w-full h-auto block pointer-events-none" draggable={false} />
            {width > 0 && layers.map((layer) => {
              const isSelected = layer.id === selectedId;
              const padding = (layer.paddingPx ?? 0) * scale;
              return (
                <div
                  key={layer.id}
                  onPointerDown={(e) => handlePointerDown(e, layer)}
                  className={`absolute cursor-move whitespace-pre-wrap ${isSelected ? 'outline outline-2 outline-brand outline-offset-2' : ''}`}
                  style={{
                    left: `${layer.xPct}%`,
                    top: `${layer.yPct}%`,
                    transform:
                      layer.align === 'center' ? 'translateX(-50%)' :
                      layer.align === 'right' ? 'translateX(-100%)' : undefined,
                    width: layer.widthPct ? `${layer.widthPct}%` : undefined,
                    fontSize: `${layer.fontSizePx * scale}px`,
                    fontWeight: layer.fontWeight === 'bold' ? 700 : 400,
                    color: layer.color,
                    textAlign: layer.align,
                    backgroundColor: layer.backgroundColor,
                    padding: layer.backgroundColor ? `${padding}px` : undefined,
                    borderRadius: layer.borderRadiusPx ? `${layer.borderRadiusPx * scale}px` : undefined,
                    lineHeight: 1.25,
                    fontFamily: FONT_STACK,
                  }}
                >
                  {layer.text || '(empty)'}
                </div>
              );
            })}
          </div>
        </div>

        {selected && (
          <div className="px-5 py-3 border-t border-border flex-shrink-0 flex flex-col gap-2">
            <input
              value={selected.text}
              onChange={(e) => updateLayer(selected.id, { text: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface-sunken text-sm text-text-primary"
              placeholder="Layer text"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="number"
                min={10}
                max={200}
                value={selected.fontSizePx}
                onChange={(e) => updateLayer(selected.id, { fontSizePx: Number(e.target.value) || selected.fontSizePx })}
                className="w-16 px-2 py-1.5 rounded-lg border border-border bg-surface-sunken text-xs text-text-primary"
                title="Font size (px @1080 reference width)"
              />
              <input
                type="color"
                value={selected.color}
                onChange={(e) => updateLayer(selected.id, { color: e.target.value })}
                className="w-8 h-8 rounded-lg border border-border bg-transparent cursor-pointer"
                title="Text color"
              />
              <button
                onClick={() => updateLayer(selected.id, { fontWeight: selected.fontWeight === 'bold' ? 'normal' : 'bold' })}
                className={`p-2 rounded-lg border transition-all ${selected.fontWeight === 'bold' ? 'bg-brand/10 border-brand text-brand' : 'border-border text-text-tertiary hover:text-text-primary'}`}
              >
                <Bold size={14} />
              </button>
              <button onClick={() => updateLayer(selected.id, { align: 'left' })} className={`p-2 rounded-lg border transition-all ${selected.align === 'left' ? 'bg-brand/10 border-brand text-brand' : 'border-border text-text-tertiary hover:text-text-primary'}`}>
                <AlignLeft size={14} />
              </button>
              <button onClick={() => updateLayer(selected.id, { align: 'center' })} className={`p-2 rounded-lg border transition-all ${selected.align === 'center' ? 'bg-brand/10 border-brand text-brand' : 'border-border text-text-tertiary hover:text-text-primary'}`}>
                <AlignCenter size={14} />
              </button>
              <button onClick={() => updateLayer(selected.id, { align: 'right' })} className={`p-2 rounded-lg border transition-all ${selected.align === 'right' ? 'bg-brand/10 border-brand text-brand' : 'border-border text-text-tertiary hover:text-text-primary'}`}>
                <AlignRight size={14} />
              </button>
              <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!selected.backgroundColor}
                  onChange={(e) => updateLayer(selected.id, { backgroundColor: e.target.checked ? '#c9a961' : undefined, paddingPx: e.target.checked ? 18 : undefined, borderRadiusPx: e.target.checked ? 12 : undefined })}
                />
                Badge background
              </label>
              {selected.backgroundColor && (
                <input
                  type="color"
                  value={selected.backgroundColor}
                  onChange={(e) => updateLayer(selected.id, { backgroundColor: e.target.value })}
                  className="w-8 h-8 rounded-lg border border-border bg-transparent cursor-pointer"
                  title="Background color"
                />
              )}
              <button
                onClick={() => deleteLayer(selected.id)}
                className="ml-auto p-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all"
                title="Delete layer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )}

        {errorMsg && <p className="px-5 text-xs text-red-400">{errorMsg}</p>}

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border flex-shrink-0">
          <button
            onClick={addLayer}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text-tertiary text-xs font-medium hover:text-text-primary hover:border-border-strong transition-all"
          >
            <Plus size={13} /> Add Text
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-tertiary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-medium hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

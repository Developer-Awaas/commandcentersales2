import { type CSSProperties } from 'react';
import { useMeasuredWidth } from '../hooks/useMeasuredWidth';
import { TEXT_LAYER_REFERENCE_WIDTH, isPlaced, type TextLayer } from '../lib/text-layers';

interface TextLayerOverlayProps {
  layers: TextLayer[];
  className?: string;
}

const FONT_STACK = `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;

/**
 * Read-only live preview of text layers over an image. Place inside a
 * `position: relative` wrapper alongside the `<img>` — this component fills
 * that wrapper (`absolute inset-0`) and scales every layer from its
 * TEXT_LAYER_REFERENCE_WIDTH-relative values to the wrapper's actual
 * rendered width, so layers look proportionally correct at any display size.
 */
export function TextLayerOverlay({ layers, className }: TextLayerOverlayProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>();

  if (!layers.length) return null;
  const scale = width / TEXT_LAYER_REFERENCE_WIDTH;

  return (
    <div ref={containerRef} className={`absolute inset-0 pointer-events-none overflow-hidden ${className ?? ''}`}>
      {width > 0 && layers.map((layer) => {
        if (!isPlaced(layer) || !layer.text.trim()) return null; // unplaced = suggestion (FIX 3)
        const padding = (layer.paddingPx ?? 0) * scale;
        const style: CSSProperties = {
          position: 'absolute',
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
          whiteSpace: 'pre-wrap',
          lineHeight: 1.25,
          fontFamily: FONT_STACK,
        };
        return (
          <div key={layer.id} style={style}>
            {layer.text}
          </div>
        );
      })}
    </div>
  );
}

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOrgId, getUserId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import { downloadImage } from '../lib/image-utils';
import { AdobeExpressModal } from './AdobeExpressModal';
import { X, ChevronLeft, ChevronRight, ExternalLink, Layers, Download, Maximize2 } from 'lucide-react';

export interface GalleryImage {
  id?: string;
  url: string;
  label?: string;
  storagePath?: string;
  promptUsed?: string;
}

interface ImageGalleryViewerProps {
  images: GalleryImage[];
  onClose?: () => void;
}

interface LightboxState {
  index: number;
  adobeOpen: boolean;
}

export function ImageGalleryViewer({ images, onClose }: ImageGalleryViewerProps) {
  const { showToast } = useToast();
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [canvaLoading, setCanvaLoading] = useState<string | null>(null);
  const [adobeImage, setAdobeImage] = useState<GalleryImage | null>(null);

  if (!images.length) return null;

  async function handleCanva(img: GalleryImage) {
    setCanvaLoading(img.url);
    try {
      if (img.id) {
        // Asset already in DB — call edge function
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const res = await fetch(`${supabaseUrl}/functions/v1/canva-open-editor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify({ creativeAssetId: img.id, userId: getUserId() }),
        });
        const json = await res.json() as { editUrl?: string; needsAuth?: boolean; authUrl?: string; error?: string };
        if (json.editUrl) { window.open(json.editUrl, '_blank'); return; }
        if (json.authUrl) { window.location.href = json.authUrl; return; }
        if (json.error) throw new Error(json.error);
      }
      // Fallback: open Canva's direct image editor with URL encoded
      window.open(`https://www.canva.com/create/instagram-posts/`, '_blank');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Canva error', 'error');
    } finally {
      setCanvaLoading(null);
    }
  }

  function handleAdobe(img: GalleryImage) {
    setAdobeImage(img);
    if (lightbox) setLightbox(null);
  }

  function handleAdobeSave(editedUrl: string) {
    showToast('Saved via Adobe Express!', 'success');
    if (adobeImage?.id) {
      supabase.from('creative_assets').update({
        edited_image_url: editedUrl,
        editor_used: 'adobe_express',
        status: 'edited',
        updated_at: new Date().toISOString(),
      }).eq('id', adobeImage.id);
    }
    setAdobeImage(null);
  }

  const current = lightbox !== null ? images[lightbox.index] : null;

  return (
    <>
      {/* Gallery grid */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">
            Generated Images ({images.length})
          </p>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-all">
              <X size={14} />
            </button>
          )}
        </div>

        <div className={`grid gap-4 ${images.length === 1 ? 'grid-cols-1 max-w-sm' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {images.map((img, i) => (
            <div key={img.url} className="flex flex-col gap-2">
              {/* Image card */}
              <div
                className="relative aspect-square rounded-xl overflow-hidden bg-surface-sunken border border-border cursor-pointer group"
                onClick={() => setLightbox({ index: i, adobeOpen: false })}
              >
                <img
                  src={img.url}
                  alt={img.label ?? `Generated image ${i + 1}`}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-all flex items-center justify-center">
                  <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                {img.label && (
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-[10px] text-white capitalize">
                    {img.label}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleCanva(img)}
                  disabled={canvaLoading === img.url}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-medium hover:bg-teal-500/20 active:scale-95 transition-all disabled:opacity-50"
                >
                  {canvaLoading === img.url
                    ? <span className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                    : <ExternalLink size={12} />}
                  Edit in Canva
                </button>
                <button
                  onClick={() => handleAdobe(img)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium hover:bg-purple-500/20 active:scale-95 transition-all"
                >
                  <Layers size={12} />
                  Adobe Express
                </button>
              </div>

              <button
                onClick={() => downloadImage(img.url, `generated-${img.label ?? i + 1}.jpg`)}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-tertiary text-[11px] hover:text-text-primary hover:border-border-strong transition-all"
              >
                <Download size={11} />
                Download
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox !== null && current && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative flex flex-col bg-surface-elevated border border-border rounded-2xl overflow-hidden shadow-modal max-w-2xl w-full max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Topbar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
              <span className="text-xs text-text-tertiary capitalize">{current.label ?? `Image ${lightbox.index + 1}`}</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-tertiary">{lightbox.index + 1} / {images.length}</span>
                <button onClick={() => setLightbox(null)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary transition-all">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Image */}
            <div className="relative flex items-center justify-center bg-surface-sunken flex-1 min-h-0">
              <img src={current.url} alt={current.label} className="max-h-[55vh] max-w-full object-contain" />
              {lightbox.index > 0 && (
                <button
                  onClick={() => setLightbox((l) => l ? { ...l, index: l.index - 1 } : null)}
                  className="absolute left-3 p-2 rounded-xl bg-surface-elevated border border-border text-text-tertiary hover:text-text-primary transition-all"
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              {lightbox.index < images.length - 1 && (
                <button
                  onClick={() => setLightbox((l) => l ? { ...l, index: l.index + 1 } : null)}
                  className="absolute right-3 p-2 rounded-xl bg-surface-elevated border border-border text-text-tertiary hover:text-text-primary transition-all"
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-border flex-shrink-0">
              <button
                onClick={() => handleCanva(current)}
                disabled={canvaLoading === current.url}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-medium hover:bg-teal-500/20 transition-all disabled:opacity-50 flex-1 justify-center"
              >
                <ExternalLink size={13} />
                Edit in Canva
              </button>
              <button
                onClick={() => handleAdobe(current)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium hover:bg-purple-500/20 transition-all flex-1 justify-center"
              >
                <Layers size={13} />
                Adobe Express
              </button>
              <button
                onClick={() => downloadImage(current.url, `generated-${current.label ?? lightbox.index + 1}.jpg`)}
                className="p-2 rounded-xl border border-border text-text-tertiary hover:text-text-primary transition-all"
              >
                <Download size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adobe Express Modal */}
      {adobeImage && (
        <AdobeExpressModal
          imageUrl={adobeImage.url}
          assetId={adobeImage.id ?? 'temp'}
          orgId={getOrgId()}
          onSave={handleAdobeSave}
          onClose={() => setAdobeImage(null)}
        />
      )}
    </>
  );
}

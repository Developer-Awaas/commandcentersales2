import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { blobToBase64 } from '../lib/image-utils';
import { Spinner } from './ui/Spinner';
import { X, Layers } from 'lucide-react';

declare global {
  interface Window {
    CCEverywhere?: {
      initialize: (config: {
        clientId: string;
        appName: string;
      }) => Promise<{
        module: {
          createWithAsset: (config: {
            moduleId: string;
            inputParams: { asset: { data: string; dataType: string; type: string } };
            callbacks: {
              onPublish: (data: { asset?: { data?: string } }) => void;
              onClose: () => void;
            };
          }) => void;
        };
      }>;
    };
  }
}

interface AdobeExpressModalProps {
  imageUrl: string;
  assetId: string;
  orgId: string;
  /** Original storage path — when provided, overwrites the file in place (saves storage). */
  storagePath?: string;
  /** Bucket containing storagePath (default: 'creative-assets'). */
  storageBucket?: string;
  onSave: (editedUrl: string) => void;
  onClose: () => void;
}

export function AdobeExpressModal({
  imageUrl,
  assetId,
  orgId,
  storagePath,
  storageBucket,
  onSave,
  onClose,
}: AdobeExpressModalProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'editing' | 'saving' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const ccRef = useRef<Awaited<ReturnType<NonNullable<typeof window.CCEverywhere>['initialize']>> | null>(null);

  useEffect(() => {
    async function init() {
      const clientId = import.meta.env.VITE_ADOBE_EXPRESS_CLIENT_ID as string | undefined;
      if (!clientId) {
        setErrorMsg('VITE_ADOBE_EXPRESS_CLIENT_ID is not set.');
        setStatus('error');
        return;
      }

      // Load Adobe Express SDK script
      if (!window.CCEverywhere) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cc-embed.adobe.com/sdk/v4/CCEverywhere.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Adobe Express SDK'));
          document.head.appendChild(script);
        });
      }

      if (!window.CCEverywhere) {
        setErrorMsg('Adobe Express SDK failed to load.');
        setStatus('error');
        return;
      }

      try {
        ccRef.current = await window.CCEverywhere.initialize({ clientId, appName: 'Command Center V2' });

        // Fetch image and convert to base64
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        const base64 = await blobToBase64(blob);

        setStatus('ready');

        // Open the editor
        ccRef.current.module.createWithAsset({
          moduleId: 'edit-image',
          inputParams: {
            asset: { data: base64, dataType: 'base64', type: 'image' },
          },
          callbacks: {
            onPublish: async (result) => {
              const editedBase64 = result?.asset?.data;
              if (!editedBase64) return;
              setStatus('saving');

              try {
                const binary = atob(editedBase64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const editedBlob = new Blob([bytes], { type: 'image/jpeg' });

                // When storagePath is provided, overwrite the original file (saves storage space).
                // Otherwise fall back to legacy behaviour (create a new /edited/ file).
                const bucket = storageBucket ?? 'creative-assets';
                const savePath = storagePath ?? `${orgId}/creatives/edited/${assetId}-ae.jpg`;
                const isOverwrite = !!storagePath;

                const { error: uploadErr } = await supabase.storage
                  .from(bucket)
                  .upload(savePath, editedBlob, { contentType: 'image/jpeg', upsert: true });
                if (uploadErr) throw new Error(uploadErr.message);

                const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(savePath);
                const publicUrl = urlData.publicUrl;

                if (assetId !== 'temp') {
                  // Overwrite mode: update image_url so edited version replaces the original in DB.
                  // Legacy mode: store separately in edited_image_url.
                  const dbUpdate = isOverwrite
                    ? { image_url: publicUrl, editor_used: 'adobe_express', status: 'edited', updated_at: new Date().toISOString() }
                    : { edited_image_url: publicUrl, editor_used: 'adobe_express', status: 'edited', updated_at: new Date().toISOString() };

                  const { error: updateErr } = await supabase.from('creative_assets').update(dbUpdate).eq('id', assetId);
                  if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);
                }

                onSave(publicUrl);
              } catch (err: unknown) {
                setErrorMsg(err instanceof Error ? err.message : 'Save failed');
                setStatus('error');
              }
            },
            onClose: () => onClose(),
          },
        });
        setStatus('editing');
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize Adobe Express');
        setStatus('error');
      }
    }

    init();
  }, [imageUrl, assetId, orgId, storagePath, storageBucket, onSave, onClose]);

  if (status === 'editing') {
    // Adobe Express renders in its own iframe/overlay; we just show a minimal backdrop
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center p-4">
        <div className="bg-surface-elevated border border-border rounded-xl px-5 py-3 flex items-center gap-3 shadow-modal">
          <Layers size={16} className="text-purple-400" />
          <span className="text-sm text-text-primary">Adobe Express editor is open</span>
          <button onClick={onClose} className="ml-2 text-xs text-text-tertiary hover:text-text-primary transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface-elevated border border-border rounded-2xl shadow-modal w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-purple-400" />
            <span className="text-sm font-semibold text-text-primary">Adobe Express</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-all">
            <X size={14} />
          </button>
        </div>

        {status === 'loading' || status === 'ready' ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Spinner size="lg" />
            <p className="text-sm text-text-tertiary">
              {status === 'loading' ? 'Loading Adobe Express…' : 'Opening editor…'}
            </p>
          </div>
        ) : status === 'saving' ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Spinner size="lg" />
            <p className="text-sm text-text-tertiary">Saving edited image…</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-red-400">{errorMsg || 'Something went wrong.'}</p>
            <button
              onClick={onClose}
              className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

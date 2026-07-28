import { useEffect, useRef, useState } from 'react';
// PARKED WIP — NOTE FOR REVIEW: this component's own conflicts all resolved
// in favor of upstream's extractFunctionErrorMessage-based error handling
// (invokeEdgeFn is unused here, though still defined in supabase.ts for
// reference — see the note there). TextLayer* imports are the independent,
// unrelated text-overlay layer system (stashed) — merged in alongside the
// Canva Return Navigation additions (upstream), not a conflict with them.
import { supabase, extractFunctionErrorMessage } from '../lib/supabase';
import { getOrgId, getUserId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import { useNavigation } from '../contexts/NavigationContext';
import { downloadImage } from '../lib/image-utils';
import { openCanvaOAuthPopup, listenForCanvaEditorReturn } from '../lib/canva-oauth-popup';
import { AdobeExpressModal } from './AdobeExpressModal';
import { TextLayerOverlay } from './TextLayerOverlay';
import { TextLayerEditor } from './TextLayerEditor';
import { renderTextLayers, type TextLayer } from '../lib/text-layers';
import { X, ChevronLeft, ChevronRight, ExternalLink, Layers, Download, Maximize2, Type } from 'lucide-react';

// Mirrors _shared/vision-analysis.ts's EditSummary shape (server-only file,
// not imported client-side) — just the 4 boolean flags this UI displays.
interface EditSummary {
  text_changed: boolean;
  layout_changed: boolean;
  color_changed: boolean;
  imagery_changed: boolean;
}

export interface GalleryImage {
  id?: string;
  url: string;
  label?: string;
  storagePath?: string;
  promptUsed?: string;
  adCopy?: { headline?: string; cta?: string };
  // Set only when reconstructing gallery state from a DB read (e.g. Strategy
  // page's Canva-return resume) — mirrors creative_assets.status === 'approved'
  // so callers can infer whether a resumed set was already saved.
  approved?: boolean;
  textLayers?: TextLayer[];
}

/** Parses "Feed (1080×1080)"-style labels into export dimensions; falls back to a square. */
function parseLayoutDims(label?: string): { w: number; h: number } {
  const match = label?.match(/(\d+)\s*[×x]\s*(\d+)/);
  if (match) return { w: Number(match[1]), h: Number(match[2]) };
  return { w: 1080, h: 1080 };
}

interface ImageGalleryViewerProps {
  images: GalleryImage[];
  onClose?: () => void;
  // Fires whenever an image's pixels change post-generation (Canva sync,
  // Adobe Express save), with the id of the specific image that changed —
  // lets a parent tracking a page-level "saved" flag (e.g. StrategyResult's
  // Save Creative Changes banner) know that one image needs re-approving,
  // without treating the rest of an unrelated gallery as stale too.
  onImagesChanged?: (imageId: string) => void;
  // Fires immediately before a Canva cold-start OAuth connect does a
  // full top-level navigation away (window.location.href) — lets a parent
  // with its own `beforeunload` "unsaved changes" guard (e.g.
  // StrategyResult, right after a fresh generation) suppress it for this
  // one known-recoverable navigation instead of surfacing a native "Leave
  // site?" prompt that silently swallows the redirect if dismissed.
  onBeforeCanvaNavigate?: () => void;
}

interface LightboxState {
  index: number;
  adobeOpen: boolean;
}

export function ImageGalleryViewer({ images, onClose, onImagesChanged, onBeforeCanvaNavigate }: ImageGalleryViewerProps) {
  const { showToast } = useToast();
  const { activePage } = useNavigation();

  // Local copy so the gallery reflects edits without needing a prop change from the parent
  const [localImages, setLocalImages] = useState<GalleryImage[]>(images);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [canvaLoading, setCanvaLoading] = useState<string | null>(null);
  const [adobeImage, setAdobeImage] = useState<GalleryImage | null>(null);
  const [textEditImage, setTextEditImage] = useState<GalleryImage | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // PARKED WIP — NOTE FOR REVIEW: canvaDesignIds (the stashed manual-"Sync
  // from Canva" button's state) is dropped here. Upstream's comment below
  // ("auto-triggered by Return Navigation, no manual sync trigger exists")
  // confirms this was an intentional removal in PR#12, not an omission —
  // the whole manual-sync mechanism this state supported was superseded by
  // Return Navigation's auto-sync. See the later conflict in this file for
  // the JSX button that read this state; dropped for the same reason.
  // Tracks which image id is currently being synced from Canva (null = none)
  // — auto-triggered by Return Navigation, no manual sync trigger exists.
  const [canvaSyncing, setCanvaSyncing] = useState<string | null>(null);
  // edit_summary is computed sync-side only (canva-sync-design); this just
  // displays whatever comes back in its response, never recomputes it.
  const [editSummaries, setEditSummaries] = useState<Record<string, EditSummary>>({});

  // Stable key representing the current generation session: length + first image id/url.
  // Changing this means a genuinely new set of images was passed (new
  // generation), so localImages resets — a parent re-render that passes the
  // same images array reference (or semantically identical images) doesn't
  // need to reset anything else here anymore.
  const sessionKeyRef = useRef('');
  useEffect(() => {
    const key = `${images.length}:${images[0]?.id ?? images[0]?.url ?? ''}`;
    sessionKeyRef.current = key;
    setLocalImages(images);
  }, [images]);

  // Auto-resume: if this image is the one that triggered a Canva
  // cold-start OAuth connect (creativeId round-tripped through
  // oauth_flow_sessions -> CanvaReturn.tsx -> sessionStorage), re-open its
  // editor automatically now that a token exists, instead of leaving the
  // user to click "Edit in Canva" again.
  useEffect(() => {
    const resumeId = sessionStorage.getItem('canva_resume_creative_id');
    if (!resumeId) return;
    const match = localImages.find((img) => img.id === resumeId);
    if (!match) return;
    sessionStorage.removeItem('canva_resume_creative_id');
    handleCanva(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localImages]);

  if (!localImages.length) return null;

  async function handleCanva(img: GalleryImage) {
    // Open the tab SYNCHRONOUSLY, before any await — window.open() called
    // after an async gap (the canva-open-editor round-trip below) can lose
    // "user activation" in stricter browsers and get silently blocked, even
    // though it was triggered by a real click. Shared by both outcomes
    // below: the already-connected editUrl case navigates it straight to
    // the editor; the cold-start authUrl case hands it to
    // openCanvaOAuthPopup, which navigates it to Canva's OAuth screen and
    // waits for a completion signal. Only relevant for a direct click — the
    // auto-resume effect below calls handleCanva() with no click at all, so
    // there's no activation to preserve there either way; unchanged from
    // before.
    const pendingTab = window.open('', '_blank');
    setCanvaLoading(img.url);
    try {
      if (img.id) {
        // PARKED WIP — NOTE FOR REVIEW: the stashed side of this conflict
        // passed userId in the request body — a real IDOR (a spoofed value
        // could act on another org's data via the service-role client on
        // the other end). Upstream's version below fixes this by deriving
        // identity server-side from the JWT. Do not restore the stashed
        // version.
        // supabase.functions.invoke attaches the caller's own session JWT
        // automatically — canva-open-editor derives identity from that, it
        // never trusts a userId passed in the body (service-role client,
        // bypasses RLS, so a spoofed value would act on any org's data).
        // returnUrl encodes which app "page" to land back on (this app has
        // no real URL routing) so a cold-start OAuth connect returns here,
        // not the dashboard. &via=popup is ONLY added when pendingTab
        // actually opened — if it's null (the blank tab itself got
        // blocked), the authUrl branch below falls back to a real
        // same-window redirect, and that tab must still land on the real
        // app, not get stuck showing "you can close this tab" forever.
        const returnUrl = `${window.location.origin}/?page=${encodeURIComponent(activePage)}${pendingTab ? '&via=popup' : ''}`;
        const { data: json, error: invokeErr } = await supabase.functions.invoke<{ editUrl?: string; designId?: string; needsAuth?: boolean; authUrl?: string; error?: string }>(
          'canva-open-editor',
          { body: { creativeAssetId: img.id, returnUrl } }
        );
        if (invokeErr) throw new Error(await extractFunctionErrorMessage(invokeErr, 'Canva editor request failed'));
        if (!json) throw new Error('canva-open-editor returned no data');
        if (json.editUrl) {
          // correlation_state rides along on Canva's own "Return Navigation"
          // feature (Canva Developer Portal setting, separate from the
          // OAuth flow) — capped at 50 chars, `${page}:${uuid}` fits
          // comfortably. Lets CanvaEditorReturn.tsx's signal below fire
          // specifically for this image once the user clicks "Return"
          // inside Canva's editor.
          const editUrlWithCorrelation = img.id
            ? `${json.editUrl}${json.editUrl.includes('?') ? '&' : '?'}correlation_state=${encodeURIComponent(`${activePage}:${img.id}`)}`
            : json.editUrl;
          if (pendingTab) {
            pendingTab.location.href = editUrlWithCorrelation;
            // Auto-sync once the user clicks "Return" in Canva's editor —
            // a much stronger "I'm done editing" signal than just leaving
            // the tab open, and closes the loop the user actually asked
            // for: come back to where this was called from automatically.
            listenForCanvaEditorReturn(pendingTab, (ok) => { if (ok) handleCanvaSync(img); });
          } else {
            window.open(editUrlWithCorrelation, '_blank'); // blank open was blocked too — last resort, likely blocked again
          }
          return;
        }
        if (json.authUrl) {
          // Popup, not a same-window redirect — Canva's own OAuth screen
          // sends X-Frame-Options: SAMEORIGIN (can't be iframed at all) and
          // Cross-Origin-Opener-Policy: same-origin (severs window.opener
          // the moment the popup navigates there, which is why two earlier
          // popup attempts using window.opener/postMessage/BroadcastChannel
          // both failed). openCanvaOAuthPopup signals completion via
          // localStorage's storage event instead, which has no dependency
          // on window.opener at all. Still suppress the parent's
          // beforeunload guard — the internal fallback to a same-window
          // redirect (if the popup was blocked) is still a real navigation.
          onBeforeCanvaNavigate?.();
          openCanvaOAuthPopup(pendingTab, json.authUrl, () => handleCanva(img));
          return;
        }
        if (json.error) throw new Error(json.error);
      }
      // Fallback when no DB record yet
      if (pendingTab) pendingTab.location.href = 'https://www.canva.com/create/instagram-posts/';
      else window.open('https://www.canva.com/create/instagram-posts/', '_blank');
    } catch (err: unknown) {
      pendingTab?.close();
      showToast(err instanceof Error ? err.message : 'Canva error', 'error');
    } finally {
      setCanvaLoading(null);
    }
  }

  async function handleCanvaSync(img: GalleryImage) {
    if (!img.id) return;
    setCanvaSyncing(img.id);
    try {
      // PARKED WIP — NOTE FOR REVIEW: on-disk state before this resolution
      // was a broken hybrid (stash's invokeEdgeFn call feeding into a
      // reference to an undefined `res`). Replaced with upstream's actual
      // current implementation verified via `git show origin/main` rather
      // than guessed — still a raw fetch + anon key + userId-in-body, same
      // pattern canva-open-editor's IDOR fix moved away from. Not fixed
      // here since this is upstream's already-shipped code, not stash
      // content — flagging for separate review, not silently rewriting
      // already-merged main code while parking WIP.
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/canva-sync-design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ creativeAssetId: img.id, userId: getUserId() }),
      });
      const json = await res.json() as { imageUrl?: string; editSummary?: EditSummary | null; error?: string };
      if (json.imageUrl) {
        // Match by id (stable) not url (may have changed after a prior Adobe Express edit)
        setLocalImages((prev) => prev.map((i) =>
          (img.id ? i.id === img.id : i.url === img.url) ? { ...i, url: json.imageUrl! } : i
        ));
        if (json.editSummary) {
          setEditSummaries((prev) => ({ ...prev, [img.id!]: json.editSummary! }));
        }
        showToast('Synced from Canva!', 'success');
        // Await DB update so errors are not silently swallowed
        const { error: dbErr } = await supabase.from('creative_assets').update({
          image_url: json.imageUrl,
          editor_used: 'canva',
          status: 'edited',
          updated_at: new Date().toISOString(),
        }).eq('id', img.id!);
        if (dbErr) console.warn('[canva-sync] DB update failed:', dbErr.message);
        // The pixels a parent's "saved"/"approved" flag was tracking no
        // longer match what's on screen for THIS image — let it know which
        // one, so a re-save doesn't blanket-touch unrelated images too.
        onImagesChanged?.(img.id!);
      } else {
        throw new Error(json.error ?? 'Sync failed');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Canva sync failed', 'error');
    } finally {
      setCanvaSyncing(null);
    }
  }

  function handleAdobe(img: GalleryImage) {
    setAdobeImage(img);
    if (lightbox) setLightbox(null);
  }

  function handleAdobeSave(editedUrl: string) {
    showToast('Saved via Adobe Express!', 'success');
    if (adobeImage) {
      // Update the gallery in place — no download needed
      setLocalImages((prev) =>
        prev.map((img) => img.url === adobeImage.url ? { ...img, url: editedUrl } : img)
      );
      if (adobeImage.id) onImagesChanged?.(adobeImage.id);
    }
    setAdobeImage(null);
  }

  function handleTextSave(layers: TextLayer[]) {
    if (textEditImage) {
      setLocalImages((prev) =>
        prev.map((img) => (textEditImage.id ? img.id === textEditImage.id : img.url === textEditImage.url)
          ? { ...img, textLayers: layers }
          : img
        )
      );
      showToast('Text layers saved!', 'success');
    }
    setTextEditImage(null);
  }

  async function handleDownload(img: GalleryImage, index: number) {
    if (!img.textLayers?.length) {
      downloadImage(img.url, `generated-${img.label ?? index + 1}.jpg`);
      return;
    }
    setDownloadingId(img.id ?? img.url);
    try {
      const { w, h } = parseLayoutDims(img.label);
      const composited = await renderTextLayers(img.url, img.textLayers, w, h);
      downloadImage(composited, `generated-${img.label ?? index + 1}.jpg`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not bake text into image — downloading original.', 'error');
      downloadImage(img.url, `generated-${img.label ?? index + 1}.jpg`);
    } finally {
      setDownloadingId(null);
    }
  }

  const current = lightbox !== null ? localImages[lightbox.index] : null;

  return (
    <>
      {/* Gallery grid */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">
            Generated Images ({localImages.length})
          </p>
          <div className="flex items-center gap-2">
            {onClose && (
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-all">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className={`grid gap-4 ${localImages.length === 1 ? 'grid-cols-1 max-w-sm' : localImages.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {localImages.map((img, i) => {
          // While ANY Canva action is in flight for this image, every other
          // action on it is disabled. Without this, clicking Sync then
          // immediately clicking Edit in Canva before the sync response
          // lands opens the editor against the pre-sync (stale) image —
          // canva-open-editor fetches whatever creative_assets.image_url
          // currently is at request time, which the in-flight sync hasn't
          // updated yet.
          const isBusy = canvaLoading === img.url || (!!img.id && canvaSyncing === img.id);
          return (
            <div key={img.id ?? img.url} className="flex flex-col gap-2">
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
                <TextLayerOverlay layers={img.textLayers ?? []} />
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
                  disabled={isBusy}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-medium hover:bg-teal-500/20 active:scale-95 transition-all disabled:opacity-50"
                >
                  {canvaLoading === img.url
                    ? <span className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                    : <ExternalLink size={12} />}
                  Edit in Canva
                </button>
                <button
                  onClick={() => handleAdobe(img)}
                  disabled={isBusy}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium hover:bg-purple-500/20 active:scale-95 transition-all disabled:opacity-50"
                >
                  <Layers size={12} />
                  Adobe Express
                </button>
                <button
                  onClick={() => setTextEditImage(img)}
                  disabled={!img.id}
                  title={img.id ? undefined : 'Save the creative before editing text'}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-medium hover:bg-amber-500/20 active:scale-95 transition-all disabled:opacity-50 col-span-2"
                >
                  <Type size={12} />
                  Edit Text
                </button>
              </div>

              {/* No manual "Sync from Canva" trigger — clicking Return inside
                  Canva's editor (Return Navigation, see canva-oauth-popup.ts)
                  auto-syncs this image, avoiding the stale-image races a
                  manual button invited. This is just a status indicator
                  while that auto-sync is in flight. */}
              {img.id && canvaSyncing === img.id && (
                <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[11px] font-medium">
                  <span className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                  Syncing from Canva…
                </div>
              )}

              {/* Edit summary — computed sync-side by canva-sync-design, shown as-is */}
              {img.id && editSummaries[img.id] && (
                <div className="flex flex-wrap gap-1">
                  {(['text_changed', 'layout_changed', 'color_changed', 'imagery_changed'] as const)
                    .filter((k) => editSummaries[img.id!][k])
                    .map((k) => (
                      <span key={k} className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border text-[10px] text-text-tertiary">
                        {k.replace('_changed', '')}
                      </span>
                    ))}
                  {Object.values(editSummaries[img.id!]).every((v) => !v) && (
                    <span className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border text-[10px] text-text-tertiary">
                      no detected changes
                    </span>
                  )}
                </div>
              )}

              <button
                onClick={() => handleDownload(img, i)}
                disabled={downloadingId === (img.id ?? img.url)}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-tertiary text-[11px] hover:text-text-primary hover:border-border-strong transition-all disabled:opacity-50"
              >
                {downloadingId === (img.id ?? img.url)
                  ? <span className="w-2.5 h-2.5 border-2 border-text-tertiary border-t-transparent rounded-full animate-spin" />
                  : <Download size={11} />}
                Download
              </button>
            </div>
          );})}
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
                <span className="text-[11px] text-text-tertiary">{lightbox.index + 1} / {localImages.length}</span>
                <button onClick={() => setLightbox(null)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary transition-all">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Image */}
            <div className="relative flex items-center justify-center bg-surface-sunken flex-1 min-h-0">
              <div className="relative inline-block">
                <img src={current.url} alt={current.label} className="max-h-[55vh] max-w-full object-contain block" />
                <TextLayerOverlay layers={current.textLayers ?? []} />
              </div>
              {lightbox.index > 0 && (
                <button
                  onClick={() => setLightbox((l) => l ? { ...l, index: l.index - 1 } : null)}
                  className="absolute left-3 p-2 rounded-xl bg-surface-elevated border border-border text-text-tertiary hover:text-text-primary transition-all"
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              {lightbox.index < localImages.length - 1 && (
                <button
                  onClick={() => setLightbox((l) => l ? { ...l, index: l.index + 1 } : null)}
                  className="absolute right-3 p-2 rounded-xl bg-surface-elevated border border-border text-text-tertiary hover:text-text-primary transition-all"
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-border flex-shrink-0 flex-wrap">
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
              {/* No manual "Sync from Canva" trigger — see the grid view's
                  equivalent comment above. Status indicator only. The
                  stashed manual-sync button (canvaDesignIds-gated) was
                  dropped here for the same reason as the grid view. */}
              {current.id && canvaSyncing === current.id && (
                <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-medium flex-1 justify-center">
                  <span className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                  Syncing from Canva…
                </div>
              )}
              {current.id && editSummaries[current.id] && (
                <div className="flex flex-wrap gap-1 w-full">
                  {(['text_changed', 'layout_changed', 'color_changed', 'imagery_changed'] as const)
                    .filter((k) => editSummaries[current.id!][k])
                    .map((k) => (
                      <span key={k} className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border text-[10px] text-text-tertiary">
                        {k.replace('_changed', '')}
                      </span>
                    ))}
                </div>
              )}
              <button
                onClick={() => setTextEditImage(current)}
                disabled={!current.id}
                title={current.id ? undefined : 'Save the creative before editing text'}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-medium hover:bg-amber-500/20 transition-all disabled:opacity-50 flex-1 justify-center"
              >
                <Type size={13} />
                Edit Text
              </button>
              <button
                onClick={() => handleDownload(current, lightbox.index)}
                disabled={downloadingId === (current.id ?? current.url)}
                className="p-2 rounded-xl border border-border text-text-tertiary hover:text-text-primary transition-all disabled:opacity-50"
              >
                {downloadingId === (current.id ?? current.url)
                  ? <span className="w-3.5 h-3.5 border-2 border-text-tertiary border-t-transparent rounded-full animate-spin block" />
                  : <Download size={14} />}
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
          storagePath={adobeImage.storagePath}
          storageBucket="brand-assets"
          onSave={handleAdobeSave}
          onClose={() => setAdobeImage(null)}
        />
      )}

      {/* Text Layer Editor */}
      {textEditImage && textEditImage.id && (
        <TextLayerEditor
          assetId={textEditImage.id}
          imageUrl={textEditImage.url}
          layers={textEditImage.textLayers ?? []}
          onSave={handleTextSave}
          onClose={() => setTextEditImage(null)}
        />
      )}
    </>
  );
}

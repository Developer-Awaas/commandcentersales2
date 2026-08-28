/**
 * The approval step before anything leaves this app.
 *
 * Three things here are load-bearing, not decoration:
 *
 *  1. THE TARGET IS NAMED, and the Post button stays disabled until it is.
 *     "Post to Meta" with no destination shown is how someone posts a
 *     client's creative to the wrong Page and finds out from the client.
 *  2. DRY RUN DEFAULTS ON. Every open of this dialog starts in the mode that
 *     cannot post. Going live is a deliberate, separate click.
 *  3. THE CAPTION IS EDITABLE. It is prefilled from the ad copy, but the ad
 *     copy was written for an ad unit, not for a Page post, and shipping it
 *     unread is not approval.
 *
 * The dialog decides nothing about permission. meta-publish re-checks the
 * allowlist on every call — this is a confirmation surface, not a gate.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, ShieldCheck, ExternalLink, AlertTriangle } from 'lucide-react';
import { Spinner } from './ui/Spinner';
import {
  publishOptions,
  publishToMeta,
  type PublishPlatform,
  type PublishResponse,
  type PublishTargets,
} from '../lib/publish-targets';

interface MetaPostDialogProps {
  targets: PublishTargets;
  imageUrl: string;
  /** creative_assets.id — links the published_assets row back to what was posted. */
  creativeAssetId?: string | null;
  toolOutputId?: string | null;
  projectId?: string | null;
  /** Prefill, already composed by the caller from whatever ad copy it holds. */
  defaultCaption: string;
  onClose: () => void;
}

export function MetaPostDialog({
  targets, imageUrl, creativeAssetId, toolOutputId, projectId, defaultCaption, onClose,
}: MetaPostDialogProps) {
  const options = publishOptions(targets);
  const [platform, setPlatform] = useState<PublishPlatform>(options[0]?.platform ?? 'facebook');
  const [caption, setCaption] = useState(defaultCaption);
  // Default ON, every time. Not remembered between opens: a sticky "live" flag
  // would mean the second post of a session skips the safe rehearsal silently.
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResponse | null>(null);

  const selected = options.find((o) => o.platform === platform);
  const targetName = selected?.name ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function handlePost() {
    setBusy(true);
    setResult(null);
    const res = await publishToMeta({
      target: platform,
      message: caption,
      imageUrl,
      creativeAssetId,
      toolOutputId,
      projectId,
      dryRun,
    });
    setResult(res);
    setBusy(false);
  }

  // Named target required. Without one there is nothing to confirm, so the
  // action is not offered — the same rule as the button that opened this.
  const canPost = !!targetName && caption.trim().length > 0 && !busy;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={() => !busy && onClose()}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-surface-elevated border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Post to Meta</h3>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="flex gap-4">
            <img src={imageUrl} alt="Creative to post" className="w-28 h-28 rounded-xl object-cover border border-border shrink-0" />
            <div className="flex flex-col gap-2 min-w-0">
              {/* The single most important line in this dialog. */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-widest text-text-tertiary">Posts to</span>
                {targetName ? (
                  <span className="text-sm font-semibold text-text-primary truncate">{targetName}</span>
                ) : (
                  <span className="text-sm font-semibold text-red-400">No target configured</span>
                )}
              </div>

              {options.length > 1 && (
                <div className="flex gap-1.5">
                  {options.map((o) => (
                    <button
                      key={o.platform}
                      onClick={() => setPlatform(o.platform)}
                      disabled={busy}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all disabled:opacity-40 ${
                        platform === o.platform
                          ? 'bg-brand-subtle border-brand-border text-brand'
                          : 'border-border text-text-tertiary hover:text-text-primary'
                      }`}
                    >
                      {o.platform === 'facebook' ? 'Facebook' : 'Instagram'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-widest text-text-tertiary">Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              disabled={busy}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors disabled:opacity-60"
              placeholder="Write the caption for this post…"
            />
            <span className={`text-[10px] self-end ${caption.trim().length > 2200 ? 'text-red-400' : 'text-text-tertiary'}`}>
              {caption.trim().length} / 2200
            </span>
          </div>

          <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-surface-sunken border border-border cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={busy}
              className="mt-0.5 accent-emerald-500"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-text-primary">Dry run — validate only, post nothing</span>
              <span className="text-[11px] text-text-tertiary">
                {dryRun
                  ? 'The payload is assembled, validated and recorded. Nothing reaches Facebook or Instagram.'
                  : 'This will publish to the Page named above, for real, immediately.'}
              </span>
            </span>
          </label>

          {result && (
            <div className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border text-xs ${
              result.ok
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}>
              {result.ok && result.dry_run && (
                <>
                  <span className="flex items-center gap-1.5 font-medium"><ShieldCheck size={13} /> Validated — nothing posted</span>
                  {result.would_post && (
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/30 p-2 text-[10px] leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
                      POST {result.would_post.endpoint}{'\n'}
                      {JSON.stringify(result.would_post.fields, null, 2)}
                    </pre>
                  )}
                </>
              )}
              {result.ok && !result.dry_run && (
                <>
                  <span className="font-medium">Published to {result.target_name}</span>
                  {result.permalink && (
                    <a href={result.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline underline-offset-2">
                      <ExternalLink size={12} /> View the post
                    </a>
                  )}
                  {result.meta_post_id && <span className="text-[10px] opacity-80">Post id {result.meta_post_id}</span>}
                </>
              )}
              {!result.ok && <span>{result.error ?? 'Publish failed.'}</span>}
            </div>
          )}

          {result?.token_warning && (
            <span className="flex items-start gap-1.5 text-[11px] text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {result.token_warning}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} disabled={busy} className="px-3.5 py-2 rounded-lg border border-border text-text-tertiary text-sm hover:text-text-primary disabled:opacity-40">
            Close
          </button>
          <button
            onClick={handlePost}
            disabled={!canPost}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              dryRun
                ? 'bg-surface border border-border-strong text-text-primary hover:bg-surface-hover'
                : 'bg-[#1877F2] text-white hover:opacity-90'
            }`}
          >
            {busy ? <Spinner size="sm" /> : dryRun ? <ShieldCheck size={14} /> : <Send size={14} />}
            {busy ? 'Working…' : dryRun ? 'Run dry-run check' : `Post to ${targetName ?? '…'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

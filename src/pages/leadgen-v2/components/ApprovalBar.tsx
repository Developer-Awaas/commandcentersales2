import { useState, useRef } from 'react';
import { CheckCircle2, RefreshCw, MessageSquarePlus, Loader2, Rocket } from 'lucide-react';
import type { AgentStatus, ApproveResponse } from '../contracts';

interface ApprovalBarProps {
  status: AgentStatus;
  loading: boolean;
  approveLoading: boolean;
  approveResult: ApproveResponse | null;
  approveError: string | null;
  onRegenerateAll?: () => void;
  // INVARIANT: called once per approve gesture; double-click guarded here
  // (disabled once approveLoading is true) AND in the hook (approveRef).
  // Both guards are required — the button prevents UI confusion; the ref
  // prevents a second HTTP request if the state update is delayed.
  onApprove: () => void;
  // Receives the user's free-text adjustment; routes through aarav-orchestrate
  // as a new turn in the same session — NOT a direct specialist call.
  onRequestChange: (message: string) => void;
}

export function ApprovalBar({
  status, loading,
  approveLoading, approveResult, approveError,
  onRegenerateAll, onApprove, onRequestChange,
}: ApprovalBarProps) {
  const isReady    = status === 'ready';
  const isApproved = approveResult != null;
  const disabled   = !isReady || loading;

  const [showChangeInput, setShowChangeInput] = useState(false);
  const [changeText, setChangeText]           = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function openChangeInput() {
    setShowChangeInput(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function submitChange() {
    const text = changeText.trim();
    if (!text) return;
    setChangeText('');
    setShowChangeInput(false);
    onRequestChange(text);
  }

  // ── Approved / ready-to-launch state ─────────────────────────────────────
  // No real Meta/ad-launch integration exists — status is 'ready_to_launch'.
  // Surface this truthfully; do NOT change this copy to imply an ad published.
  if (isApproved) {
    return (
      <div className="flex-shrink-0 border-t border-border bg-surface-elevated px-6 pr-24 py-3 flex items-center gap-2.5">
        <Rocket size={14} className="text-success-text flex-shrink-0" />
        <span className="text-[12px] font-medium text-success-text">
          Campaign saved — ready to launch.
        </span>
        <span className="text-[12px] text-text-tertiary">
          Ad publishing is not yet connected — take the strategy to your ad platform to launch.
        </span>
      </div>
    );
  }

  // ── Request-change inline input ───────────────────────────────────────────
  if (showChangeInput) {
    return (
      <div className="flex-shrink-0 border-t border-border bg-surface-elevated px-6 pr-24 py-3 flex items-center gap-3">
        <input
          ref={inputRef}
          type="text"
          value={changeText}
          onChange={e => setChangeText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submitChange();
            if (e.key === 'Escape') setShowChangeInput(false);
          }}
          placeholder={'Describe the change — e.g. "increase budget, focus on families"'}
          className="flex-1 text-[13px] bg-surface-sunken border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-disabled outline-none focus:border-brand transition-colors"
        />
        <button
          onClick={submitChange}
          disabled={!changeText.trim() || loading}
          className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
        <button
          onClick={() => setShowChangeInput(false)}
          className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Normal bar ────────────────────────────────────────────────────────────
  return (
    // pr-24 keeps the Approve button clear of the AIChatbot floating bubble
    // (fixed bottom-6 right-6 z-[100] in AIChatbot.tsx).
    <div className="flex-shrink-0 border-t border-border bg-surface-elevated px-6 pr-24 py-3 flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-[12px] text-text-secondary">
          {isReady
            ? 'Review the strategy and creatives above, then approve to proceed.'
            : 'Waiting for Aarav to finish generating…'}
        </p>
        {approveError && (
          <p className="text-[11px] text-danger-text">{approveError}</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={openChangeInput}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-border text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <MessageSquarePlus size={13} />
          Request Change
        </button>

        <button
          onClick={onRegenerateAll}
          disabled={disabled || !onRegenerateAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-border text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} />
          Regenerate
        </button>

        <button
          onClick={onApprove}
          // Disable immediately on click (approveLoading goes true before the
          // server responds) — this is the primary double-click guard in the UI.
          disabled={disabled || approveLoading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {approveLoading
            ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
            : <><CheckCircle2 size={13} /> Approve & Save</>}
        </button>
      </div>
    </div>
  );
}

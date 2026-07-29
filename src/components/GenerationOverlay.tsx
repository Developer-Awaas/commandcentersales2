import { useEffect, useState } from 'react';

interface GenerationOverlayProps {
  label: string;
  startedAt: number;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function GenerationOverlay({ label, startedAt }: GenerationOverlayProps) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 w-[320px] rounded-xl border border-border bg-surface-elevated shadow-2xl px-4 py-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className="text-xs text-text-tertiary tabular-nums">{formatElapsed(elapsedMs)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-sunken overflow-hidden">
        <div className="h-full w-1/3 rounded-full bg-brand animate-generation-bar" />
      </div>
    </div>
  );
}

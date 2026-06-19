import { Loader2, CheckCircle2, Zap, Clock } from 'lucide-react';
import type { AgentStatus } from '../contracts';

interface AgentStatusChipProps {
  status: AgentStatus;
}

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  idle: {
    label: 'Idle',
    icon: Clock,
    className: 'bg-surface-sunken text-text-tertiary border-border',
  },
  thinking: {
    label: 'Thinking…',
    icon: Loader2,
    className: 'bg-warning-subtle text-warning-text border-warning-border',
  },
  generating: {
    label: 'Generating',
    icon: Zap,
    className: 'bg-brand-subtle text-brand-text border-brand-border',
  },
  ready: {
    label: 'Ready for review',
    icon: CheckCircle2,
    className: 'bg-success-subtle text-success-text border-success-border',
  },
};

export function AgentStatusChip({ status }: AgentStatusChipProps) {
  const { label, icon: Icon, className } = STATUS_CONFIG[status];
  const isSpinning = status === 'thinking' || status === 'generating';

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium',
        className,
      ].join(' ')}
    >
      <Icon size={11} className={isSpinning ? 'animate-spin' : ''} />
      {label}
    </span>
  );
}

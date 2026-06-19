import { Bot, User, Loader2, CheckCircle2, Clock } from 'lucide-react';
import type { AaravMessage, AgentStatus, DelegationStatus } from '../contracts';
import { AgentStatusChip } from './AgentStatusChip';

interface AaravThreadProps {
  messages: AaravMessage[];
  status: AgentStatus;
  // Live delegation states from Realtime — null when no turn is in-flight.
  liveDelegations: DelegationStatus[] | null;
  loading: boolean;
}

// Icons and styles per delegation state — reuses the same visual language as
// AgentStatusChip so the two UI elements feel consistent.
const DELEGATION_STATE_CONFIG: Record<
  DelegationStatus['status'],
  { icon: React.ElementType; className: string; spin: boolean }
> = {
  pending:  { icon: Clock,        className: 'text-text-disabled',    spin: false },
  working:  { icon: Loader2,      className: 'text-warning-text',     spin: true  },
  done:     { icon: CheckCircle2, className: 'text-success-text',     spin: false },
  failed:   { icon: Clock,        className: 'text-danger-text',      spin: false },
};

function DelegationPanel({ delegations }: { delegations: DelegationStatus[] }) {
  return (
    <div className="mx-4 my-2 px-3 py-2.5 bg-surface-sunken border border-border rounded-xl space-y-1.5">
      {delegations.map(d => {
        const cfg = DELEGATION_STATE_CONFIG[d.status];
        const Icon = cfg.icon;
        return (
          <div key={d.agent} className="flex items-center gap-2">
            <Icon
              size={11}
              className={[cfg.className, cfg.spin ? 'animate-spin' : ''].join(' ')}
            />
            <span className={['text-[11px]', cfg.className].join(' ')}>
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AaravThread({ messages, status, liveDelegations, loading }: AaravThreadProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center flex-shrink-0">
            <Bot size={14} className="text-white" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-text-primary leading-tight">Aarav</p>
            <p className="text-[10px] text-text-tertiary leading-tight">Campaign Strategist</p>
          </div>
        </div>
        <AgentStatusChip status={status} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Live delegation panel — visible during any in-flight turn.
            Appears below the last message so it feels like Aarav is
            "showing his work" in real time. Disappears when loading ends. */}
        {loading && liveDelegations && (
          <DelegationPanel delegations={liveDelegations} />
        )}

        {/* Generic thinking indicator when loading but no delegation data yet
            (e.g. between request send and first Realtime update). */}
        {loading && !liveDelegations && (
          <div className="flex items-center gap-2 px-1 py-1">
            <Loader2 size={11} className="animate-spin text-text-tertiary flex-shrink-0" />
            <span className="text-[11px] text-text-tertiary">Aarav is thinking…</span>
          </div>
        )}
      </div>

      {/* Input — disabled; message input is handled via ApprovalBar's
          "Request Change" inline input for clarity of intent. */}
      <div className="px-4 py-3 border-t border-border flex-shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-sunken border border-border rounded-lg opacity-50">
          <input
            type="text"
            placeholder={'Use “Request Change” below to adjust…'}
            disabled
            className="flex-1 text-sm bg-transparent text-text-secondary placeholder:text-text-disabled outline-none cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: AaravMessage }) {
  const isAarav = message.role === 'aarav';

  return (
    <div className={['flex gap-2.5', isAarav ? 'items-start' : 'items-start flex-row-reverse'].join(' ')}>
      {/* Avatar */}
      <div
        className={[
          'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
          isAarav ? 'bg-brand' : 'bg-surface-sunken border border-border',
        ].join(' ')}
      >
        {isAarav ? (
          <Bot size={12} className="text-white" />
        ) : (
          <User size={12} className="text-text-secondary" />
        )}
      </div>

      {/* Bubble */}
      <div className={['max-w-[260px]', isAarav ? '' : ''].join(' ')}>
        <div
          className={[
            'px-3 py-2 rounded-xl text-[13px] leading-relaxed',
            isAarav
              ? 'bg-surface-elevated border border-border text-text-primary rounded-tl-sm'
              : 'bg-brand text-white rounded-tr-sm',
          ].join(' ')}
        >
          {message.content}
        </div>
        <p
          className={[
            'text-[10px] text-text-disabled mt-1',
            isAarav ? '' : 'text-right',
          ].join(' ')}
        >
          {message.timestamp}
        </p>
      </div>
    </div>
  );
}

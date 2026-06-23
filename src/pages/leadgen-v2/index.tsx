import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { AaravThread } from './components/AaravThread';
import { ApprovalBar } from './components/ApprovalBar';
import { StrategyCard } from './components/StrategyCard';
import { CreativeGrid } from './components/CreativeGrid';
import { useAgentSession } from '../../hooks/useAgentSession';
import { useProfileMode } from '../../hooks/useProfileMode';
import type { AaravMessage, CreativeVariant, StrategyConfig } from './contracts';

const GREETING: AaravMessage = {
  id: 'greeting',
  role: 'aarav',
  content:
    "Hi! I'm Aarav, your campaign strategist. Tell me about your project and what you'd like to achieve.",
  timestamp: '',
};

// INVARIANT: this page (and everything under leadgen-v2/) talks ONLY to
// aarav-orchestrate via useAgentSession. Never import or invoke a
// specialist Edge Function (arjun/aanya/diya) from this module.
export default function LeadGenV2() {
  const { tier: profileTier } = useProfileMode();
  const {
    response, loading, error,
    liveDelegations,
    sendMessage, regenerateCreatives,
    requestChange, approveTurn,
    approveResult, approveLoading, approveError,
  } = useAgentSession();

  const [messages, setMessages] = useState<AaravMessage[]>([GREETING]);
  const lastMessageIdRef = useRef<string | null>(null);

  // Track which creative ids the user has selected for approval.
  // Default: all creatives are selected. Resets when new creatives arrive.
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!response || response.message.id === lastMessageIdRef.current) return;
    lastMessageIdRef.current = response.message.id;
    setMessages(prev => [...prev, response.message]);
  }, [response]);

  // When new creatives arrive, select all by default.
  useEffect(() => {
    const ids = response?.canvas?.creatives?.map(c => c.id) ?? [];
    setSelectedCreativeIds(new Set(ids));
  }, [response?.canvas?.creatives]);

  const status = response?.status ?? (loading ? 'thinking' : 'idle');
  const canvas = response?.canvas;

  function handleResubmitStrategy(edited: StrategyConfig) {
    void sendMessage('Resubmitting strategy with my edits.', { editedStrategy: edited });
  }

  function handleRegenerateAll() {
    if (!canvas?.strategy) return;
    void regenerateCreatives(canvas.strategy);
  }

  function handleRegenerateOne(variant: CreativeVariant) {
    if (!canvas?.strategy || !canvas.creatives) return;
    const keep = canvas.creatives.filter(c => c.id !== variant.id);
    void regenerateCreatives(canvas.strategy, { angle: variant.angle, keep });
  }

  function handleSelectToggle(id: string) {
    setSelectedCreativeIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleApprove() {
    void approveTurn(
      selectedCreativeIds.size > 0 ? Array.from(selectedCreativeIds) : undefined
    );
  }

  function handleRequestChange(adjustmentMessage: string) {
    // Add the user's message to the thread immediately before the round-trip
    // so the conversation feels responsive.
    const userMsg: AaravMessage = {
      id:        crypto.randomUUID(),
      role:      'user',
      content:   adjustmentMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    void requestChange(adjustmentMessage);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left — conversation thread */}
      <div className="w-[360px] flex-shrink-0 flex flex-col border-r border-border bg-surface-elevated">
        <AaravThread
          messages={messages}
          status={status}
          liveDelegations={liveDelegations}
          loading={loading}
          profileTier={profileTier}
        />
      </div>

      {/* Right — workspace canvas */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="max-w-3xl space-y-5">
            {error && (
              <div className="flex items-center gap-2.5 rounded-xl border border-danger-border bg-danger-subtle px-4 py-3 text-[13px] text-danger-text">
                <AlertTriangle size={16} className="flex-shrink-0" />
                Couldn't reach Aarav: {error}
              </div>
            )}

            {loading && !response && (
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-elevated px-4 py-3 text-[13px] text-text-secondary">
                <Loader2 size={16} className="animate-spin flex-shrink-0" />
                Aarav is getting set up…
              </div>
            )}

            {canvas?.strategy && (
              <StrategyCard strategy={canvas.strategy} loading={loading} onResubmit={handleResubmitStrategy} profileTier={profileTier} />
            )}
            {canvas?.creatives && (
              <CreativeGrid
                creatives={canvas.creatives}
                loading={loading}
                selectedIds={selectedCreativeIds}
                onRegenerate={handleRegenerateOne}
                onSelectToggle={handleSelectToggle}
              />
            )}
          </div>
        </div>
        <ApprovalBar
          status={status}
          loading={loading}
          approveLoading={approveLoading}
          approveResult={approveResult}
          approveError={approveError}
          onRegenerateAll={handleRegenerateAll}
          onApprove={handleApprove}
          onRequestChange={handleRequestChange}
        />
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import type { StrategyConfig } from '../contracts';
import type { ProfileTier } from '../../../hooks/useProfileMode';

interface StrategyCardProps {
  strategy: StrategyConfig;
  loading: boolean;
  onResubmit: (edited: StrategyConfig) => void;
  profileTier: ProfileTier;
}

const FUNNEL_LABELS: Record<StrategyConfig['primary_funnel_stage'], string> = {
  awareness: 'TOFU',
  consideration: 'MOFU',
  conversion: 'BOFU',
};

const FUNNEL_COLORS: Record<StrategyConfig['primary_funnel_stage'], string> = {
  awareness: 'bg-blue-50 text-blue-700 border-blue-200',
  consideration: 'bg-amber-50 text-amber-700 border-amber-200',
  conversion: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function inputClass() {
  return 'w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand-border';
}

function labelClass() {
  return 'block text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1';
}

// This card is the ONLY editable surface for Arjun's strategy. Edits are
// local state until "Resubmit to Aarav" — that goes back through
// aarav-orchestrate (a new orchestration turn) for re-delegation, never
// straight to a specialist. See contracts.ts AgentRequest.edited_strategy.
export function StrategyCard({ strategy, loading, onResubmit, profileTier }: StrategyCardProps) {
  const [draft, setDraft] = useState<StrategyConfig>(strategy);

  // Reset local edits whenever Aarav returns a fresh strategy (a new
  // object reference each response) — but not on every keystroke, since
  // the prop only changes when a new server response arrives.
  useEffect(() => {
    setDraft(strategy);
  }, [strategy]);

  const budgetTotal =
    draft.budget_allocation.awareness + draft.budget_allocation.consideration + draft.budget_allocation.conversion;

  function updateBudget(stage: keyof StrategyConfig['budget_allocation'], value: number) {
    setDraft((d) => ({ ...d, budget_allocation: { ...d.budget_allocation, [stage]: value } }));
  }

  function updateTargeting<K extends keyof StrategyConfig['targeting']>(key: K, value: StrategyConfig['targeting'][K]) {
    setDraft((d) => ({ ...d, targeting: { ...d.targeting, [key]: value } }));
  }

  function updateCpl(key: keyof StrategyConfig['expected_cpl_range'], value: number) {
    setDraft((d) => ({ ...d, expected_cpl_range: { ...d.expected_cpl_range, [key]: value } }));
  }

  return (
    <div className="bg-surface-elevated border border-border rounded-xl shadow-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap size={15} className="text-brand flex-shrink-0" />
          <span className="text-[13px] font-semibold text-text-primary">
            {profileTier === 'profile_2' ? "Arjun's Strategy" : 'Campaign Strategy'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={['text-[11px] font-medium px-2 py-0.5 rounded-full border', FUNNEL_COLORS[draft.primary_funnel_stage]].join(' ')}
          >
            {FUNNEL_LABELS[draft.primary_funnel_stage]}
          </span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-brand-subtle text-brand-text border-brand-border">
            {draft.platform}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {/* Budget split */}
        <div>
          <p className={labelClass()}>
            Budget Allocation {budgetTotal !== 100 && <span className="text-warning-text">(sums to {budgetTotal}%, not 100%)</span>}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(['awareness', 'consideration', 'conversion'] as const).map((stage) => (
              <div key={stage}>
                <label className="block text-[10px] text-text-tertiary mb-0.5 capitalize">{stage}</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.budget_allocation[stage]}
                    onChange={(e) => updateBudget(stage, Number(e.target.value))}
                    className={inputClass()}
                  />
                  <span className="text-[12px] text-text-tertiary">%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Targeting */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass()}>Age Range</label>
            <input
              type="text"
              value={draft.targeting.age_range}
              onChange={(e) => updateTargeting('age_range', e.target.value)}
              className={inputClass()}
            />
          </div>
          <div>
            <label className={labelClass()}>Locations</label>
            <input
              type="text"
              value={draft.targeting.locations.join(', ')}
              onChange={(e) => updateTargeting('locations', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              className={inputClass()}
              placeholder="comma-separated"
            />
          </div>
        </div>

        <div>
          <label className={labelClass()}>Interests</label>
          <input
            type="text"
            value={draft.targeting.interests.join(', ')}
            onChange={(e) => updateTargeting('interests', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            className={inputClass()}
            placeholder="comma-separated"
          />
        </div>

        <div>
          <label className={labelClass()}>Placements</label>
          <input
            type="text"
            value={draft.placements.join(', ')}
            onChange={(e) => setDraft((d) => ({ ...d, placements: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))}
            className={inputClass()}
            placeholder="comma-separated"
          />
        </div>

        {/* Expected CPL */}
        <div>
          <label className={labelClass()}>Expected CPL Range (₹)</label>
          <div className="flex items-center gap-2 max-w-[220px]">
            <input
              type="number"
              min={0}
              value={draft.expected_cpl_range.min}
              onChange={(e) => updateCpl('min', Number(e.target.value))}
              className={inputClass()}
            />
            <span className="text-text-tertiary text-[12px]">to</span>
            <input
              type="number"
              min={0}
              value={draft.expected_cpl_range.max}
              onChange={(e) => updateCpl('max', Number(e.target.value))}
              className={inputClass()}
            />
          </div>
        </div>

        {draft.notes && (
          <div>
            <p className={labelClass()}>Arjun's Notes</p>
            <p className="text-[12px] text-text-secondary leading-relaxed italic">{draft.notes}</p>
          </div>
        )}
      </div>

      {/* Resubmit */}
      <div className="px-5 py-3 bg-surface-sunken border-t border-border flex items-center justify-between gap-3">
        <p className="text-[10px] text-text-disabled">Edit any field, then resend to Aarav for a fresh pass from Arjun.</p>
        <button
          onClick={() => onResubmit(draft)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
          Resubmit to Aarav
        </button>
      </div>
    </div>
  );
}

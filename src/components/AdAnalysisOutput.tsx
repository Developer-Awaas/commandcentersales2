import { RefreshCw } from 'lucide-react';
import { Card } from './ui/Card';
import type { AiAnalysisResult } from '../lib/ad-analysis';

// Shared renderer for an ad-performance analysis — extracted from Analyzer.tsx
// (CC-P4 Step 3) so the Analyzer page and the Performance Monitor render an
// analysis identically. Self-contained (its own status/score helpers).

const PRIORITY_STYLE: Record<number, string> = {
  1: 'bg-red-500/10 text-red-400 border-red-500/20',
  2: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  3: 'bg-brand-subtle text-brand border-brand-border',
};
const STATUS_COLOR: Record<string, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
};
function scoreColor(score: number) {
  if (score >= 8) return 'text-emerald-400';
  if (score >= 5) return 'text-amber-400';
  return 'text-red-400';
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">{children}</p>;
}

export function AdAnalysisOutput({ data, onRetry }: { data: AiAnalysisResult; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5">
        <Card className="p-5">
          <SectionLabel>Health Score</SectionLabel>
          <div className="flex items-end gap-2 mb-3">
            <span className={`text-6xl font-bold leading-none ${scoreColor(data.healthScore ?? 0)}`}>{data.healthScore ?? 0}</span>
            <span className="text-2xl font-semibold text-text-tertiary pb-1">/10</span>
          </div>
          {data.assessment && <p className="text-xs text-text-tertiary leading-relaxed">{data.assessment}</p>}
        </Card>

        {data.funnelAnalysis && (
          <Card className="p-5">
            <SectionLabel>Funnel Bottleneck</SectionLabel>
            <p className="text-sm font-semibold text-amber-400 mb-1">{data.funnelAnalysis.bottleneck}</p>
            <p className="text-xs text-text-tertiary leading-relaxed mb-2">Stage: {data.funnelAnalysis.stage}</p>
            <p className="text-xs text-brand">Fix: {data.funnelAnalysis.fix}</p>
          </Card>
        )}
      </div>

      {data.scorecard && data.scorecard.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Metric Scorecard</SectionLabel></div>
          <div className="px-5 py-2">
            {data.scorecard.map((row) => (
              <div key={row.metric} className="flex items-center gap-4 py-3 border-b border-border last:border-0">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_COLOR[row.status] ?? 'bg-text-tertiary'}`} />
                <span className="text-sm text-text-primary flex-1 font-medium">{row.metric}</span>
                <span className="text-sm text-text-primary min-w-[80px] text-right">{row.value}</span>
                <span className="text-xs text-text-tertiary min-w-[110px] text-right">Target: {row.target}</span>
                {row.insight && <span className="text-xs text-text-tertiary min-w-[140px] text-right hidden xl:block">{row.insight}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.tacticalActions && data.tacticalActions.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Tactical Actions</SectionLabel></div>
          <div className="px-5 py-3 flex flex-col gap-4">
            {data.tacticalActions.map((action, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-surface-sunken flex items-center justify-center mt-0.5">
                  <span className="text-[11px] font-bold text-text-tertiary">{i + 1}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${PRIORITY_STYLE[action.priority] ?? PRIORITY_STYLE[3]}`}>
                      P{action.priority}
                    </span>
                    {action.impact && <span className="text-[11px] text-text-tertiary">{action.impact}</span>}
                  </div>
                  <p className="text-sm text-text-primary mb-1.5">{action.action}</p>
                  {action.howTo && <p className="text-xs text-brand">→ {action.howTo}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.strategicRecs && data.strategicRecs.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-border"><SectionLabel>Strategic Recommendations</SectionLabel></div>
          <div className="px-5 py-4 flex flex-col gap-3">
            {data.strategicRecs.map((rec, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-brand flex-shrink-0 mt-0.5">•</span>
                <div>
                  <p className="text-sm text-text-primary leading-relaxed">{rec.rec}</p>
                  {rec.rationale && <p className="text-xs text-text-tertiary mt-0.5">{rec.rationale}</p>}
                  {rec.timeline && <p className="text-[11px] text-brand mt-0.5">{rec.timeline}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(data.creativeRec || data.targetingRec) && (
        <div className="grid grid-cols-2 gap-4">
          {data.creativeRec && (
            <Card className="p-4">
              <SectionLabel>Creative Recommendation</SectionLabel>
              <p className="text-sm text-text-primary leading-relaxed">{data.creativeRec}</p>
            </Card>
          )}
          {data.targetingRec && (
            <Card className="p-4">
              <SectionLabel>Targeting Recommendation</SectionLabel>
              <p className="text-sm text-text-primary leading-relaxed">{data.targetingRec}</p>
            </Card>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-brand transition-colors">
          <RefreshCw size={12} /> Reanalyze
        </button>
      </div>
    </div>
  );
}

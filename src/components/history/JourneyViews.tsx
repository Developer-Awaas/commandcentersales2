// Shared P3 history/journey renderers — extracted from History.tsx so the
// reworked Content Library (CC-P5 Step 2) can reuse the exact same expansion
// UI for tool_outputs rows instead of duplicating it.
import type { ToolOutput, ToolOutputTool, CampaignJourney } from '../../lib/history-service';

export const TOOL_LABELS: Record<ToolOutputTool, string> = {
  strategy: 'Strategy',
  ad_config: 'Ad Config',
  ad_creatives: 'Ad Creatives',
  ad_review: 'Ad Review',
  performance: 'Performance',
  smm_planner: 'SMM Planner',
  smm_creatives: 'SMM Creatives',
  smm_analysis: 'SMM Analysis',
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function JourneyView({ journey }: { journey: CampaignJourney }) {
  return (
    <div className="flex flex-col gap-3 mt-3">
      <div className="flex items-center gap-2 flex-wrap">
        {journey.toolOutputs.map((o, i) => (
          <div key={o.id} className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-1 rounded-full bg-brand-subtle text-brand border border-brand-border font-semibold">
              {TOOL_LABELS[o.tool]}
            </span>
            {i < journey.toolOutputs.length - 1 && <span className="text-text-disabled">→</span>}
          </div>
        ))}
      </div>
      {journey.creativeAssets.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {journey.creativeAssets.map((a) => (
            <img key={a.id} src={a.image_url} alt={a.angle} className="w-full aspect-square object-cover rounded-lg border border-border" />
          ))}
        </div>
      )}
    </div>
  );
}

export function SingleStageView({ output }: { output: ToolOutput }) {
  const entries = Object.entries(output.payload).filter(([, v]) => v != null && v !== '').slice(0, 8);
  return (
    <div className="flex flex-col gap-1.5 text-xs mt-3">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-text-tertiary min-w-[100px] flex-shrink-0 capitalize">{k.replace(/_/g, ' ')}:</span>
          <span className="text-text-primary break-words">{Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v).substring(0, 200)}</span>
        </div>
      ))}
    </div>
  );
}

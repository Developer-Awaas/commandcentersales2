import { useEffect, useState } from 'react';
import { History as HistoryIcon, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { getOrgId } from '../lib/constants';
import {
  listToolOutputs, getCampaignJourney, deleteToolOutput,
  type ToolOutput, type ToolOutputTool, type ToolOutputDomain, type CampaignJourney,
} from '../lib/history-service';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { TOOL_LABELS, formatDate, JourneyView, SingleStageView } from '../components/history/JourneyViews';

const ADS_TOOLS: ToolOutputTool[] = ['strategy', 'ad_config', 'ad_creatives', 'ad_review', 'performance'];
const SOCIAL_TOOLS: ToolOutputTool[] = ['smm_planner', 'smm_creatives', 'smm_analysis'];

function groupByDate(outputs: ToolOutput[]): [string, ToolOutput[]][] {
  const groups = new Map<string, ToolOutput[]>();
  for (const o of outputs) {
    const key = formatDate(o.created_at);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }
  return [...groups.entries()];
}

export interface HistoryProps {
  domain: ToolOutputDomain;
}

export function History({ domain }: HistoryProps) {
  const tools = domain === 'ads' ? ADS_TOOLS : SOCIAL_TOOLS;
  const [toolFilter, setToolFilter] = useState<ToolOutputTool | null>(null);
  const [outputs, setOutputs] = useState<ToolOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [journeys, setJourneys] = useState<Record<string, CampaignJourney>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const rows = await listToolOutputs(getOrgId(), domain, toolFilter ?? undefined, 100);
    setOutputs(rows);
    setLoading(false);
  }

  useEffect(() => { load(); }, [domain, toolFilter]);

  async function toggleExpand(output: ToolOutput) {
    if (expandedId === output.id) { setExpandedId(null); return; }
    setExpandedId(output.id);
    if (output.campaign_id && !journeys[output.id]) {
      const journey = await getCampaignJourney(output.campaign_id);
      setJourneys((prev) => ({ ...prev, [output.id]: journey }));
    }
  }

  async function handleDelete(id: string) {
    await deleteToolOutput(id);
    setDeleteConfirmId(null);
    await load();
  }

  const grouped = groupByDate(outputs);

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center gap-3 mb-7">
        <HistoryIcon size={20} className="text-brand" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">History</h1>
          <p className="text-text-tertiary text-xs mt-0.5">Every saved {domain === 'ads' ? 'ad strategy, config, creative, and review' : 'SMM plan and creative'}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setToolFilter(null)}
          className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${!toolFilter ? 'bg-brand text-white border-brand' : 'border-border text-text-tertiary hover:text-text-primary'}`}
        >
          All
        </button>
        {tools.map((t) => (
          <button
            key={t}
            onClick={() => setToolFilter(t)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${toolFilter === t ? 'bg-brand text-white border-brand' : 'border-border text-text-tertiary hover:text-text-primary'}`}
          >
            {TOOL_LABELS[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-border text-center gap-2">
          <p className="text-sm text-text-tertiary">No saved history yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(([date, rows]) => (
            <div key={date}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">{date}</p>
              <div className="flex flex-col gap-2">
                {rows.map((o) => (
                  <Card key={o.id} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <button onClick={() => toggleExpand(o)} className="flex items-center gap-3 flex-1 text-left">
                        {expandedId === o.id ? <ChevronUp size={14} className="text-text-tertiary flex-shrink-0" /> : <ChevronDown size={14} className="text-text-tertiary flex-shrink-0" />}
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-subtle text-brand border border-brand-border font-semibold">{TOOL_LABELS[o.tool]}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${o.status === 'completed' ? 'bg-green-500/10 text-green-400' : o.status === 'in_progress' ? 'bg-amber-500/10 text-amber-400' : 'bg-surface-sunken text-text-tertiary'}`}>
                          {o.status}
                        </span>
                        {o.campaign_id && <span className="text-[10px] text-text-tertiary">part of a campaign journey</span>}
                      </button>
                      {deleteConfirmId === o.id ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[11px] text-text-tertiary">Delete?</span>
                          <button onClick={() => handleDelete(o.id)} className="text-[11px] text-red-400 hover:text-red-300 font-medium">Yes</button>
                          <button onClick={() => setDeleteConfirmId(null)} className="text-[11px] text-text-tertiary">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(o.id)} className="text-text-tertiary hover:text-red-400 transition-colors flex-shrink-0">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    {expandedId === o.id && (
                      o.campaign_id && journeys[o.id]
                        ? <JourneyView journey={journeys[o.id]} />
                        : o.campaign_id
                          ? <div className="flex justify-center py-4"><Spinner size="sm" /></div>
                          : <SingleStageView output={o} />
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

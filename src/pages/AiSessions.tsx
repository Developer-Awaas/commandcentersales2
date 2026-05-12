import { useEffect, useState } from 'react';
import { Clock, History } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { AiSessionDetail } from '../components/AiSessionDetail';

interface AiSession {
  id: string;
  session_type: string;
  input_summary?: string;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  health_score?: number | null;
  created_at: string;
  recommendations?: string[];
  actions_taken?: string[];
}

const SESSION_TYPE_STYLES: Record<string, string> = {
  strategy: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  quick_generate: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  full_strategy: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  ad_config: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  creative: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  ad_review: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  analysis: 'bg-brand-subtle text-brand-text border-brand-border',
  organic: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  research: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};

const SESSION_TYPE_LABEL: Record<string, string> = {
  strategy: 'Strategy',
  quick_generate: 'Quick Generate',
  full_strategy: 'Full Strategy',
  ad_config: 'Ad Config',
  creative: 'Creative',
  ad_review: 'Ad Review',
  analysis: 'Analysis',
  organic: 'Organic',
  research: 'Research',
};

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'quick_generate', label: 'Strategy' },
  { id: 'full_strategy', label: 'Full Strategy' },
  { id: 'ad_config', label: 'Ad Config' },
  { id: 'creative', label: 'Creative' },
  { id: 'ad_review', label: 'Review' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'organic', label: 'Organic' },
];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function AiSessions() {
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<AiSession | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from('ai_sessions')
        .select('*')
        .eq('org_id', getOrgId())
        .order('created_at', { ascending: false })
        .limit(50);
      setSessions((data ?? []) as AiSession[]);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = filter === 'all'
    ? sessions
    : sessions.filter((s) => {
        if (filter === 'quick_generate') return s.session_type === 'quick_generate' || s.session_type === 'strategy';
        return s.session_type === filter;
      });

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center gap-3 mb-7">
        <History size={20} className="text-brand" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">AI Session History</h1>
          <p className="text-text-tertiary text-xs mt-0.5">Browse and review all past AI-generated outputs</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
              filter === tab.id
                ? 'bg-brand text-white'
                : 'bg-surface-sunken border border-border text-text-tertiary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <History size={40} className="text-text-disabled" />
          <p className="text-sm text-text-tertiary">No sessions found for this filter.</p>
        </div>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {filtered.map((s) => {
              const typeStyle = SESSION_TYPE_STYLES[s.session_type] ?? SESSION_TYPE_STYLES['strategy'];
              const typeLabel = SESSION_TYPE_LABEL[s.session_type] ?? s.session_type;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors group"
                >
                  <span className={`flex-shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full border ${typeStyle}`}>
                    {typeLabel}
                  </span>
                  <p className="flex-1 text-sm text-text-primary truncate group-hover:text-brand transition-colors">
                    {s.input_summary
                      ? s.input_summary.length > 120
                        ? s.input_summary.slice(0, 120) + '…'
                        : s.input_summary
                      : 'No summary'}
                  </p>
                  {s.health_score != null && (
                    <span className="flex-shrink-0 text-xs font-semibold text-brand">
                      {s.health_score}
                    </span>
                  )}
                  <div className="flex-shrink-0 flex items-center gap-1 text-text-tertiary">
                    <Clock size={11} />
                    <span className="text-[11px]">{timeAgo(s.created_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {selected && (
        <AiSessionDetail session={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

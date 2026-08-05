import { useEffect, useState } from 'react';
import { Megaphone, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { getCampaignJourney, distillCampaign, type CampaignJourney } from '../lib/history-service';
import { Spinner } from '../components/ui/Spinner';

interface Campaign {
  id: string;
  name: string;
  project_id: string | null;
  funnel_stage: string | null;
  platform: string | null;
  status: string;
  budget: { daily?: number; total?: string; duration?: number; bid_strategy?: string } | null;
  created_at: string;
  projects?: { name: string } | null;
}

function formatINR(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

function formatDate(str: string): string {
  return new Date(str).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Matches the campaigns_status_check CHECK constraint exactly
// (active/suspended/completed) — the pre-existing paused/ended/draft
// keys here never matched a real constrained value (the column had no
// CHECK at all until this migration; the table was empty on PROD before
// this feature).
const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  suspended: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  completed: 'bg-surface-sunken text-text-tertiary border border-border',
};

const TOOL_LABELS: Record<string, string> = {
  strategy: 'Strategy',
  ad_config: 'Ad Config',
  ad_creatives: 'Ad Creatives',
  ad_review: 'Ad Review',
};

function JourneyView({ journey }: { journey: CampaignJourney }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        {journey.toolOutputs.length === 0 ? (
          <p className="text-xs text-text-tertiary">No saved history for this campaign yet.</p>
        ) : (
          journey.toolOutputs.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-1 rounded-full bg-brand-subtle text-brand border border-brand-border font-semibold">
                {TOOL_LABELS[o.tool] ?? o.tool}
              </span>
              {i < journey.toolOutputs.length - 1 && <span className="text-text-disabled">→</span>}
            </div>
          ))
        )}
      </div>
      {journey.creativeAssets.length > 0 && (
        <div className="grid grid-cols-6 gap-2">
          {journey.creativeAssets.map((a) => (
            <img key={a.id} src={a.image_url} alt={a.angle} className="w-full aspect-square object-cover rounded-lg border border-border" />
          ))}
        </div>
      )}
      {/* Metrics section — placeholder until Monitor (P4) lands real
          campaign_metrics aggregation here. */}
      <div className="rounded-lg border border-dashed border-border p-3 text-center">
        <p className="text-[11px] text-text-tertiary">Performance metrics — coming in a future release.</p>
      </div>
    </div>
  );
}

export function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [journeys, setJourneys] = useState<Record<string, CampaignJourney>>({});
  const [distillConfirmId, setDistillConfirmId] = useState<string | null>(null);
  const [distilling, setDistilling] = useState(false);

  async function load() {
    const { data } = await supabase
      .from('campaigns')
      .select('*, projects(name)')
      .eq('org_id', getOrgId())
      .order('created_at', { ascending: false });
    setCampaigns((data ?? []) as Campaign[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggleExpand(campaign: Campaign) {
    if (expandedId === campaign.id) { setExpandedId(null); return; }
    setExpandedId(campaign.id);
    if (!journeys[campaign.id]) {
      const journey = await getCampaignJourney(campaign.id);
      setJourneys((prev) => ({ ...prev, [campaign.id]: journey }));
    }
  }

  async function handleStatusChange(campaign: Campaign, newStatus: string) {
    if (newStatus === 'completed') {
      setDistillConfirmId(campaign.id);
      return;
    }
    await supabase.from('campaigns').update({ status: newStatus }).eq('id', campaign.id);
    await load();
  }

  async function confirmComplete(campaign: Campaign) {
    setDistilling(true);
    try {
      await supabase.from('campaigns').update({ status: 'completed' }).eq('id', campaign.id);
      await distillCampaign(campaign.id);
      setDistillConfirmId(null);
      setExpandedId(null);
      await load();
    } finally {
      setDistilling(false);
    }
  }

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-brand-border flex items-center justify-center">
            <Megaphone size={20} className="text-brand" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Campaigns</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Track all your ad campaigns across platforms</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="md" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-sunken border border-border flex items-center justify-center">
            <Megaphone size={28} className="text-text-disabled" />
          </div>
          <p className="text-text-primary font-medium">No campaigns yet</p>
          <p className="text-text-tertiary text-sm max-w-xs">Generate a strategy to create your first campaign.</p>
        </div>
      ) : (
        <div className="bg-surface-elevated border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['', 'Campaign Name', 'Project', 'Stage', 'Platform', 'Status', 'Budget', 'Created'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaigns.map((c) => (
                <>
                  <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-4">
                      <button onClick={() => toggleExpand(c)} className="text-text-tertiary hover:text-text-primary transition-colors">
                        {expandedId === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-[13px] font-medium text-text-primary">{c.name}</td>
                    <td className="px-5 py-4 text-[13px] text-text-tertiary">{c.projects?.name ?? '—'}</td>
                    <td className="px-5 py-4 text-[13px] text-text-tertiary capitalize">{c.funnel_stage ?? '—'}</td>
                    <td className="px-5 py-4 text-[13px] text-text-tertiary capitalize">{c.platform ?? '—'}</td>
                    <td className="px-5 py-4">
                      {c.status === 'completed' ? (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES.completed}`}>completed</span>
                      ) : (
                        <select
                          value={c.status}
                          onChange={(e) => handleStatusChange(c, e.target.value)}
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize border-none outline-none cursor-pointer ${STATUS_STYLES[c.status] ?? STATUS_STYLES.active}`}
                        >
                          <option value="active">active</option>
                          <option value="suspended">suspended</option>
                          <option value="completed">completed</option>
                        </select>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[13px] text-text-tertiary">{c.budget?.daily ? formatINR(c.budget.daily) : '—'}</td>
                    <td className="px-5 py-4 text-[13px] text-text-tertiary">{formatDate(c.created_at)}</td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={8} className="px-5 py-4 bg-surface-sunken/40">
                        {journeys[c.id] ? <JourneyView journey={journeys[c.id]} /> : <div className="flex justify-center py-4"><Spinner size="sm" /></div>}
                      </td>
                    </tr>
                  )}
                  {distillConfirmId === c.id && (
                    <tr>
                      <td colSpan={8} className="px-5 py-4">
                        <div className="p-4 rounded-xl border border-warning-border bg-warning-subtle flex items-center justify-between">
                          <p className="text-sm text-warning-text">Completed campaigns are distilled for AI training and their history entries removed. Continue?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => confirmComplete(c)}
                              disabled={distilling}
                              className="px-4 py-1.5 rounded-lg bg-warning text-white text-sm font-medium hover:opacity-90 transition-colors disabled:opacity-50"
                            >
                              {distilling ? 'Distilling…' : 'Yes, Mark Complete'}
                            </button>
                            <button onClick={() => setDistillConfirmId(null)} disabled={distilling} className="px-4 py-1.5 rounded-lg border border-border text-sm text-text-tertiary hover:text-text-primary transition-colors">
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

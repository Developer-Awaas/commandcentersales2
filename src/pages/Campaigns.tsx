import { useEffect, useState } from 'react';
import { Megaphone, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/ui/Spinner';

interface Campaign {
  id: string;
  name: string;
  project_id: string | null;
  funnel_stage: string | null;
  platform: string | null;
  status: string;
  budget: number | null;
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

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  paused: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  ended: 'bg-[#7a9988]/10 text-text-tertiary border border-[#7a9988]/20',
  draft: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
};

export function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('campaigns')
        .select('*, projects(name)')
        .order('created_at', { ascending: false });
      setCampaigns((data ?? []) as Campaign[]);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#2dd4a8]/10 border border-[#2dd4a8]/20 flex items-center justify-center">
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
          <div className="w-16 h-16 rounded-2xl bg-[#1e2e24] border border-[#2a3f32] flex items-center justify-center">
            <Megaphone size={28} className="text-[#4a6558]" />
          </div>
          <p className="text-text-primary font-medium">No campaigns yet</p>
          <p className="text-text-tertiary text-sm max-w-xs">Generate a strategy to create your first campaign.</p>
        </div>
      ) : (
        <div className="bg-[#0d1410] border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Campaign Name', 'Project', 'Stage', 'Platform', 'Status', 'Budget', 'Created'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-[#4a6558] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2e24]">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-4 text-[13px] font-medium text-text-primary">{c.name}</td>
                  <td className="px-5 py-4 text-[13px] text-text-tertiary">{c.projects?.name ?? '—'}</td>
                  <td className="px-5 py-4 text-[13px] text-text-tertiary capitalize">{c.funnel_stage ?? '—'}</td>
                  <td className="px-5 py-4 text-[13px] text-text-tertiary capitalize">{c.platform ?? '—'}</td>
                  <td className="px-5 py-4">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[c.status] ?? STATUS_STYLES['draft']}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-[13px] text-text-tertiary">{c.budget ? formatINR(c.budget) : '—'}</td>
                  <td className="px-5 py-4 text-[13px] text-text-tertiary">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

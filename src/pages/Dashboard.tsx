import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  Megaphone,
  Bell,
  Zap,
  Target,
  Palette,
  TrendingUp,
  Eye,
  ArrowUpRight,
  BotMessageSquare,
  Clock,
  Smartphone,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { useNavigation } from '../contexts/NavigationContext';
import type { AppSection } from '../contexts/NavigationContext';
import { AiSessionDetail } from '../components/AiSessionDetail';
import { useChatbot } from '../contexts/ChatbotContext';

interface Project {
  id: string;
  name: string;
  locality: string;
  city: string;
  total_units: number;
  units_remaining: number;
  price_min: number;
  price_max: number;
  priority: string;
}

interface AiSession {
  id: string;
  session_type: string;
  input_summary: string;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  health_score?: number | null;
  created_at: string;
  recommendations?: string[];
  actions_taken?: string[];
}

interface DashboardData {
  activeProjects: Project[];
  activeCampaignsCount: number;
  totalSpend: number;
  totalLeads: number;
  unreadAlerts: number;
  recentSessions: AiSession[];
}

function formatINR(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}Cr`;
  }
  if (amount >= 100000) {
    return `₹${(amount / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`;
  }
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

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

const SESSION_TYPE_STYLES: Record<string, string> = {
  strategy: 'bg-brand-subtle text-brand border-brand-border',
  quick_generate: 'bg-brand-subtle text-brand border-brand-border',
  full_strategy: 'bg-brand-subtle text-brand border-brand-border',
  ad_copy: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  ad_config: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  creative: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  ad_review: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  analysis: 'bg-brand-subtle text-brand border-brand-border',
  organic: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  research: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};

const SESSION_TYPE_LABEL: Record<string, string> = {
  strategy: 'Strategy',
  quick_generate: 'Quick Gen',
  full_strategy: 'Full Strategy',
  ad_copy: 'Ad Copy',
  ad_config: 'Ad Config',
  creative: 'Creative',
  ad_review: 'Ad Review',
  analysis: 'Analysis',
  organic: 'Organic',
  research: 'Research',
};

const PRIORITY_STYLES: Record<string, string> = {
  High: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  Medium: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  Low: 'bg-neutral-100 text-text-tertiary border border-border',
};

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconColor?: string;
  loading: boolean;
}

function KpiCard({ label, value, icon: Icon, iconColor = '#2563EB', loading }: KpiCardProps) {
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-text-tertiary text-xs font-medium uppercase tracking-wider">{label}</span>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${iconColor}18`, border: `1px solid ${iconColor}28` }}
        >
          <Icon size={15} style={{ color: iconColor }} />
        </div>
      </div>
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <span className="text-[28px] font-bold text-text-primary leading-none tracking-tight">
          {value}
        </span>
      )}
    </Card>
  );
}

export function Dashboard() {
  const { navigate, setSection } = useNavigation();
  const { setCurrentData } = useChatbot();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<AiSession | null>(null);

  useEffect(() => {
    async function load() {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

      const [projectsRes, campaignsRes, metricsRes, notifRes, sessionsRes] = await Promise.all([
        supabase
          .from('projects')
          .select('*')
          .eq('is_active', true)
          .eq('org_id', getOrgId())
          .order('name'),
        supabase
          .from('campaigns')
          .select('*')
          .eq('status', 'active'),
        supabase.from('daily_metrics').select('spend,leads').gte('date', thirtyDaysAgo),
        supabase
          .from('notifications')
          .select('id')
          .eq('is_read', false),
        supabase
          .from('ai_sessions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      console.log('Projects fetched:', projectsRes.data, projectsRes.error);
      console.log('Campaigns fetched:', campaignsRes.data, campaignsRes.error);
      console.log('Metrics fetched:', metricsRes.data, metricsRes.error);
      console.log('Notifications fetched:', notifRes.data, notifRes.error);
      console.log('AI Sessions fetched:', sessionsRes.data, sessionsRes.error);

      const metrics = metricsRes.data ?? [];
      const totalSpend = metrics.reduce((s, r) => s + (Number(r.spend) || 0), 0);
      const totalLeads = metrics.reduce((s, r) => s + (Number(r.leads) || 0), 0);

      const dashData = {
        activeProjects: (projectsRes.data ?? []) as Project[],
        activeCampaignsCount: (campaignsRes.data ?? []).length,
        totalSpend,
        totalLeads,
        unreadAlerts: (notifRes.data ?? []).length,
        recentSessions: (sessionsRes.data ?? []) as AiSession[],
      };
      setData(dashData);
      setCurrentData({ page: 'dashboard', projectCount: dashData.activeProjects.length, campaignCount: dashData.activeCampaignsCount, totalSpend, totalLeads });
      setLoading(false);
    }

    load();
  }, []);

  const avgCpl = data && data.totalLeads > 0 ? data.totalSpend / data.totalLeads : 0;

  const kpis = [
    { label: 'Active Projects', value: data?.activeProjects.length ?? 0, icon: FolderKanban, iconColor: '#2563EB' },
    { label: 'Active Campaigns', value: data?.activeCampaignsCount ?? 0, icon: Megaphone, iconColor: '#60a5fa' },
    { label: 'Total Spend (30d)', value: data ? formatINR(data.totalSpend) : '₹0', icon: TrendingUp, iconColor: '#fb923c' },
    { label: 'Total Leads (30d)', value: data?.totalLeads ?? 0, icon: Target, iconColor: '#a78bfa' },
    { label: 'Avg CPL', value: avgCpl > 0 ? formatINR(avgCpl) : '—', icon: ArrowUpRight, iconColor: '#f472b6' },
    { label: 'Unread Alerts', value: data?.unreadAlerts ?? 0, icon: Bell, iconColor: '#facc15' },
  ];

  const quickActions = [
    { label: 'Generate Strategy', icon: Zap, page: 'strategy', color: '#60a5fa' },
    { label: 'Create Ad', icon: Target, page: 'ad-config', color: '#fb923c' },
    { label: 'Generate Creatives', icon: Palette, page: 'creatives', color: '#f472b6' },
    { label: 'Analyze Performance', icon: TrendingUp, page: 'analyzer', color: '#2563EB' },
    { label: 'Review Creative', icon: Eye, page: 'ad-review', color: '#a78bfa' },
  ];

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <LayoutDashboard size={20} className="text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Dashboard</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Real-time overview of your marketing performance</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            iconColor={kpi.iconColor}
            loading={loading}
          />
        ))}
      </div>

      {/* Section summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-surface-elevated border border-border rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Target size={15} className="text-blue-400" />
              </div>
              <span className="text-sm font-semibold text-text-primary">Lead Generation</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] font-bold text-text-primary leading-none">{loading ? '—' : data?.activeCampaignsCount ?? 0}</span>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Active Campaigns</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] font-bold text-text-primary leading-none">{loading ? '—' : data?.totalLeads ?? 0}</span>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Leads (30d)</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] font-bold text-text-primary leading-none">{loading ? '—' : data ? formatINR(data.totalSpend) : '₹0'}</span>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Spend (30d)</span>
            </div>
          </div>
          <button
            onClick={() => setSection('lead_gen')}
            className="self-start flex items-center gap-1.5 text-[12px] font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            Go to Lead Gen <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="bg-surface-elevated border border-border rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle border border-brand-border flex items-center justify-center">
                <Smartphone size={15} className="text-brand" />
              </div>
              <span className="text-sm font-semibold text-text-primary">Social Media</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] font-bold text-text-primary leading-none">—</span>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Planned Posts</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] font-bold text-text-primary leading-none">—</span>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Posted (Month)</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] font-bold text-text-primary leading-none">—</span>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Engagement</span>
            </div>
          </div>
          <button
            onClick={() => setSection('smm')}
            className="self-start flex items-center gap-1.5 text-[12px] font-medium text-brand hover:text-brand-hover transition-colors"
          >
            Go to SMM <ArrowUpRight size={13} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <Card className="flex flex-col min-h-[320px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <FolderKanban size={15} className="text-brand" />
              <span className="text-sm font-medium text-text-primary">Active Projects</span>
            </div>
            <button
              onClick={() => navigate('projects')}
              className="text-xs text-text-tertiary hover:text-brand transition-colors flex items-center gap-1"
            >
              View all <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Spinner size="md" />
              </div>
            ) : !data?.activeProjects.length ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-3">
                <FolderKanban size={32} className="text-border" />
                <p className="text-text-tertiary text-sm">Welcome to NH Command Center! Start by adding your first project.</p>
                <button
                  onClick={() => navigate('projects')}
                  className="px-4 py-2 rounded-lg bg-brand-subtle border border-brand-border text-sm text-brand hover:bg-brand-subtle-hover transition-all"
                >
                  Add Project
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const totalUnits = data.activeProjects.reduce((s, p) => s + (p.total_units || 0), 0);
                  const remaining = data.activeProjects.reduce((s, p) => s + (p.units_remaining || 0), 0);
                  const sold = totalUnits - remaining;
                  return (
                    <div className="px-5 py-2.5 border-b border-border">
                      <p className="text-[11px] text-text-tertiary">
                        {totalUnits} total units across {data.activeProjects.length} project{data.activeProjects.length !== 1 ? 's' : ''} · {sold} sold · {remaining} remaining
                      </p>
                    </div>
                  );
                })()}
                <div className="divide-y divide-border">
                  {data.activeProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate('projects')}
                      className="w-full text-left px-5 py-4 hover:bg-white/[0.02] transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-text-primary truncate group-hover:text-brand transition-colors">
                            {p.name}
                          </p>
                          <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                            {[p.locality, p.city].filter(Boolean).join(', ') || 'Location not set'}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-[11px] text-text-tertiary">
                              {p.units_remaining}/{p.total_units} units left
                            </span>
                            {(p.price_min > 0 || p.price_max > 0) && (
                              <span className="text-[11px] text-text-tertiary">
                                {formatINR(p.price_min)} – {formatINR(p.price_max)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            PRIORITY_STYLES[p.priority] ?? PRIORITY_STYLES['Medium']
                          }`}
                        >
                          {p.priority}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="flex flex-col min-h-[320px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <BotMessageSquare size={15} className="text-brand" />
              <span className="text-sm font-medium text-text-primary">Recent AI Sessions</span>
            </div>
            <button
              onClick={() => navigate('ai-sessions')}
              className="text-xs text-text-tertiary hover:text-brand transition-colors flex items-center gap-1"
            >
              View all <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Spinner size="md" />
              </div>
            ) : !data?.recentSessions.length ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                <BotMessageSquare size={32} className="text-border mb-3" />
                <p className="text-text-tertiary text-sm">No AI sessions yet.</p>
                <p className="text-text-tertiary text-xs mt-1">Start by generating a strategy.</p>
                <button
                  onClick={() => navigate('strategy')}
                  className="mt-3 text-xs text-brand hover:underline"
                >
                  Generate Strategy
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.recentSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSession(s)}
                    className="w-full px-5 py-4 text-left hover:bg-white/[0.02] transition-colors group"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          SESSION_TYPE_STYLES[s.session_type] ?? SESSION_TYPE_STYLES['strategy']
                        }`}
                      >
                        {SESSION_TYPE_LABEL[s.session_type] ?? s.session_type}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-text-primary leading-relaxed group-hover:text-brand transition-colors">
                          {s.input_summary
                            ? s.input_summary.length > 100
                              ? s.input_summary.slice(0, 100) + '…'
                              : s.input_summary
                            : 'No summary available'}
                        </p>
                        <div className="flex items-center gap-1 mt-1.5 text-text-tertiary">
                          <Clock size={10} />
                          <span className="text-[10px]">{timeAgo(s.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Zap size={14} className="text-brand" />
          <span className="text-sm font-medium text-text-primary">Quick Actions</span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.page}
                onClick={() => navigate(action.page)}
                className="flex flex-col items-center gap-3 p-5 rounded-xl bg-surface-elevated border border-border hover:border-brand-border hover:brightness-110 transition-all duration-150 group"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    backgroundColor: `${action.color}12`,
                    border: `1px solid ${action.color}28`,
                  }}
                >
                  <Icon size={18} style={{ color: action.color }} />
                </div>
                <span className="text-[12px] font-medium text-text-tertiary group-hover:text-text-primary text-center leading-tight transition-colors">
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedSession && (
        <AiSessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />
      )}
    </div>
  );
}

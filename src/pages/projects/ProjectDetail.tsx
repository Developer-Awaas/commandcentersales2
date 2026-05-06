import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Image, Info, Pencil, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { type Project, PRIORITY_STYLES, autoCreateConfigFromProject } from './types';
import { useToast } from '../../contexts/ToastContext';
import { AiSessionDetail } from '../../components/AiSessionDetail';
import ProjectAssetsTab from '../../components/ProjectAssetsTab';

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}

function InfoCard({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-elevated border border-border">
      <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">{label}</span>
      <span className="text-[13px] text-text-primary font-medium">{value}</span>
    </div>
  );
}

function Pills({ text, accent }: { text: string; accent?: boolean }) {
  const items = text.split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className={`text-xs px-3 py-1 rounded-full ${accent ? 'bg-[#2dd4a8]/10 text-brand border border-[#2dd4a8]/20' : 'bg-surface text-text-primary border border-border'}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

// ── Performance tab types ────────────────────────────────────────────────────

interface DailyMetric { spend: number; leads: number; cpl: number; }
interface Campaign { id: string; campaign_name: string; funnel_stage?: string; platform?: string; budget?: Record<string, unknown>; status?: string; source?: string; created_at: string; started_at?: string; }
interface AiSession { id: string; session_type: string; input_summary?: string; health_score?: number | null; created_at: string; input_data?: Record<string, unknown>; output_data?: Record<string, unknown>; recommendations?: string[]; actions_taken?: string[]; }
interface Creative { id: string; variant?: string; angle?: string; format?: string; headline?: string; review_score?: number; primary_text?: string; nano_prompt?: string; platform_used?: string; }

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl bg-surface-elevated border border-border">
      <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">{label}</span>
      <span className="text-lg font-bold text-text-primary">{value}</span>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 7 ? 'bg-brand-subtle text-brand border-brand-border'
    : score >= 4 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    : 'bg-red-500/10 text-red-400 border-red-500/20';
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}>{score}/10</span>;
}

function PerformanceTab({ project }: { project: Project }) {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<Campaign[]>([]);
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [selectedSession, setSelectedSession] = useState<AiSession | null>(null);
  const [expandedCreative, setExpandedCreative] = useState<Creative | null>(null);

  useEffect(() => {
    async function load() {
      const [metricsRes, activeCampRes, allCampRes, sessionsRes, creativesRes] = await Promise.all([
        supabase.from('daily_metrics').select('spend,leads,cpl').eq('project_id', project.id),
        supabase.from('campaigns').select('*').eq('project_id', project.id).eq('status', 'active'),
        supabase.from('campaigns').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(20),
        supabase.from('ai_sessions').select('*').contains('project_ids', [project.id]).order('created_at', { ascending: false }).limit(15),
        supabase.from('creatives').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(10),
      ]);
      setMetrics((metricsRes.data ?? []) as DailyMetric[]);
      setActiveCampaigns((activeCampRes.data ?? []) as Campaign[]);
      setAllCampaigns((allCampRes.data ?? []) as Campaign[]);
      setSessions((sessionsRes.data ?? []) as AiSession[]);
      setCreatives((creativesRes.data ?? []) as Creative[]);
      setLoading(false);
    }
    load();
  }, [project.id]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>;
  }

  const totalSpend = metrics.reduce((s, m) => s + (m.spend || 0), 0);
  const totalLeads = metrics.reduce((s, m) => s + (m.leads || 0), 0);
  const avgCpl = totalLeads > 0 ? Math.round(totalSpend / totalLeads) : 0;

  const bestCreative = creatives.filter((c) => c.review_score != null).sort((a, b) => (b.review_score ?? 0) - (a.review_score ?? 0))[0];
  const lowestCpl = metrics.filter((m) => m.cpl > 0).sort((a, b) => a.cpl - b.cpl)[0];

  const thCls = 'text-left text-[10px] font-semibold text-text-tertiary uppercase tracking-wide pb-2 pr-4';
  const tdCls = 'py-2.5 text-xs text-text-primary pr-4';
  const rowCls = 'border-b border-border last:border-0';

  return (
    <div className="flex flex-col gap-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Spend" value={totalSpend > 0 ? '₹' + totalSpend.toLocaleString('en-IN') : '—'} />
        <StatCard label="Total Leads" value={totalLeads > 0 ? totalLeads.toLocaleString('en-IN') : '—'} />
        <StatCard label="Avg CPL" value={avgCpl > 0 ? '₹' + avgCpl.toLocaleString('en-IN') : '—'} />
      </div>

      {/* Best Performing */}
      {(bestCreative || lowestCpl) && (
        <Card className="p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Best Performing</p>
          <div className="flex flex-wrap gap-5">
            {bestCreative && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-tertiary">Top creative:</span>
                <span className="text-xs text-text-primary font-medium">{bestCreative.angle || bestCreative.variant || 'Creative'}</span>
                {bestCreative.review_score != null && <ScoreBadge score={bestCreative.review_score} />}
              </div>
            )}
            {lowestCpl && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-tertiary">Lowest CPL day:</span>
                <span className="text-xs text-brand font-semibold">₹{lowestCpl.cpl.toLocaleString('en-IN')}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Active Campaigns */}
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-4">Active Campaigns</p>
        {activeCampaigns.length === 0 ? (
          <p className="text-sm text-text-tertiary">No active campaigns for this project.</p>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-border">
              <th className={thCls}>Name</th><th className={thCls}>Stage</th><th className={thCls}>Platform</th><th className={thCls}>Daily Budget</th><th className={thCls}>Started</th>
            </tr></thead>
            <tbody>
              {activeCampaigns.map((c) => (
                <tr key={c.id} className={rowCls}>
                  <td className={tdCls + ' font-medium'}>{c.campaign_name}</td>
                  <td className={tdCls}>{c.funnel_stage || '—'}</td>
                  <td className={tdCls}>{c.platform || '—'}</td>
                  <td className={tdCls}>{c.budget && typeof c.budget === 'object' ? `₹${(c.budget as Record<string,unknown>).daily ?? '—'}` : '—'}</td>
                  <td className={tdCls + ' text-text-tertiary'}>{c.started_at ? new Date(c.started_at).toLocaleDateString('en-IN') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Campaign History */}
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-4">Campaign History</p>
        {allCampaigns.length === 0 ? (
          <p className="text-sm text-text-tertiary">No campaigns found.</p>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-border">
              <th className={thCls}>Name</th><th className={thCls}>Stage</th><th className={thCls}>Platform</th><th className={thCls}>Status</th><th className={thCls}>Source</th><th className={thCls}>Created</th>
            </tr></thead>
            <tbody>
              {allCampaigns.map((c) => {
                const statusCls = c.status === 'active' ? 'bg-brand-subtle text-brand border-brand-border'
                  : c.status === 'draft' ? 'bg-[#7a9988]/10 text-text-tertiary border-[#7a9988]/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
                return (
                  <tr key={c.id} className={rowCls}>
                    <td className={tdCls + ' font-medium max-w-[160px] truncate'}>{c.campaign_name}</td>
                    <td className={tdCls}>{c.funnel_stage || '—'}</td>
                    <td className={tdCls}>{c.platform || '—'}</td>
                    <td className={tdCls}><span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${statusCls}`}>{c.status || 'draft'}</span></td>
                    <td className={tdCls + ' text-text-tertiary capitalize'}>{(c.source || '—').replace(/_/g, ' ')}</td>
                    <td className={tdCls + ' text-text-tertiary'}>{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* AI Sessions */}
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-4">AI Sessions</p>
        {sessions.length === 0 ? (
          <p className="text-sm text-text-tertiary">No AI sessions found for this project.</p>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-border">
              <th className={thCls}>Date</th><th className={thCls}>Type</th><th className={thCls}>Summary</th><th className={thCls}>Score</th>
            </tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className={rowCls + ' cursor-pointer hover:bg-surface-elevated transition-colors'} onClick={() => setSelectedSession(s)}>
                  <td className={tdCls + ' text-text-tertiary whitespace-nowrap'}>{new Date(s.created_at).toLocaleDateString('en-IN')}</td>
                  <td className={tdCls}><span className="text-[10px] px-2 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20 capitalize">{s.session_type.replace(/_/g, ' ')}</span></td>
                  <td className={tdCls + ' text-text-tertiary max-w-[220px] truncate'}>{s.input_summary || '—'}</td>
                  <td className={tdCls}>{s.health_score != null ? <ScoreBadge score={s.health_score} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Creatives */}
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-4">Creative Library</p>
        {creatives.length === 0 ? (
          <p className="text-sm text-text-tertiary">No creatives saved for this project.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {creatives.map((c) => (
              <button key={c.id} onClick={() => setExpandedCreative(expandedCreative?.id === c.id ? null : c)}
                className="text-left p-3 rounded-lg border border-border bg-[#0d1610] hover:border-[#2dd4a8]/30 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#2dd4a8]/10 text-brand border border-[#2dd4a8]/20 font-semibold">{c.variant || 'V1'}</span>
                  {c.review_score != null && <ScoreBadge score={c.review_score} />}
                </div>
                <p className="text-xs font-medium text-text-primary truncate">{c.angle || '—'}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5">{c.format || '—'} · {c.platform_used || '—'}</p>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* AI Session modal */}
      {selectedSession && <AiSessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />}

      {/* Creative expand modal */}
      {expandedCreative && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-elevated border border-border rounded-xl w-full max-w-lg max-h-[80vh] overflow-auto shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary">{expandedCreative.angle || 'Creative'}</span>
                {expandedCreative.review_score != null && <ScoreBadge score={expandedCreative.review_score} />}
              </div>
              <button onClick={() => setExpandedCreative(null)} className="text-text-tertiary hover:text-text-primary transition-colors"><X size={16} /></button>
            </div>
            <div className="flex flex-col gap-3 text-sm">
              {expandedCreative.format && <p><span className="text-text-tertiary text-xs">Format: </span><span className="text-text-primary">{expandedCreative.format}</span></p>}
              {expandedCreative.platform_used && <p><span className="text-text-tertiary text-xs">Platform: </span><span className="text-text-primary">{expandedCreative.platform_used}</span></p>}
              {expandedCreative.headline && <p><span className="text-text-tertiary text-xs">Headline: </span><span className="text-text-primary font-medium">{expandedCreative.headline}</span></p>}
              {expandedCreative.primary_text && (
                <div><p className="text-text-tertiary text-xs mb-1">Primary Text:</p><p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">{expandedCreative.primary_text}</p></div>
              )}
              {expandedCreative.nano_prompt && (
                <div><p className="text-text-tertiary text-xs mb-1">Creative Prompt:</p><p className="text-xs text-text-tertiary leading-relaxed whitespace-pre-wrap italic">{expandedCreative.nano_prompt}</p></div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectDetail({ project: p, onBack, onEdit, onDeleted }: ProjectDetailProps) {
  const { showToast } = useToast();
  const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm'>('idle');
  const [deleting, setDeleting] = useState(false);
  const [priceHistoryModal, setPriceHistoryModal] = useState(false);
  const [tab, setTab] = useState<'overview' | 'performance' | 'assets'>('overview');

  const configurations = autoCreateConfigFromProject(p);
  const priceHistory = p.price_history ?? [];

  async function handleDelete() {
    setDeleting(true);
    await supabase.from('projects').update({ is_active: false }).eq('id', p.id);
    setDeleting(false);
    showToast('Project archived', 'info');
    onDeleted();
  }

  return (
    <div className="p-8 min-h-screen bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0" style={{ backgroundColor: '#1a7a62', color: '#2dd4a8' }}>
            {p.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{p.name}</h1>
            <p className="text-sm text-text-tertiary">{[p.locality, p.city].filter(Boolean).join(', ') || 'Location not set'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {deleteStage === 'confirm' ? (
            <div className="flex items-center gap-2 bg-red-950/40 border border-red-800/40 rounded-lg px-3 py-2">
              <span className="text-sm text-red-300">Are you sure?</span>
              <Button variant="ghost" size="sm" onClick={() => setDeleteStage('idle')}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Confirm Delete'}</Button>
            </div>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onEdit}><Pencil size={14} />Edit</Button>
              <Button variant="danger" size="sm" onClick={() => setDeleteStage('confirm')}><Trash2 size={14} />Delete</Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'performance', label: 'Performance' },
          { id: 'assets', label: 'Assets', Icon: Image },
        ] as { id: string; label: string; Icon?: React.ElementType }[]).map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id as typeof tab)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-all duration-150 border-b-2 -mb-px ${
              tab === id ? 'border-[#2dd4a8] text-brand bg-[#2dd4a8]/[0.08]' : 'border-transparent text-text-tertiary hover:text-text-primary'
            }`}
          >
            {Icon && <Icon size={14} />}
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'assets' ? (
        <ProjectAssetsTab projectId={p.id} orgId={p.org_id ?? ''} />
      ) : tab === 'performance' ? (
        <PerformanceTab project={p} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-3">
            <InfoCard label="Code" value={p.code} />
            <InfoCard label="Status" value={p.status} />
            <InfoCard label="Completion %" value={p.completion_pct != null ? `${p.completion_pct}%` : null} />
            <InfoCard label="Expected Possession" value={p.expected_possession} />
            <InfoCard label="Nearest Landmarks" value={p.nearest_landmarks} />
            <InfoCard label="RERA Number" value={p.rera_number} />
            <InfoCard label="Target Buyer" value={p.target_buyer} />
            <InfoCard label="Budget Segment" value={p.budget_segment} />
            {p.priority && (
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-elevated border border-border">
                <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">Priority</span>
                <span className={`self-start text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${PRIORITY_STYLES[p.priority] ?? PRIORITY_STYLES['Medium']}`}>{p.priority}</span>
              </div>
            )}
          </div>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Configurations</p>
              {priceHistory.length > 0 && (
                <button onClick={() => setPriceHistoryModal(true)} className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-brand transition-colors">
                  <Info size={13} />Price History ({priceHistory.length})
                </button>
              )}
            </div>
            {configurations.length === 0 ? (
              <p className="text-sm text-text-tertiary">No configurations set. Edit the project to add configurations.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {configurations.map((cfg, i) => (
                  <div key={i} className={`rounded-lg border p-4 flex flex-col gap-2 ${cfg.available ? 'border-border bg-[#0d1610]' : 'border-red-900/30 bg-red-950/10'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-text-primary">{cfg.type}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.available ? 'bg-brand-subtle text-brand border-brand-border' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                        {cfg.available ? 'Available' : 'Sold Out'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {cfg.carpet && <span className="text-text-tertiary">Carpet: <span className="text-text-primary">{cfg.carpet}</span></span>}
                      {cfg.price_lacs && <span className="text-text-tertiary">Price: <span className="text-brand font-semibold">₹{cfg.price_lacs}L</span></span>}
                      {cfg.total_units != null && <span className="text-text-tertiary">Total: <span className="text-text-primary">{cfg.total_units} units</span></span>}
                      {cfg.remaining_units != null && <span className="text-text-tertiary">Remaining: <span className={cfg.remaining_units === 0 ? 'text-red-400' : 'text-text-primary'}>{cfg.remaining_units} units</span></span>}
                    </div>
                    {cfg.notes && <p className="text-[11px] text-amber-400 italic">{cfg.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {priceHistoryModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-surface-elevated border border-border rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <p className="text-sm font-semibold text-text-primary">Price History — {p.name}</p>
                  <button onClick={() => setPriceHistoryModal(false)} className="text-text-tertiary hover:text-text-primary transition-colors"><X size={16} /></button>
                </div>
                <div className="overflow-auto px-5 py-4">
                  {priceHistory.length === 0 ? (
                    <p className="text-sm text-text-tertiary py-4 text-center">No price changes recorded yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead><tr className="text-text-tertiary text-left border-b border-border">
                        <th className="pb-2 font-medium pr-4">Date & Time</th>
                        <th className="pb-2 font-medium pr-4">Configuration</th>
                        <th className="pb-2 font-medium pr-4">Old Price</th>
                        <th className="pb-2 font-medium pr-4">New Price</th>
                        <th className="pb-2 font-medium">Source</th>
                      </tr></thead>
                      <tbody>
                        {[...priceHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((entry, i) => (
                          <tr key={i} className="border-b border-border last:border-0">
                            <td className="py-2.5 pr-4 text-text-tertiary whitespace-nowrap">{new Date(entry.date).toLocaleDateString('en-IN')} {new Date(entry.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="py-2.5 pr-4 text-text-primary font-medium">{entry.type}</td>
                            <td className="py-2.5 pr-4 text-text-tertiary">₹{entry.old_price}L</td>
                            <td className="py-2.5 pr-4 text-brand font-semibold">₹{entry.new_price}L</td>
                            <td className="py-2.5 text-text-tertiary capitalize">{entry.source.replace(/_/g, ' ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {p.usps && <Card className="p-4 flex flex-col gap-3"><span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">USPs</span><Pills text={p.usps} accent /></Card>}
          {p.amenities && <Card className="p-4 flex flex-col gap-3"><span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Amenities</span><Pills text={p.amenities} /></Card>}
          {p.notes && <Card className="p-4 flex flex-col gap-2"><span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Notes</span><p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{p.notes}</p></Card>}
          {(p.landing_page_url || p.brochure_url || p.whatsapp_flow) && (
            <Card className="p-4 flex flex-col gap-3">
              <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Links</span>
              <div className="flex flex-wrap gap-3">
                {p.landing_page_url && <a href={p.landing_page_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-brand hover:underline"><ExternalLink size={13} />Landing Page</a>}
                {p.brochure_url && <a href={p.brochure_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-brand hover:underline"><ExternalLink size={13} />Brochure</a>}
                {p.whatsapp_flow && <a href={p.whatsapp_flow} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-brand hover:underline"><ExternalLink size={13} />WhatsApp Flow</a>}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

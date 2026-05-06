import { useEffect, useState } from 'react';
import { Bell, Info, AlertTriangle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { Spinner } from '../components/ui/Spinner';

type NotifType = 'performance_alert' | 'creative_refresh' | 'analysis_reminder' | 'campaign_expiry' | 'budget_alert' | 'system' | 'recommendation';
type Severity = 'info' | 'warning' | 'critical';

interface Notification {
  id: string;
  type: NotifType;
  severity: Severity;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

const TYPE_FILTER_MAP: Record<string, NotifType[] | null> = {
  All: null,
  Performance: ['performance_alert', 'budget_alert'],
  Creative: ['creative_refresh'],
  System: ['system', 'analysis_reminder', 'campaign_expiry', 'recommendation'],
};

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

function groupByDate(notifications: Notification[]): Record<string, Notification[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: Record<string, Notification[]> = {};
  for (const n of notifications) {
    const d = new Date(n.created_at);
    d.setHours(0, 0, 0, 0);
    let key: string;
    if (d.getTime() === today.getTime()) key = 'Today';
    else if (d.getTime() === yesterday.getTime()) key = 'Yesterday';
    else key = 'Earlier';
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  }
  return groups;
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === 'critical')
    return <AlertCircle size={16} className="text-red-400 flex-shrink-0" />;
  if (severity === 'warning')
    return <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />;
  return <Info size={16} className="text-blue-400 flex-shrink-0" />;
}

function SeverityRingColor(severity: Severity) {
  if (severity === 'critical') return 'border-red-500/20 bg-red-500/5';
  if (severity === 'warning') return 'border-amber-500/20 bg-amber-500/5';
  return 'border-blue-500/20 bg-blue-500/5';
}

const TABS = ['All', 'Performance', 'Creative', 'System'];

export function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('org_id', getOrgId())
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications((data ?? []) as Notification[]);
    setLoading(false);
  }

  async function markRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  }

  async function markAllRead() {
    setMarkingAll(true);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('org_id', getOrgId())
      .eq('is_read', false);
    setMarkingAll(false);
  }

  const typeFilter = TYPE_FILTER_MAP[activeTab];
  const filtered = typeFilter
    ? notifications.filter((n) => typeFilter.includes(n.type))
    : notifications;

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const grouped = groupByDate(filtered);
  const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier'];

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell size={20} className="text-[#2dd4a8]" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#2dd4a8] text-[8px] font-bold text-[#0a0f0d] flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Notifications</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Proactive alerts and campaign health warnings</p>
          </div>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={markingAll}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border text-text-tertiary hover:text-text-primary hover:border-[#2dd4a8]/30 text-xs transition-all disabled:opacity-50"
          >
            {markingAll ? <Spinner size="sm" /> : null}
            Mark All Read
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 mb-6 p-1 bg-[#111916] rounded-lg border border-border w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === tab
                ? 'bg-[#2dd4a8]/10 text-[#2dd4a8] border border-[#2dd4a8]/20'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-12 justify-center">
          <Spinner size="sm" />
          <span className="text-sm text-text-tertiary">Loading notifications…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-full bg-[#111916] border border-border flex items-center justify-center mb-4">
            <Bell size={20} className="text-text-tertiary" />
          </div>
          <p className="text-sm font-medium text-text-primary mb-2">No notifications yet</p>
          <p className="text-xs text-text-tertiary leading-relaxed">
            Alerts will appear here when campaigns need attention, creatives need refreshing, or performance changes significantly.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {GROUP_ORDER.filter((g) => grouped[g]?.length > 0).map((group) => (
            <div key={group}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">
                {group}
              </p>
              <div className="flex flex-col gap-2">
                {grouped[group].map((notif) => (
                  <button
                    key={notif.id}
                    onClick={() => !notif.is_read && markRead(notif.id)}
                    className={`w-full text-left rounded-xl border p-4 transition-all ${
                      notif.is_read
                        ? 'bg-[#111916] border-border opacity-60 hover:opacity-80'
                        : `${SeverityRingColor(notif.severity)} border hover:opacity-90`
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        <SeverityIcon severity={notif.severity} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3 mb-0.5">
                          <p className="text-sm font-semibold text-text-primary truncate">
                            {notif.title}
                          </p>
                          <span className="text-[11px] text-text-tertiary flex-shrink-0">
                            {timeAgo(notif.created_at)}
                          </span>
                        </div>
                        <p className="text-xs text-text-tertiary leading-relaxed line-clamp-2">
                          {notif.message}
                        </p>
                      </div>
                      {!notif.is_read && (
                        <div className="w-2 h-2 rounded-full bg-[#2dd4a8] flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

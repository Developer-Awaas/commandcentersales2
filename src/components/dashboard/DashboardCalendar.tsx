import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOrgId } from '../../lib/constants';
import { useNavigation } from '../../contexts/NavigationContext';
import {
  isoDay, countByDate, buildMonthGrid, itemsForDate, upcomingItems,
  type AgendaItem,
} from '../../lib/calendar-agenda';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const STATUS_DOT: Record<string, string> = {
  planned: '#eab308', created: '#3b82f6', posted: '#22c55e', skipped: '#71717a',
};

function timeLabel(t: string | null): string {
  if (!t) return '—';
  const [h, m] = t.split(':');
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${m ?? '00'} ${ampm}`;
}

// Read-only aggregation of smm_calendar for the Dashboard (CC-P5 Step 3).
// Editing lives in Content Calendar — this links through. Mark-complete is the
// one inline action (reuses the smm_calendar status→'posted' update).
export function DashboardCalendar() {
  const { navigate } = useNavigation();
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => new Date(), []);
  const todayIso = isoDay(today);
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDay, setSelectedDay] = useState<string>(todayIso);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('smm_calendar')
      .select('id, post_date, post_time, topic, status, platform')
      .eq('org_id', getOrgId())
      .order('post_date', { ascending: true })
      .limit(300);
    setItems((data || []).map((r: any) => ({
      id: r.id, date: r.post_date, time: r.post_time ?? null,
      title: r.topic || 'Untitled', status: r.status || 'planned', platform: r.platform || 'both',
    })));
    setLoading(false);
  };

  const counts = useMemo(() => countByDate(items), [items]);
  const grid = useMemo(() => buildMonthGrid(view.year, view.month, counts), [view, counts]);
  const dayItems = useMemo(() => itemsForDate(items, selectedDay), [items, selectedDay]);
  const upcoming = useMemo(() => upcomingItems(items, todayIso, 5), [items, todayIso]);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const markPosted = async (id: string) => {
    const { error } = await supabase.from('smm_calendar').update({ status: 'posted' }).eq('id', id);
    if (!error) setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'posted' } : it)));
  };

  const isEmpty = !loading && items.length === 0;

  return (
    <div className="bg-surface-elevated border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <CalendarDays size={15} className="text-emerald-400" />
          </div>
          <span className="text-sm font-semibold text-text-primary">Content Calendar</span>
        </div>
        <button onClick={() => navigate('smm-calendar')} className="flex items-center gap-1 text-xs text-brand hover:underline">
          Open <ExternalLink size={12} />
        </button>
      </div>

      {isEmpty ? (
        <div className="text-center py-8 text-text-tertiary">
          <CalendarDays size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No scheduled posts yet.</p>
          <p className="text-xs mt-1">Plan posts in SMM Planner to see them here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {/* Month grid */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => shiftMonth(-1)} className="p-1 text-text-tertiary hover:text-text-primary" aria-label="Previous month"><ChevronLeft size={16} /></button>
              <span className="text-xs font-semibold text-text-primary">{MONTHS[view.month]} {view.year}</span>
              <button onClick={() => shiftMonth(1)} className="p-1 text-text-tertiary hover:text-text-primary" aria-label="Next month"><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <div key={i} className="text-[9px] text-text-tertiary text-center font-medium py-1">{w}</div>
              ))}
              {grid.flat().map((cell) => {
                const isToday = cell.iso === todayIso;
                const isSelected = cell.iso === selectedDay;
                return (
                  <button
                    key={cell.iso}
                    onClick={() => setSelectedDay(cell.iso)}
                    className={[
                      'relative aspect-square rounded-md text-[11px] flex items-center justify-center',
                      cell.inMonth ? 'text-text-primary' : 'text-text-disabled',
                      isSelected ? 'bg-brand text-white' : isToday ? 'bg-brand-subtle' : 'hover:bg-surface',
                    ].join(' ')}
                  >
                    {cell.day}
                    {cell.count > 0 && (
                      <span className={[
                        'absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full',
                        isSelected ? 'bg-white' : 'bg-brand',
                        cell.count > 1 ? 'w-3 h-1' : 'w-1 h-1',
                      ].join(' ')} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected day + upcoming */}
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                {selectedDay === todayIso ? 'Today' : selectedDay}
              </p>
              {dayItems.length === 0 ? (
                <p className="text-xs text-text-tertiary">No posts scheduled.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {dayItems.map((it) => (
                    <AgendaRow key={it.id} item={it} onMarkPosted={markPosted} />
                  ))}
                </div>
              )}
            </div>

            {upcoming.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Upcoming</p>
                <div className="flex flex-col gap-1.5">
                  {upcoming.map((it) => (
                    <div key={it.id} className="flex items-center gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[it.status] ?? '#71717a' }} />
                      <span className="text-text-tertiary w-16 flex-shrink-0">{it.date.slice(5)}</span>
                      <span className="text-text-primary truncate">{it.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AgendaRow({ item, onMarkPosted }: { item: AgendaItem; onMarkPosted: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs bg-surface rounded-lg px-2.5 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[item.status] ?? '#71717a' }} />
      <span className="text-text-tertiary w-16 flex-shrink-0">{timeLabel(item.time)}</span>
      <span className="text-text-primary truncate flex-1">{item.title}</span>
      {item.status !== 'posted' ? (
        <button onClick={() => onMarkPosted(item.id)} className="flex items-center gap-1 text-[10px] text-brand hover:underline flex-shrink-0" title="Mark as posted">
          <Check size={11} /> Done
        </button>
      ) : (
        <span className="text-[10px] text-emerald-500 flex-shrink-0">Posted</span>
      )}
    </div>
  );
}

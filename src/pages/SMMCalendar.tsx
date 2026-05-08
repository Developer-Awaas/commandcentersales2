import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, CreditCard as Edit3, Check, X, Eye, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';

const C = {
  bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7', accent: '#2563EB',
  text: '#18181B', dim: '#71717A', red: '#ef4444', yellow: '#eab308',
  green: '#22c55e', blue: '#3b82f6', purple: '#8b5cf6', pink: '#ec4899'
};

const TYPE_COLORS: Record<string, string> = {
  reel: C.blue, carousel: C.green, static: C.dim, story: C.yellow, video: C.purple
};

const STATUS_COLORS: Record<string, string> = {
  planned: C.yellow, created: C.blue, posted: C.green, skipped: C.dim
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function SMMCalendar() {
  const { showToast } = useToast();
  const [posts, setPosts] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');

  useEffect(() => { fetchData(); }, [viewMonth, viewYear]);

  const fetchData = async () => {
    setLoading(true);
    const startDate = new Date(viewYear, viewMonth, 1).toISOString().split('T')[0];
    const endDate = new Date(viewYear, viewMonth + 1, 0).toISOString().split('T')[0];

    const [postsRes, eventsRes] = await Promise.all([
      supabase.from('smm_calendar').select('*').gte('post_date', startDate).lte('post_date', endDate).order('post_date'),
      supabase.from('events_calendar').select('*').eq('org_id', getOrgId()).gte('date', startDate).lte('date', endDate),
    ]);

    setPosts(postsRes.data || []);
    setEvents(eventsRes.data || []);
    setLoading(false);
  };

  const updatePostStatus = async (id: string, status: string) => {
    await supabase.from('smm_calendar').update({ status }).eq('id', id);
    fetchData();
    showToast('Post status updated', 'success');
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i);
  while (calendarDays.length % 7 !== 0) calendarDays.push(null);

  const getPostsForDay = (day: number) => {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return posts.filter(p => p.post_date === dateStr);
  };

  const getEventsForDay = (day: number) => {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter(e => e.date === dateStr);
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    showToast('Copied!', 'success');
  };

  const totalPlanned = posts.filter(p => p.status === 'planned').length;
  const totalPosted = posts.filter(p => p.status === 'posted').length;
  const totalPosts = posts.length;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>Content Calendar</h1>
          <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>Visual calendar of all planned and posted content</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setViewMode('week')} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: viewMode === 'week' ? C.accent : 'transparent', color: viewMode === 'week' ? C.bg : C.dim, border: '1px solid ' + C.border }}>Week</button>
          <button onClick={() => setViewMode('month')} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: viewMode === 'month' ? C.accent : 'transparent', color: viewMode === 'month' ? C.bg : C.dim, border: '1px solid ' + C.border }}>Month</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[['Total Posts', totalPosts, C.text], ['Planned', totalPlanned, C.yellow], ['Posted', totalPosted, C.green], ['Completion', totalPosts > 0 ? Math.round(totalPosted / totalPosts * 100) + '%' : '0%', C.accent]].map(([label, val, color]) => (
          <div key={label as string} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 10, padding: 14, textAlign: 'center' }}>
            <p style={{ fontSize: 22, fontWeight: 700, color: color as string }}>{val}</p>
            <p style={{ fontSize: 11, color: C.dim }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Month Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={prevMonth} style={{ padding: '8px 12px', borderRadius: 8, background: C.card, border: '1px solid ' + C.border, cursor: 'pointer', color: C.dim }}>
          <ChevronLeft size={18} />
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text }}>{MONTHS[viewMonth]} {viewYear}</h2>
        <button onClick={nextMonth} style={{ padding: '8px 12px', borderRadius: 8, background: C.card, border: '1px solid ' + C.border, cursor: 'pointer', color: C.dim }}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Calendar Grid */}
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, overflow: 'hidden' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid ' + C.border }}>
          {DAYS.map(d => (
            <div key={d} style={{ padding: 10, textAlign: 'center', fontSize: 12, fontWeight: 600, color: C.dim }}>{d}</div>
          ))}
        </div>
        {/* Weeks */}
        {Array.from({ length: calendarDays.length / 7 }, (_, week) => (
          <div key={week} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: week < calendarDays.length / 7 - 1 ? '1px solid ' + C.border : 'none' }}>
            {calendarDays.slice(week * 7, week * 7 + 7).map((day, di) => {
              const dayPosts = day ? getPostsForDay(day) : [];
              const dayEvents = day ? getEventsForDay(day) : [];
              const isToday = day === new Date().getDate() && viewMonth === new Date().getMonth() && viewYear === new Date().getFullYear();
              return (
                <div key={di} style={{
                  minHeight: 90, padding: 6, borderRight: di < 6 ? '1px solid ' + C.border : 'none',
                  background: isToday ? C.accent + '08' : 'transparent',
                }}>
                  {day && (
                    <>
                      <p style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? C.accent : C.text, marginBottom: 4 }}>{day}</p>
                      {dayEvents.map((ev, i) => (
                        <div key={'ev' + i} style={{ fontSize: 9, padding: '2px 4px', borderRadius: 3, background: C.red + '20', color: C.red, marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          🎉 {ev.name}
                        </div>
                      ))}
                      {dayPosts.map((post, i) => (
                        <div key={i} onClick={() => setSelectedPost(post)} style={{
                          fontSize: 10, padding: '3px 5px', borderRadius: 4, marginBottom: 2, cursor: 'pointer',
                          background: (TYPE_COLORS[post.post_type] || C.dim) + '20',
                          borderLeft: '3px solid ' + (TYPE_COLORS[post.post_type] || C.dim),
                          color: C.text, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                        }}>
                          {post.post_type?.charAt(0).toUpperCase()}: {post.topic || 'Untitled'}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Type Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center' }}>
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 11, color: C.dim, textTransform: 'capitalize' }}>{type}</span>
          </div>
        ))}
      </div>

      {/* Post Detail Modal */}
      {selectedPost && (
        <div onClick={() => setSelectedPost(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 24, maxWidth: 600, width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 8, background: (TYPE_COLORS[selectedPost.post_type] || C.dim) + '20', color: TYPE_COLORS[selectedPost.post_type] || C.dim, fontWeight: 600 }}>
                  {selectedPost.post_type}
                </span>
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 8, background: (STATUS_COLORS[selectedPost.status] || C.dim) + '20', color: STATUS_COLORS[selectedPost.status] || C.dim }}>
                  {selectedPost.status}
                </span>
              </div>
              <button onClick={() => setSelectedPost(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} style={{ color: C.dim }} />
              </button>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 4 }}>{selectedPost.topic}</h3>
            <p style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>{selectedPost.post_date} at {selectedPost.post_time || 'Not set'} on {selectedPost.platform}</p>

            {selectedPost.caption_en && (
              <div style={{ background: C.bg, padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Caption (English)</span>
                  <button onClick={() => copy(selectedPost.caption_en)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedPost.caption_en}</p>
              </div>
            )}

            {selectedPost.caption_od && (
              <div style={{ background: C.bg, padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Caption (Odia)</span>
                  <button onClick={() => copy(selectedPost.caption_od)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedPost.caption_od}</p>
              </div>
            )}

            {selectedPost.nano_prompt && (
              <div style={{ background: '#7c3aed10', border: '1px solid #7c3aed30', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#a78bfa' }}>Image Prompt</span>
                  <button onClick={() => copy(selectedPost.nano_prompt)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{selectedPost.nano_prompt}</p>
              </div>
            )}

            {selectedPost.reel_script && (
              <div style={{ background: C.bg, padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Reel Script</span>
                  <button onClick={() => copy(selectedPost.reel_script)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedPost.reel_script}</p>
              </div>
            )}

            {selectedPost.hashtags && selectedPost.hashtags.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Hashtags</span>
                  <button onClick={() => copy(selectedPost.hashtags.map((h: string) => '#' + h).join(' '))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy All</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedPost.hashtags.map((h: string, i: number) => (
                    <span key={i} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: C.bg, color: C.dim }}>#{h}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Status Change Buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid ' + C.border }}>
              {['planned', 'created', 'posted', 'skipped'].map(status => (
                <button key={status} onClick={() => { updatePostStatus(selectedPost.id, status); setSelectedPost({ ...selectedPost, status }); }}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
                    background: selectedPost.status === status ? (STATUS_COLORS[status] || C.dim) + '30' : C.bg,
                    color: selectedPost.status === status ? STATUS_COLORS[status] || C.dim : C.dim,
                    border: '1px solid ' + (selectedPost.status === status ? STATUS_COLORS[status] || C.dim : C.border),
                  }}>
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {posts.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: C.dim }}>
          <Calendar size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
          <p style={{ fontSize: 14 }}>No posts planned for {MONTHS[viewMonth]}.</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>Go to SMM Planner to generate a content plan.</p>
        </div>
      )}
    </div>
  );
}

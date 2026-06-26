import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Calendar, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import {
  dayFromIso,
  normalizePlatform, normalizePostType,
  PLATFORM_OPTIONS, POST_TYPE_OPTIONS,
  type PendingPost,
} from '../lib/smm-helpers';

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
  const [editingDraft, setEditingDraft] = useState<PendingPost | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchData(); }, [viewMonth, viewYear]);

  const fetchData = async () => {
    setLoading(true);
    const startDate = new Date(viewYear, viewMonth, 1).toISOString().split('T')[0];
    const endDate = new Date(viewYear, viewMonth + 1, 0).toISOString().split('T')[0];

    const [postsRes, eventsRes] = await Promise.all([
      supabase.from('smm_calendar').select('*').eq('org_id', getOrgId()).gte('post_date', startDate).lte('post_date', endDate).order('post_date'),
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

  const pendingPostFromRow = (row: any): PendingPost => ({
    _id: row.id,
    date: row.post_date,
    day: row.post_date ? dayFromIso(row.post_date) : '',
    platform: normalizePlatform(row.platform),
    type: normalizePostType(row.post_type),
    category: row.category,
    topic: row.topic || '',
    time: row.post_time ? String(row.post_time).slice(0, 5) : '',
    captionEn: row.caption_en,
    captionOd: row.caption_od,
    hashtags: row.hashtags || [],
    nanoPrompt: row.nano_prompt,
    reelScript: row.reel_script,
  });

  const openAdd = () => {
    setSelectedPost(null);
    setDeleteConfirmId(null);
    const today = new Date().toISOString().split('T')[0];
    setEditingDraft({
      _id: 'new',
      date: today,
      day: dayFromIso(today),
      platform: 'both',
      type: 'static',
      topic: '',
      time: '',
    });
  };

  const openEdit = () => {
    if (!selectedPost) return;
    setDeleteConfirmId(null);
    setEditingDraft(pendingPostFromRow(selectedPost));
  };

  const closeForm = () => setEditingDraft(null);

  const closeModal = () => {
    setSelectedPost(null);
    setEditingDraft(null);
    setDeleteConfirmId(null);
  };

  const updateDraft = <K extends keyof PendingPost>(field: K, value: PendingPost[K]) => {
    setEditingDraft(prev => (prev ? { ...prev, [field]: value } : prev));
  };

  const requestDelete = (id: string) => setDeleteConfirmId(id);
  const cancelDelete = () => setDeleteConfirmId(null);

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('smm_calendar').delete().eq('id', deleteConfirmId);
      if (error) {
        console.error('[SMM Calendar] Delete failed:', error);
        showToast('Failed to delete. Try again.', 'error');
        setSaving(false);
        return;
      }
      showToast('Event deleted', 'success');
      closeModal();
      await fetchData();
    } catch (err) {
      console.error('[SMM Calendar] Delete error:', err);
      showToast('Failed to delete. Try again.', 'error');
    }
    setSaving(false);
  };

  const saveDraft = async () => {
    if (!editingDraft) return;
    if (!editingDraft.topic.trim()) {
      showToast('Topic is required.', 'error');
      return;
    }
    if (!editingDraft.date) {
      showToast('Date is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        post_date: editingDraft.date,
        post_time: editingDraft.time || null,
        platform: normalizePlatform(editingDraft.platform),
        post_type: normalizePostType(editingDraft.type),
        category: editingDraft.category || null,
        topic: editingDraft.topic,
        caption_en: editingDraft.captionEn || null,
        caption_od: editingDraft.captionOd || null,
        hashtags: editingDraft.hashtags || [],
        nano_prompt: editingDraft.nanoPrompt || null,
        reel_script: editingDraft.reelScript || null,
      };

      if (editingDraft._id === 'new') {
        const { error } = await supabase.from('smm_calendar').insert({
          ...payload,
          org_id: getOrgId(),
          status: 'planned',
        });
        if (error) {
          console.error('[SMM Calendar] Insert failed:', error);
          showToast('Failed to add event. Try again.', 'error');
          setSaving(false);
          return;
        }
        showToast('Event added to calendar', 'success');
      } else {
        const { error } = await supabase.from('smm_calendar').update(payload).eq('id', editingDraft._id);
        if (error) {
          console.error('[SMM Calendar] Update failed:', error);
          showToast('Failed to save changes. Try again.', 'error');
          setSaving(false);
          return;
        }
        showToast('Event updated', 'success');
      }
      closeModal();
      await fetchData();
    } catch (err) {
      console.error('[SMM Calendar] Save error:', err);
      showToast('Failed to save. Try again.', 'error');
    }
    setSaving(false);
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
          <button onClick={openAdd}
            style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={14} /> Add Event
          </button>
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

      {/* Modal — tri-state container: view / edit / add */}
      {(selectedPost || editingDraft) && (
        <div onClick={closeModal} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 24, maxWidth: 600, width: '90%', maxHeight: '85vh', overflow: 'auto' }}>

            {editingDraft ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>
                    {editingDraft._id === 'new' ? 'Add Event' : 'Edit Event'}
                  </h3>
                  <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    <X size={18} style={{ color: C.dim }} />
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="text-xs text-text-tertiary">Date</label>
                      <input type="date" value={editingDraft.date}
                        onChange={(e) => updateDraft('date', e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                    </div>
                    <div>
                      <label className="text-xs text-text-tertiary">Time</label>
                      <input type="time" value={editingDraft.time || ''}
                        onChange={(e) => updateDraft('time', e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                    </div>
                    <div>
                      <label className="text-xs text-text-tertiary">Platform</label>
                      <select value={editingDraft.platform}
                        onChange={(e) => updateDraft('platform', e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface">
                        {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-text-tertiary">Type</label>
                      <select value={editingDraft.type}
                        onChange={(e) => updateDraft('type', e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface">
                        {POST_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text-tertiary">Topic</label>
                    <input type="text" value={editingDraft.topic}
                      onChange={(e) => updateDraft('topic', e.target.value)}
                      placeholder="What is this post about?"
                      className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                  </div>
                  <div>
                    <label className="text-xs text-text-tertiary">Category</label>
                    <input type="text" value={editingDraft.category || ''}
                      onChange={(e) => updateDraft('category', e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                  </div>
                  <div>
                    <label className="text-xs text-text-tertiary">Caption (English)</label>
                    <textarea value={editingDraft.captionEn || ''}
                      onChange={(e) => updateDraft('captionEn', e.target.value)}
                      rows={4}
                      className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                  </div>
                  <div>
                    <label className="text-xs text-text-tertiary">Caption (Odia)</label>
                    <textarea value={editingDraft.captionOd || ''}
                      onChange={(e) => updateDraft('captionOd', e.target.value)}
                      rows={4}
                      className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                  </div>
                  <div>
                    <label className="text-xs text-text-tertiary">Hashtags (comma-separated)</label>
                    <input type="text" value={(editingDraft.hashtags || []).join(', ')}
                      onChange={(e) => updateDraft('hashtags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                      className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                  </div>
                  <div>
                    <label className="text-xs text-text-tertiary">Image Prompt</label>
                    <textarea value={editingDraft.nanoPrompt || ''}
                      onChange={(e) => updateDraft('nanoPrompt', e.target.value)}
                      rows={3}
                      className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                  </div>
                  {(editingDraft.type === 'reel' || editingDraft.type === 'video') && (
                    <div>
                      <label className="text-xs text-text-tertiary">Reel Script</label>
                      <textarea value={editingDraft.reelScript || ''}
                        onChange={(e) => updateDraft('reelScript', e.target.value)}
                        rows={3}
                        className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                    </div>
                  )}
                  <div className="flex gap-2 justify-end mt-2">
                    <button onClick={selectedPost ? closeForm : closeModal}
                      disabled={saving}
                      className="px-4 py-1.5 rounded-lg border border-border text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-40">
                      Cancel
                    </button>
                    <button onClick={saveDraft}
                      disabled={saving}
                      className="px-4 py-1.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors disabled:opacity-40 flex items-center gap-2">
                      {saving && <RefreshCw size={14} className="animate-spin" />}
                      {saving ? 'Saving…' : editingDraft._id === 'new' ? 'Add Event' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </>
            ) : selectedPost ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 8, background: (TYPE_COLORS[selectedPost.post_type] || C.dim) + '20', color: TYPE_COLORS[selectedPost.post_type] || C.dim, fontWeight: 600 }}>
                      {selectedPost.post_type}
                    </span>
                    <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 8, background: (STATUS_COLORS[selectedPost.status] || C.dim) + '20', color: STATUS_COLORS[selectedPost.status] || C.dim }}>
                      {selectedPost.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={openEdit} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                      <Pencil size={16} style={{ color: C.accent }} />
                    </button>
                    <button onClick={() => requestDelete(selectedPost.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                      <Trash2 size={16} style={{ color: C.accent }} />
                    </button>
                    <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                      <X size={18} style={{ color: C.dim }} />
                    </button>
                  </div>
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

                {deleteConfirmId === selectedPost.id ? (
                  <div className="mt-4 p-4 rounded-lg border border-warning-border bg-warning-subtle flex items-center gap-2">
                    <p className="text-sm text-warning-text flex-1">Delete this event? This can't be undone.</p>
                    <button onClick={confirmDelete}
                      disabled={saving}
                      className="px-3 py-1 rounded bg-warning text-white text-xs font-medium hover:opacity-90 transition-colors disabled:opacity-40">
                      {saving ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button onClick={cancelDelete}
                      disabled={saving}
                      className="px-3 py-1 rounded border border-border text-xs text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-40">
                      Cancel
                    </button>
                  </div>
                ) : (
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
                )}
              </>
            ) : null}

          </div>
        </div>
      )}

      {posts.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: C.dim }}>
          <Calendar size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
          <p style={{ fontSize: 14 }}>No posts planned for {MONTHS[viewMonth]}.</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>Generate a plan in SMM Planner, or click + Add Event to create one manually.</p>
        </div>
      )}
    </div>
  );
}

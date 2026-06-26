import { useState, useEffect } from 'react';
import { Library, Search, Trash2, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';

const C = {
  bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7', accent: '#2563EB',
  text: '#18181B', dim: '#71717A', red: '#ef4444', yellow: '#eab308',
  green: '#22c55e', blue: '#3b82f6', purple: '#8b5cf6', pink: '#ec4899'
};

const TYPE_COLORS: Record<string, string> = {
  reel: C.blue, carousel: C.green, static: C.dim, story: C.yellow, video: C.purple
};

const CATEGORY_LABELS: Record<string, string> = {
  company_branding: '🏢 Company Branding', project_branding: '🏠 Project',
  holiday: '🎉 Holiday', event: '📅 Event', engagement: '💬 Engagement',
  awareness: '📚 Awareness', milestone: '🏆 Milestone', testimonial: '⭐ Testimonial',
};

const STATUS_LABELS: Record<string, { color: string; label: string }> = {
  planned: { color: C.yellow, label: 'Planned' },
  created: { color: C.blue, label: 'Created' },
  posted: { color: C.green, label: 'Posted' },
  skipped: { color: C.dim, label: 'Skipped' },
};

export default function ContentLibrary() {
  const { showToast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [selectedItem, setSelectedItem] = useState<any>(null);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    const { data } = await supabase.from('smm_calendar')
      .select('*')
      .order('post_date', { ascending: false })
      .limit(100);
    setItems(data || []);
    setLoading(false);
  };

  const filtered = items.filter(item => {
    if (search && !(item.topic?.toLowerCase().includes(search.toLowerCase()) || item.caption_en?.toLowerCase().includes(search.toLowerCase()))) return false;
    if (filterType !== 'all' && item.post_type !== filterType) return false;
    if (filterStatus !== 'all' && item.status !== filterStatus) return false;
    if (filterCategory !== 'all' && item.category !== filterCategory) return false;
    return true;
  });

  const deleteItem = async (id: string) => {
    await supabase.from('smm_calendar').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedItem(null);
    showToast('Item deleted', 'info');
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    showToast('Copied!', 'success');
  };

  const stats = {
    total: items.length,
    planned: items.filter(i => i.status === 'planned').length,
    created: items.filter(i => i.status === 'created').length,
    posted: items.filter(i => i.status === 'posted').length,
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>Content Library</h1>
          <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>Browse all your saved social media content</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[['Total', stats.total, C.text], ['Planned', stats.planned, C.yellow], ['Created', stats.created, C.blue], ['Posted', stats.posted, C.green]].map(([label, count, color]) => (
            <div key={label as string} style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 18, fontWeight: 700, color: color as string }}>{count}</p>
              <p style={{ fontSize: 10, color: C.dim }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search + Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.dim }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by topic or caption..."
            style={{ width: '100%', padding: '10px 10px 10px 34px', borderRadius: 8, background: C.card, color: C.text, border: '1px solid ' + C.border, fontSize: 13, outline: 'none' }}
          />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 8, background: C.card, color: C.text, border: '1px solid ' + C.border, fontSize: 12 }}>
          <option value="all">All Types</option>
          {['reel', 'carousel', 'static', 'story', 'video'].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 8, background: C.card, color: C.text, border: '1px solid ' + C.border, fontSize: 12 }}>
          <option value="all">All Status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 8, background: C.card, color: C.text, border: '1px solid ' + C.border, fontSize: 12 }}>
          <option value="all">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Content Grid */}
      {filtered.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: C.dim }}>
          <Library size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
          <p style={{ fontSize: 14 }}>{search || filterType !== 'all' || filterStatus !== 'all' ? 'No content matches your filters.' : 'No content saved yet.'}</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>Generate content from SMM Planner or SMM Creatives to build your library.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {filtered.map(item => {
          const statusInfo = STATUS_LABELS[item.status] || STATUS_LABELS.planned;
          return (
            <div key={item.id} onClick={() => setSelectedItem(item)} style={{
              background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16, cursor: 'pointer',
              transition: 'border-color 0.2s',
            }}
            onMouseOver={e => (e.currentTarget.style.borderColor = C.accent)}
            onMouseOut={e => (e.currentTarget.style.borderColor = C.border)}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: (TYPE_COLORS[item.post_type] || C.dim) + '20', color: TYPE_COLORS[item.post_type] || C.dim }}>{item.post_type}</span>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: statusInfo.color + '20', color: statusInfo.color }}>{statusInfo.label}</span>
                </div>
                <span style={{ fontSize: 10, color: C.dim }}>{item.post_date}</span>
              </div>

              {/* Category */}
              {item.category && (
                <p style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>{CATEGORY_LABELS[item.category] || item.category}</p>
              )}

              {/* Topic */}
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.topic || 'Untitled'}
              </p>

              {/* Caption preview */}
              <p style={{ fontSize: 12, color: C.dim, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any }}>
                {item.caption_en || 'No caption'}
              </p>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid ' + C.border }}>
                <span style={{ fontSize: 10, color: C.dim }}>{item.platform || 'both'} | {item.post_time || 'No time'}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {item.nano_prompt && <span style={{ fontSize: 9, padding: '2px 4px', borderRadius: 3, background: C.purple + '20', color: C.purple }}>Prompt</span>}
                  {item.reel_script && <span style={{ fontSize: 9, padding: '2px 4px', borderRadius: 3, background: C.blue + '20', color: C.blue }}>Script</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Modal */}
      {selectedItem && (
        <div onClick={() => setSelectedItem(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 24, maxWidth: 650, width: '90%', maxHeight: '85vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 8, background: (TYPE_COLORS[selectedItem.post_type] || C.dim) + '20', color: TYPE_COLORS[selectedItem.post_type] || C.dim, fontWeight: 600 }}>{selectedItem.post_type}</span>
                {selectedItem.category && <span style={{ fontSize: 11, color: C.dim }}>{CATEGORY_LABELS[selectedItem.category]}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => deleteItem(selectedItem.id)} style={{ padding: '6px 10px', borderRadius: 6, background: C.red + '15', color: C.red, border: 'none', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Trash2 size={12} /> Delete
                </button>
                <button onClick={() => setSelectedItem(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, fontSize: 18 }}>✕</button>
              </div>
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 4 }}>{selectedItem.topic}</h3>
            <p style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>
              <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {selectedItem.post_date} at {selectedItem.post_time || 'Not set'} | {selectedItem.platform}
            </p>

            {selectedItem.caption_en && (
              <div style={{ background: C.bg, padding: 14, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Caption (English)</span>
                  <button onClick={() => copy(selectedItem.caption_en)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedItem.caption_en}</p>
              </div>
            )}

            {selectedItem.caption_od && (
              <div style={{ background: C.bg, padding: 14, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Caption (Odia)</span>
                  <button onClick={() => copy(selectedItem.caption_od)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedItem.caption_od}</p>
              </div>
            )}

            {selectedItem.nano_prompt && (
              <div style={{ background: '#7c3aed10', border: '1px solid #7c3aed30', padding: 14, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#a78bfa' }}>Image Prompt</span>
                  <button onClick={() => copy(selectedItem.nano_prompt)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{selectedItem.nano_prompt}</p>
              </div>
            )}

            {selectedItem.reel_script && (
              <div style={{ background: C.bg, padding: 14, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Reel Script</span>
                  <button onClick={() => copy(selectedItem.reel_script)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
                </div>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedItem.reel_script}</p>
              </div>
            )}

            {selectedItem.hashtags && selectedItem.hashtags.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Hashtags</span>
                  <button onClick={() => copy(selectedItem.hashtags.map((h: string) => '#' + h).join(' '))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy All</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedItem.hashtags.map((h: string, i: number) => (
                    <span key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: C.bg, color: C.dim }}>#{h}</span>
                  ))}
                </div>
              </div>
            )}

            {selectedItem.actual_reach && (
              <div style={{ background: C.bg, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>Actual Performance</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {[['Reach', selectedItem.actual_reach], ['Likes', selectedItem.actual_likes], ['Comments', selectedItem.actual_comments], ['Saves', selectedItem.actual_saves]].map(([l, v]) => (
                    <div key={l as string} style={{ textAlign: 'center' }}>
                      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{v || 0}</p>
                      <p style={{ fontSize: 10, color: C.dim }}>{l}</p>
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

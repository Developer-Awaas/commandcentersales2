import { useState, useEffect } from 'react';
import { Library, Search, Trash2, Calendar, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { listToolOutputs, deleteToolOutput, type ToolOutput } from '../lib/history-service';
import { SingleStageView, formatDate } from '../components/history/JourneyViews';
import { useNavigation } from '../contexts/NavigationContext';
import { useToast } from '../contexts/ToastContext';

const C = {
  bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7', accent: '#2563EB',
  text: '#18181B', dim: '#71717A', red: '#ef4444', yellow: '#eab308',
  green: '#22c55e', blue: '#3b82f6', purple: '#8b5cf6', pink: '#ec4899'
};

// Source filter — the prominent, primary Content Library filter (CC-P5 Step 2).
type Source = 'all' | 'planner' | 'creatives' | 'calendar';
const SOURCE_TABS: { value: Source; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'planner', label: 'Planner' },
  { value: 'creatives', label: 'Creatives' },
  { value: 'calendar', label: 'Calendar' },
];
const SOURCE_STYLE: Record<Exclude<Source, 'all'>, { color: string; label: string }> = {
  planner: { color: C.blue, label: 'Planner' },
  creatives: { color: C.purple, label: 'Creatives' },
  calendar: { color: C.green, label: 'Calendar' },
};

const STATUS_LABELS: Record<string, { color: string; label: string }> = {
  planned: { color: C.yellow, label: 'Planned' },
  created: { color: C.blue, label: 'Created' },
  posted: { color: C.green, label: 'Posted' },
  skipped: { color: C.dim, label: 'Skipped' },
};

interface UnifiedItem {
  key: string;
  source: 'planner' | 'creatives' | 'calendar';
  sortDate: number;          // epoch ms for ordering
  dateLabel: string;
  title: string;
  subtitle: string;
  thumbnailUrl?: string;
  status?: string;
  toolOutput?: ToolOutput;   // planner/creatives expansion (P3 renderer)
  calRow?: any;              // calendar expansion
}

function publicUrl(bucket: string, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export default function ContentLibrary() {
  const { showToast } = useToast();
  const { navigate } = useNavigation();
  const [items, setItems] = useState<UnifiedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<Source>('all'); // default: overall plan view
  const [selected, setSelected] = useState<UnifiedItem | null>(null);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    const orgId = getOrgId();
    const out: UnifiedItem[] = [];

    // 1. tool_outputs (domain='social') — the durable Planner/Creatives history.
    try {
      const outputs = await listToolOutputs(orgId, 'social', undefined, 100);
      for (const o of outputs) {
        if (o.tool === 'smm_planner') {
          const p = o.payload as Record<string, any>;
          out.push({
            key: `to-${o.id}`, source: 'planner', sortDate: new Date(o.created_at).getTime(),
            dateLabel: formatDate(o.created_at),
            title: p.plan_type ? `${p.plan_type} plan` : 'SMM Plan',
            subtitle: [p.goal, p.duration, p.post_count != null ? `${p.post_count} posts` : null].filter(Boolean).join(' · '),
            toolOutput: o,
          });
        } else if (o.tool === 'smm_creatives') {
          const p = o.payload as Record<string, any>;
          const ref = (o.asset_refs && o.asset_refs[0]) || null;
          out.push({
            key: `to-${o.id}`, source: 'creatives', sortDate: new Date(o.created_at).getTime(),
            dateLabel: formatDate(o.created_at),
            title: p.creative?.concept || p.creative_type || 'Creative',
            subtitle: p.creative?.captionEn ? String(p.creative.captionEn).slice(0, 120) : (p.creative_type || ''),
            thumbnailUrl: ref ? publicUrl(ref.bucket, ref.path) : undefined,
            toolOutput: o,
          });
        }
        // smm_analysis intentionally excluded — it's a Monitor artifact, shown in History.
      }
    } catch (e) {
      console.error('[ContentLibrary] tool_outputs fetch failed:', e);
    }

    // 2. smm_calendar (org-scoped) — the operational calendar view.
    const { data: cal } = await supabase.from('smm_calendar')
      .select('*').eq('org_id', orgId).order('post_date', { ascending: false }).limit(100);
    for (const row of cal || []) {
      out.push({
        key: `cal-${row.id}`, source: 'calendar', sortDate: new Date(row.post_date).getTime(),
        dateLabel: row.post_date, title: row.topic || 'Untitled',
        subtitle: row.caption_en || '', status: row.status, calRow: row,
      });
    }

    out.sort((a, b) => b.sortDate - a.sortDate);
    setItems(out);
    setLoading(false);
  };

  const counts = {
    all: items.length,
    planner: items.filter(i => i.source === 'planner').length,
    creatives: items.filter(i => i.source === 'creatives').length,
    calendar: items.filter(i => i.source === 'calendar').length,
  };

  const filtered = items.filter(i => {
    if (source !== 'all' && i.source !== source) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const removeItem = async (item: UnifiedItem) => {
    try {
      if (item.toolOutput) {
        await deleteToolOutput(item.toolOutput.id);
      } else if (item.calRow) {
        await supabase.from('smm_calendar').delete().eq('id', item.calRow.id);
      }
      setItems(prev => prev.filter(i => i.key !== item.key));
      setSelected(null);
      showToast('Item deleted', 'info');
    } catch (e) {
      console.error('[ContentLibrary] delete failed:', e);
      showToast('Failed to delete', 'error');
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    showToast('Copied!', 'success');
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>Content Library</h1>
        <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>Your saved plans, creatives, and scheduled calendar posts in one place</p>
      </div>

      {/* Prominent source filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {SOURCE_TABS.map(tab => {
          const active = source === tab.value;
          return (
            <button key={tab.value} onClick={() => setSource(tab.value)} style={{
              padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: active ? C.accent : C.card, color: active ? '#fff' : C.text,
              border: '1px solid ' + (active ? C.accent : C.border),
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {tab.label}
              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: active ? 'rgba(255,255,255,0.25)' : C.bg, color: active ? '#fff' : C.dim }}>
                {counts[tab.value]}
              </span>
            </button>
          );
        })}
        <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.dim }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title or caption..."
            style={{ width: '100%', padding: '9px 10px 9px 34px', borderRadius: 999, background: C.card, color: C.text, border: '1px solid ' + C.border, fontSize: 13, outline: 'none' }}
          />
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: C.dim }}>
          <Library size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
          <p style={{ fontSize: 14 }}>{search || source !== 'all' ? 'Nothing matches this filter.' : 'No content saved yet.'}</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>Generate content from SMM Planner or SMM Creatives to build your library.</p>
        </div>
      )}

      {/* Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {filtered.map(item => {
          const badge = SOURCE_STYLE[item.source];
          const statusInfo = item.status ? STATUS_LABELS[item.status] : null;
          return (
            <div key={item.key} onClick={() => setSelected(item)} style={{
              background: C.card, border: '1px solid ' + C.border, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
            }}
            onMouseOver={e => (e.currentTarget.style.borderColor = C.accent)}
            onMouseOut={e => (e.currentTarget.style.borderColor = C.border)}
            >
              {item.thumbnailUrl && (
                <img src={item.thumbnailUrl} alt={item.title} style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block', borderBottom: '1px solid ' + C.border }} />
              )}
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: badge.color + '20', color: badge.color }}>{badge.label}</span>
                    {statusInfo && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: statusInfo.color + '20', color: statusInfo.color }}>{statusInfo.label}</span>}
                  </div>
                  <span style={{ fontSize: 10, color: C.dim }}>{item.dateLabel}</span>
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</p>
                <p style={{ fontSize: 12, color: C.dim, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{item.subtitle || '—'}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail modal */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 24, maxWidth: 650, width: '90%', maxHeight: '85vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: SOURCE_STYLE[selected.source].color + '20', color: SOURCE_STYLE[selected.source].color }}>{SOURCE_STYLE[selected.source].label}</span>
                <span style={{ fontSize: 11, color: C.dim }}><Calendar size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{selected.dateLabel}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {selected.source === 'calendar' && (
                  <button onClick={() => { setSelected(null); navigate('smm-calendar'); }} style={{ padding: '6px 10px', borderRadius: 6, background: C.accent + '15', color: C.accent, border: 'none', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ExternalLink size={12} /> Open in Calendar
                  </button>
                )}
                <button onClick={() => removeItem(selected)} style={{ padding: '6px 10px', borderRadius: 6, background: C.red + '15', color: C.red, border: 'none', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Trash2 size={12} /> Delete
                </button>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, fontSize: 18 }}>✕</button>
              </div>
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 12 }}>{selected.title}</h3>

            {selected.thumbnailUrl && (
              <img src={selected.thumbnailUrl} alt={selected.title} style={{ width: '100%', maxWidth: 360, borderRadius: 10, border: '1px solid ' + C.border, marginBottom: 12, display: 'block' }} />
            )}

            {/* Planner / Creatives → reuse the P3 single-stage renderer */}
            {selected.toolOutput && <SingleStageView output={selected.toolOutput} />}

            {/* Calendar → the operational post detail */}
            {selected.calRow && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
                {selected.calRow.caption_en && (
                  <DetailBlock label="Caption (English)" onCopy={() => copy(selected.calRow.caption_en)}>
                    <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selected.calRow.caption_en}</p>
                  </DetailBlock>
                )}
                {selected.calRow.nano_prompt && (
                  <DetailBlock label="Image Prompt" onCopy={() => copy(selected.calRow.nano_prompt)}>
                    <p style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{selected.calRow.nano_prompt}</p>
                  </DetailBlock>
                )}
                {selected.calRow.reel_script && (
                  <DetailBlock label="Reel Script" onCopy={() => copy(selected.calRow.reel_script)}>
                    <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selected.calRow.reel_script}</p>
                  </DetailBlock>
                )}
                {Array.isArray(selected.calRow.hashtags) && selected.calRow.hashtags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {selected.calRow.hashtags.map((h: string, i: number) => (
                      <span key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: C.bg, color: C.dim }}>#{h}</span>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: 11, color: C.dim }}>{selected.calRow.platform} · {selected.calRow.post_time || 'no time'} · {selected.calRow.post_type}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, onCopy, children }: { label: string; onCopy: () => void; children: React.ReactNode }) {
  return (
    <div style={{ background: C.bg, padding: 12, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: C.dim }}>{label}</span>
        <button onClick={onCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.accent }}>Copy</button>
      </div>
      {children}
    </div>
  );
}

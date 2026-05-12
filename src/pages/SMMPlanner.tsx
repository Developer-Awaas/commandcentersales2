import { useState, useEffect } from 'react';
import { Calendar, ChevronRight, ChevronLeft, Upload, X, Plus, Check, RefreshCw, Download, Sparkles, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { aiCall, aiVision, isAiEnabled } from '../lib/ai-service';
import { buildSMMPlannerPrompt, buildScreenshotExtractionPrompt, SCREENSHOT_GUIDES } from '../lib/smm-prompts';
import { generateSMMPlanPDF } from '../lib/pdf-generator';
import { useToast } from '../contexts/ToastContext';
import {
  toIsoDate, toIsoTime, prettifyTime, dayFromIso,
  normalizePlatform, normalizePostType,
  prettifyPlatform, prettifyType,
  PLATFORM_OPTIONS, POST_TYPE_OPTIONS,
  type PendingPost,
} from '../lib/smm-helpers';

// Shared UI - adjust imports to match your project's component paths
// import { Card } from '../components/ui/Card';
// import { Button } from '../components/ui/Button';
// import { Input } from '../components/ui/Input';
// import { Select } from '../components/ui/Select';
// import { Textarea } from '../components/ui/Textarea';

function pendingPostFromAi(post: any): PendingPost | null {
  const iso = toIsoDate(post.date);
  if (!iso) {
    console.warn(`[SMM] Skipping post — unparseable date "${post.date}", topic: "${post.topic ?? '(untitled)'}"`);
    return null;
  }
  return {
    _id: crypto.randomUUID(),
    date: iso,
    day: dayFromIso(iso),
    platform: normalizePlatform(post.platform),
    type: normalizePostType(post.type),
    category: post.category,
    topic: String(post.topic ?? ''),
    time: toIsoTime(post.time),
    captionEn: post.captionEn,
    captionOd: post.captionOd,
    hashtags: post.hashtags || [],
    nanoPrompt: post.nanoPrompt,
    reelScript: post.reelScript,
  };
}

const TYPES = ['Company Branding', 'Project Branding', 'Holiday/Event Posts', 'Goal-based Campaign'];
const GOALS = ['Awareness', 'Engagement', 'Followers Growth', 'Website Traffic', 'Lead Support'];
const DURATIONS = ['1 week', '2 weeks', '1 month', '2 months', '3 months', 'Custom'];

export default function SMMPlanner() {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [warning, setWarning] = useState('');
  const [pendingPosts, setPendingPosts] = useState<PendingPost[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<PendingPost | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Step 1: What do you want?
  const [description, setDescription] = useState('');
  const [planType, setPlanType] = useState('Company Branding');
  const [goal, setGoal] = useState('Awareness');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [duration, setDuration] = useState('1 month');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');

  // Step 2: Events
  const [customEvents, setCustomEvents] = useState<{name:string;date:string}[]>([]);
  const [newEventName, setNewEventName] = useState('');
  const [newEventDate, setNewEventDate] = useState('');

  // Step 3: Metrics
  const [metrics, setMetrics] = useState({
    ig_followers: '', ig_avg_likes: '', ig_avg_reach: '', ig_avg_saves: '',
    ig_engagement_rate: '', ig_best_day: '', ig_best_time: '',
    fb_page_likes: '', fb_avg_reach: '', fb_avg_engagement: ''
  });
  const [ssLoading, setSSLoading] = useState(false);

  useEffect(() => {
    fetchProjects();
    fetchHolidays();
  }, []);

  const fetchProjects = async () => {
    const { data } = await supabase.from('projects').select('*').eq('is_active', true).eq('org_id', getOrgId());
    setProjects(data || []);
  };

  const fetchHolidays = async () => {
    const { data } = await supabase.from('events_calendar').select('*').eq('org_id', getOrgId()).order('date');
    setHolidays(data || []);
  };

  const toggleProject = (name: string) => {
    setSelectedProjects(prev => prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]);
  };

  const toggleHoliday = async (id: string, current: boolean) => {
    await supabase.from('events_calendar').update({ include_in_plan: !current }).eq('id', id);
    fetchHolidays();
  };

  const addCustomEvent = () => {
    if (newEventName && newEventDate) {
      setCustomEvents(prev => [...prev, { name: newEventName, date: newEventDate }]);
      setNewEventName('');
      setNewEventDate('');
    }
  };

  const handleScreenshot = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file || !isAiEnabled()) {
      showToast('Add Claude API key in Settings to use screenshot reading', 'info');
      return;
    }
    setSSLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1];
        const mimeType = file.type || 'image/png';
        const prompt = buildScreenshotExtractionPrompt(type);
        const res = await aiVision([
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: prompt }
        ], 'Extract social media metrics from this screenshot. Return ONLY valid JSON.');

        if (res && !res.error && res.extracted) {
          const ext = res.extracted;
          setMetrics(prev => ({
            ...prev,
            ig_followers: ext.followers?.toString() || prev.ig_followers,
            ig_avg_likes: ext.avg_likes?.toString() || prev.ig_avg_likes,
            ig_avg_reach: ext.avg_reach?.toString() || prev.ig_avg_reach,
            ig_avg_saves: ext.avg_saves?.toString() || prev.ig_avg_saves,
            ig_engagement_rate: ext.engagement_rate?.toString() || prev.ig_engagement_rate,
            ig_best_day: ext.best_days?.[0] || prev.ig_best_day,
            ig_best_time: ext.best_times?.[0] || prev.ig_best_time,
          }));
          showToast('Metrics extracted from screenshot!', 'success');
          if (res.missingFields?.length > 0) {
            showToast('Some fields could not be read: ' + res.missingFields.join(', '), 'info');
          }
        } else {
          showToast('Could not read screenshot. Enter metrics manually.', 'error');
        }
        setSSLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      showToast('Screenshot processing failed', 'error');
      setSSLoading(false);
    }
  };

  const generatePlan = async () => {
    if (!isAiEnabled()) {
      showToast('Add Claude API key in Settings to enable AI', 'info');
      return;
    }
    setLoading(true);
    try {
      const selProjects = projects.filter(p => selectedProjects.includes(p.name || p['Project Name']));
      const includedHolidays = holidays.filter(h => h.include_in_plan).map(h => ({ name: h.name, date: h.date }));

      const prompt = buildSMMPlannerPrompt({
        description,
        type: planType,
        goal,
        projects: selProjects,
        duration,
        startDate,
        endDate: duration === 'Custom' ? endDate : undefined,
        holidays: includedHolidays,
        customEvents,
        metrics: {
          ig_followers: parseInt(metrics.ig_followers) || undefined,
          ig_avg_likes: parseInt(metrics.ig_avg_likes) || undefined,
          ig_avg_reach: parseInt(metrics.ig_avg_reach) || undefined,
          ig_avg_saves: parseInt(metrics.ig_avg_saves) || undefined,
          ig_engagement_rate: parseFloat(metrics.ig_engagement_rate) || undefined,
          ig_best_day: metrics.ig_best_day || undefined,
          ig_best_time: metrics.ig_best_time || undefined,
          fb_page_likes: parseInt(metrics.fb_page_likes) || undefined,
          fb_avg_reach: parseInt(metrics.fb_avg_reach) || undefined,
          fb_avg_engagement: parseInt(metrics.fb_avg_engagement) || undefined,
        },
      });

      const res = await aiCall(prompt, undefined, 16000);
      if (res && !res.error && !res.raw) {
        if (res._truncated) {
          setWarning('Plan was truncated but recovered. Some calendar entries may be missing — try again with a shorter duration.');
        }
        setResult(res);
        setStep(5);

        // Save to organic_plans
        await supabase.from('organic_plans').insert({
          org_id: getOrgId(),
          week_start: startDate,
          plan_data: res,
          pillars: res.pillars || [],
          status: 'draft',
        });

        if (res.calendar) {
          const pending = res.calendar
            .map((p: any) => pendingPostFromAi(p))
            .filter((p: PendingPost | null): p is PendingPost => p !== null);
          setPendingPosts(pending);
        }

        showToast('Plan generated. Review and save below.', 'success');
      } else {
        showToast('AI generation failed. Try again.', 'error');
        if (res?.raw) setResult({ raw: res.raw });
      }
    } catch (err) {
      showToast('Generation failed', 'error');
    }
    setLoading(false);
  };

  const handleDownloadPDF = () => {
    if (!result || result.raw) return;
    const calendarForPdf = pendingPosts.length > 0
      ? pendingPosts.map(p => ({
          date: p.date,
          day: p.day,
          platform: prettifyPlatform(p.platform),
          type: prettifyType(p.type),
          topic: p.topic,
          time: prettifyTime(p.time || ''),
          captionEn: p.captionEn,
          captionOd: p.captionOd,
          hashtags: p.hashtags,
          nanoPrompt: p.nanoPrompt,
          reelScript: p.reelScript,
        }))
      : (result.calendar || []);
    generateSMMPlanPDF({
      overview: result.overview || '',
      contentMix: result.contentMix || {},
      pillars: result.pillars || [],
      calendar: calendarForPdf,
      kpiTargets: result.kpiTargets || {},
      duration,
    });
  };

  const startEdit = (i: number) => {
    setDeleteConfirmId(null);
    setEditDraft({ ...pendingPosts[i] });
    setEditingIndex(i);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditDraft(null);
  };

  const applyEdit = () => {
    if (editingIndex === null || !editDraft) return;
    const updated: PendingPost = {
      ...editDraft,
      day: dayFromIso(editDraft.date),
      _edited: true,
    };
    setPendingPosts(prev => prev.map((p, idx) => (idx === editingIndex ? updated : p)));
    setEditingIndex(null);
    setEditDraft(null);
  };

  const updateDraft = <K extends keyof PendingPost>(field: K, value: PendingPost[K]) => {
    setEditDraft(prev => (prev ? { ...prev, [field]: value } : prev));
  };

  const requestDelete = (id: string) => {
    setEditingIndex(null);
    setEditDraft(null);
    setDeleteConfirmId(id);
  };

  const confirmDelete = () => {
    if (!deleteConfirmId) return;
    setPendingPosts(prev => prev.filter(p => p._id !== deleteConfirmId));
    setDeleteConfirmId(null);
  };

  const cancelDelete = () => setDeleteConfirmId(null);

  const savePosts = async () => {
    if (pendingPosts.length === 0) return;
    setSaving(true);
    try {
      const entries = pendingPosts.map(p => ({
        org_id: getOrgId(),
        post_date: p.date,
        post_time: p.time || null,
        platform: normalizePlatform(p.platform),
        post_type: normalizePostType(p.type),
        category: p.category || null,
        topic: p.topic,
        caption_en: p.captionEn || null,
        caption_od: p.captionOd || null,
        hashtags: p.hashtags || [],
        nano_prompt: p.nanoPrompt || null,
        reel_script: p.reelScript || null,
        status: 'planned',
      }));
      const { error } = await supabase.from('smm_calendar').insert(entries);
      if (error) {
        console.error('[SMM] Save failed:', error);
        showToast('Failed to save posts. Try again.', 'error');
        setSaving(false);
        return;
      }
      setSaved(true);
      showToast(`Saved ${entries.length} post${entries.length === 1 ? '' : 's'} to calendar`, 'success');
    } catch (err) {
      console.error('[SMM] Save error:', err);
      showToast('Failed to save posts. Try again.', 'error');
    }
    setSaving(false);
  };

  // Copy helper
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    showToast('Copied!', 'success');
  };

  const C = {
    bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7', accent: '#2563EB',
    text: '#18181B', dim: '#71717A', red: '#ef4444', yellow: '#eab308',
    green: '#22c55e', blue: '#3b82f6', purple: '#8b5cf6'
  };

  const stepTitles = ['What do you want?', 'Holidays & Events', 'Social Media Metrics', 'Generate Plan', 'Review Plan'];

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>SMM Planner</h1>
          <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>Plan your social media content strategy step by step</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {stepTitles.map((title, i) => (
          <div key={i} style={{ flex: 1 }}>
            <div style={{
              height: 4, borderRadius: 2,
              background: i + 1 <= step ? C.accent : C.border,
              transition: 'background 0.3s'
            }} />
            <p style={{ fontSize: 10, color: i + 1 <= step ? C.accent : C.dim, marginTop: 4, textAlign: 'center' }}>
              {i + 1}. {title}
            </p>
          </div>
        ))}
      </div>

      {/* STEP 1: What do you want? */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>Describe your content needs</h3>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g., Monthly branding plan for Neelachala Homes focusing on trust-building, Zenith project awareness, and festive season engagement"
              rows={3}
              style={{ width: '100%', padding: 12, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13, resize: 'none', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
              <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6 }}>Content Type</label>
              <select value={planType} onChange={e => setPlanType(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6, marginTop: 12 }}>Goal</label>
              <select value={goal} onChange={e => setGoal(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}>
                {GOALS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
              <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6 }}>Duration</label>
              <select value={duration} onChange={e => setDuration(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}>
                {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6, marginTop: 12 }}>Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }} />
              {duration === 'Custom' && (
                <>
                  <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6, marginTop: 12 }}>End Date</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }} />
                </>
              )}
            </div>
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>Projects to feature</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {projects.map(p => {
                const name = p.name || p['Project Name'];
                const selected = selectedProjects.includes(name);
                return (
                  <button key={name} onClick={() => toggleProject(name)} style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                    background: selected ? C.accent + '20' : C.bg,
                    color: selected ? C.accent : C.dim,
                    border: '1px solid ' + (selected ? C.accent : C.border),
                  }}>
                    {selected && <Check size={12} style={{ marginRight: 4 }} />}{name}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={() => setStep(2)} disabled={!description} style={{
            width: '100%', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            background: description ? C.accent : C.border, color: description ? C.bg : C.dim, border: 'none',
          }}>
            Next → Holidays & Events <ChevronRight size={16} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
          </button>
        </div>
      )}

      {/* STEP 2: Holidays & Events */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>Upcoming Holidays & Festivals</h3>
            <p style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>Check the ones to include in your content plan</p>
            {holidays.length === 0 && <p style={{ fontSize: 13, color: C.dim }}>No holidays loaded. Add them in Settings.</p>}
            {holidays.map(h => (
              <div key={h.id} onClick={() => toggleHoliday(h.id, h.include_in_plan)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                background: h.include_in_plan ? C.accent + '10' : C.bg, border: '1px solid ' + (h.include_in_plan ? C.accent + '40' : C.border),
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 4, border: '2px solid ' + (h.include_in_plan ? C.accent : C.border),
                  background: h.include_in_plan ? C.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {h.include_in_plan && <Check size={12} color={C.bg} />}
                </div>
                <span style={{ fontSize: 13, color: C.text, flex: 1 }}>{h.name}</span>
                <span style={{ fontSize: 12, color: C.dim }}>{h.date}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: C.bg, color: C.dim }}>{h.type}</span>
              </div>
            ))}
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>Custom Events</h3>
            {customEvents.map((ev, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: C.text, flex: 1 }}>{ev.name}</span>
                <span style={{ fontSize: 12, color: C.dim }}>{ev.date}</span>
                <button onClick={() => setCustomEvents(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <X size={14} style={{ color: C.dim }} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={newEventName} onChange={e => setNewEventName(e.target.value)} placeholder="Event name" style={{ flex: 1, padding: 8, borderRadius: 6, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }} />
              <input type="date" value={newEventDate} onChange={e => setNewEventDate(e.target.value)} style={{ padding: 8, borderRadius: 6, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }} />
              <button onClick={addCustomEvent} style={{ padding: '8px 12px', borderRadius: 6, background: C.accent, color: C.bg, border: 'none', cursor: 'pointer', fontSize: 12 }}>
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => setStep(1)} style={{ flex: 1, padding: 12, borderRadius: 8, fontSize: 13, cursor: 'pointer', background: 'transparent', color: C.dim, border: '1px solid ' + C.border }}>
              <ChevronLeft size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Back
            </button>
            <button onClick={() => setStep(3)} style={{ flex: 2, padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', background: C.accent, color: C.bg, border: 'none' }}>
              Next → Social Media Metrics <ChevronRight size={16} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Metrics */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>Instagram Metrics</h3>
                <p style={{ fontSize: 12, color: C.dim, margin: '4px 0 0' }}>Enter manually or upload screenshot</p>
              </div>
              <label style={{ padding: '6px 12px', borderRadius: 6, background: C.bg, border: '1px solid ' + C.border, cursor: 'pointer', fontSize: 12, color: C.dim, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Upload size={14} /> Upload Screenshot
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleScreenshot(e, 'instagram_reach')} />
              </label>
            </div>
            {ssLoading && <p style={{ fontSize: 12, color: C.accent }}>Reading screenshot...</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              {[
                ['Followers', 'ig_followers'], ['Avg Likes/Post', 'ig_avg_likes'],
                ['Avg Reach/Post', 'ig_avg_reach'], ['Avg Saves/Post', 'ig_avg_saves'],
                ['Engagement Rate %', 'ig_engagement_rate'], ['Best Day', 'ig_best_day'],
                ['Best Time', 'ig_best_time'],
              ].map(([label, key]) => (
                <div key={key}>
                  <label style={{ fontSize: 11, color: C.dim, display: 'block', marginBottom: 4 }}>{label}</label>
                  <input
                    value={(metrics as any)[key]}
                    onChange={e => setMetrics(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={key.includes('day') ? 'e.g., Thursday' : key.includes('time') ? 'e.g., 12:30 PM' : '0'}
                    style={{ width: '100%', padding: 8, borderRadius: 6, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>Facebook Metrics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {[
                ['Page Likes', 'fb_page_likes'], ['Avg Reach/Post', 'fb_avg_reach'], ['Avg Engagement', 'fb_avg_engagement'],
              ].map(([label, key]) => (
                <div key={key}>
                  <label style={{ fontSize: 11, color: C.dim, display: 'block', marginBottom: 4 }}>{label}</label>
                  <input
                    value={(metrics as any)[key]}
                    onChange={e => setMetrics(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder="0"
                    style={{ width: '100%', padding: 8, borderRadius: 6, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => setStep(2)} style={{ flex: 1, padding: 12, borderRadius: 8, fontSize: 13, cursor: 'pointer', background: 'transparent', color: C.dim, border: '1px solid ' + C.border }}>
              <ChevronLeft size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Back
            </button>
            <button onClick={() => { setStep(4); generatePlan(); }} disabled={loading} style={{
              flex: 2, padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              background: C.accent, color: C.bg, border: 'none', opacity: loading ? 0.5 : 1,
            }}>
              {loading ? <><RefreshCw size={14} className="animate-spin" style={{ marginRight: 4 }} /> Generating Plan...</> : <><Sparkles size={14} style={{ marginRight: 4 }} /> Generate Plan</>}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Loading */}
      {step === 4 && loading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <RefreshCw size={32} className="animate-spin" style={{ color: C.accent, marginBottom: 16 }} />
          <p style={{ fontSize: 16, color: C.text }}>Generating your content plan...</p>
          <p style={{ fontSize: 13, color: C.dim, marginTop: 8 }}>Analyzing your metrics, holidays, and goals</p>
        </div>
      )}

      {/* STEP 5: Results */}
      {step === 5 && result && !result.raw && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Your Content Plan</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStep(1)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'transparent', color: C.dim, border: '1px solid ' + C.border }}>
                Start Over
              </button>
              <button onClick={handleDownloadPDF} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: C.accent, color: C.bg, border: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Download size={14} /> Download PDF
              </button>
            </div>
          </div>

          {/* Truncation warning */}
          {warning && (
            <div style={{ background: C.yellow + '15', border: '1px solid ' + C.yellow + '40', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.yellow }}>
              {warning}
            </div>
          )}

          {/* Overview */}
          {result.overview && (
            <div style={{ background: C.green + '10', border: '1px solid ' + C.green + '30', borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 14, color: C.green }}>{result.overview}</p>
            </div>
          )}

          {/* Content Mix */}
          {result.contentMix && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
              {Object.entries(result.contentMix).map(([type, count]) => (
                <div key={type} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16, textAlign: 'center' }}>
                  <p style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{count as number}</p>
                  <p style={{ fontSize: 11, color: C.dim, textTransform: 'capitalize' }}>{type.replace(/([A-Z])/g, ' $1')}</p>
                </div>
              ))}
            </div>
          )}

          {/* Posting Times */}
          {result.bestPostingTimes && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Best Posting Times</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <p style={{ fontSize: 12, color: C.dim, marginBottom: 4 }}>Instagram</p>
                  <p style={{ fontSize: 13, color: C.text }}>Days: {result.bestPostingTimes.instagram?.bestDays?.join(', ')}</p>
                  <p style={{ fontSize: 13, color: C.text }}>Times: {result.bestPostingTimes.instagram?.bestTimes?.join(', ')}</p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: C.dim, marginBottom: 4 }}>Facebook</p>
                  <p style={{ fontSize: 13, color: C.text }}>Days: {result.bestPostingTimes.facebook?.bestDays?.join(', ')}</p>
                  <p style={{ fontSize: 13, color: C.text }}>Times: {result.bestPostingTimes.facebook?.bestTimes?.join(', ')}</p>
                </div>
              </div>
            </div>
          )}

          {/* Calendar entries — editable */}
          {pendingPosts.length > 0 && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
                Content Calendar ({pendingPosts.length} {pendingPosts.length === 1 ? 'post' : 'posts'})
              </h3>
              {pendingPosts.map((post, i) => {
                const typeColors: Record<string, string> = { reel: C.blue, carousel: C.green, static: C.dim, story: C.yellow, video: C.purple };
                const isEditing = editingIndex === i;
                const isDeleting = deleteConfirmId === post._id;
                const isLast = i === pendingPosts.length - 1;

                if (isEditing && editDraft) {
                  return (
                    <div key={post._id} style={{ padding: '16px 0', borderBottom: isLast ? 'none' : '1px solid ' + C.border }}>
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-4 gap-2">
                          <div>
                            <label className="text-xs text-text-tertiary">Date</label>
                            <input type="date" value={editDraft.date}
                              onChange={(e) => updateDraft('date', e.target.value)}
                              className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                          </div>
                          <div>
                            <label className="text-xs text-text-tertiary">Time</label>
                            <input type="time" value={editDraft.time || ''}
                              onChange={(e) => updateDraft('time', e.target.value)}
                              className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                          </div>
                          <div>
                            <label className="text-xs text-text-tertiary">Platform</label>
                            <select value={editDraft.platform}
                              onChange={(e) => updateDraft('platform', e.target.value)}
                              className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface">
                              {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-text-tertiary">Type</label>
                            <select value={editDraft.type}
                              onChange={(e) => updateDraft('type', e.target.value)}
                              className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface">
                              {POST_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-text-tertiary">Topic</label>
                          <input type="text" value={editDraft.topic}
                            onChange={(e) => updateDraft('topic', e.target.value)}
                            className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                        </div>
                        <div>
                          <label className="text-xs text-text-tertiary">Category</label>
                          <input type="text" value={editDraft.category || ''}
                            onChange={(e) => updateDraft('category', e.target.value)}
                            className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                        </div>
                        <div>
                          <label className="text-xs text-text-tertiary">Caption (English)</label>
                          <textarea value={editDraft.captionEn || ''}
                            onChange={(e) => updateDraft('captionEn', e.target.value)}
                            rows={4}
                            className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                        </div>
                        <div>
                          <label className="text-xs text-text-tertiary">Caption (Odia)</label>
                          <textarea value={editDraft.captionOd || ''}
                            onChange={(e) => updateDraft('captionOd', e.target.value)}
                            rows={4}
                            className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                        </div>
                        <div>
                          <label className="text-xs text-text-tertiary">Hashtags (comma-separated)</label>
                          <input type="text" value={(editDraft.hashtags || []).join(', ')}
                            onChange={(e) => updateDraft('hashtags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                            className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                        </div>
                        <div>
                          <label className="text-xs text-text-tertiary">Image Prompt</label>
                          <textarea value={editDraft.nanoPrompt || ''}
                            onChange={(e) => updateDraft('nanoPrompt', e.target.value)}
                            rows={3}
                            className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                        </div>
                        {(editDraft.type === 'reel' || editDraft.type === 'video') && (
                          <div>
                            <label className="text-xs text-text-tertiary">Reel Script</label>
                            <textarea value={editDraft.reelScript || ''}
                              onChange={(e) => updateDraft('reelScript', e.target.value)}
                              rows={3}
                              className="w-full mt-1 px-2 py-1.5 rounded border border-border text-sm bg-surface" />
                          </div>
                        )}
                        <div className="flex gap-2 justify-end mt-2">
                          <button onClick={cancelEdit}
                            className="px-4 py-1.5 rounded-lg border border-border text-sm text-text-tertiary hover:text-text-primary transition-colors">
                            Cancel
                          </button>
                          <button onClick={applyEdit}
                            className="px-4 py-1.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors">
                            Save Changes
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={post._id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: isLast ? 'none' : '1px solid ' + C.border }}>
                    <div style={{ width: 70, flexShrink: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{post.date.split('-').slice(1).join('/')}</p>
                      <p style={{ fontSize: 11, color: C.dim }}>{post.day}</p>
                    </div>
                    <div style={{ width: 90, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: (typeColors[post.type] || C.dim) + '20', color: typeColors[post.type] || C.dim }}>
                        {prettifyType(post.type)}
                      </span>
                      {post._edited && (
                        <span style={{ display: 'block', marginTop: 4, fontSize: 10, color: '#92400E' }}>● Edited</span>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{post.topic}</p>
                      {post.captionEn && (
                        <div style={{ background: C.bg, padding: 10, borderRadius: 8, marginBottom: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: C.dim }}>Caption</span>
                            <button onClick={() => copy(post.captionEn || '')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                              <span style={{ fontSize: 11, color: C.dim }}>Copy</span>
                            </button>
                          </div>
                          <p style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{post.captionEn}</p>
                        </div>
                      )}
                      {post.nanoPrompt && (
                        <div style={{ background: '#7c3aed10', border: '1px solid #7c3aed30', padding: 10, borderRadius: 8, marginBottom: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: '#a78bfa' }}>Image Prompt</span>
                            <button onClick={() => copy(post.nanoPrompt || '')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                              <span style={{ fontSize: 11, color: C.dim }}>Copy</span>
                            </button>
                          </div>
                          <p style={{ fontSize: 11, color: C.text, lineHeight: 1.4 }}>{post.nanoPrompt}</p>
                        </div>
                      )}
                      {post.hashtags && post.hashtags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {post.hashtags.map((h: string, j: number) => (
                            <span key={j} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: C.bg, color: C.dim }}>#{h}</span>
                          ))}
                        </div>
                      )}
                      {isDeleting && (
                        <div className="mt-3 p-3 rounded-lg border border-warning-border bg-warning-subtle flex items-center gap-2">
                          <p className="text-sm text-warning-text flex-1">Delete this post?</p>
                          <button onClick={confirmDelete}
                            className="px-3 py-1 rounded bg-warning text-white text-xs font-medium hover:opacity-90 transition-colors">
                            Yes, delete
                          </button>
                          <button onClick={cancelDelete}
                            className="px-3 py-1 rounded border border-border text-xs text-text-tertiary hover:text-text-primary transition-colors">
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    <div style={{ width: 100, flexShrink: 0, textAlign: 'right' }}>
                      <p style={{ fontSize: 11, color: C.dim }}>{prettifyTime(post.time || '')}</p>
                      <p style={{ fontSize: 11, color: C.dim }}>{prettifyPlatform(post.platform)}</p>
                      {!saved && !isDeleting && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 8, justifyContent: 'flex-end' }}>
                          <button onClick={() => startEdit(i)}
                            title="Edit"
                            style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer' }}>
                            <Pencil size={14} style={{ color: C.accent }} />
                          </button>
                          <button onClick={() => requestDelete(post._id)}
                            title="Delete"
                            style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer' }}>
                            <Trash2 size={14} style={{ color: C.accent }} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Save to Calendar action bar */}
          {pendingPosts.length > 0 && !saved && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <p style={{ fontSize: 13, color: C.dim, flex: 1, minWidth: 200 }}>
                  Review your posts above. Edit or delete any you don't want, then save the rest to your SMM Calendar.
                </p>
                <button onClick={savePosts}
                  disabled={saving || editingIndex !== null || deleteConfirmId !== null}
                  className="px-5 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                  {saving && <RefreshCw size={14} className="animate-spin" />}
                  {saving
                    ? `Saving ${pendingPosts.length} ${pendingPosts.length === 1 ? 'post' : 'posts'}...`
                    : `Save ${pendingPosts.length} ${pendingPosts.length === 1 ? 'post' : 'posts'} to Calendar`}
                </button>
              </div>
            </div>
          )}

          {/* Post-save success state */}
          {saved && (
            <div style={{ background: C.green + '15', border: '1px solid ' + C.green + '40', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Check size={18} style={{ color: C.green }} />
              <p style={{ fontSize: 13, color: C.green, flex: 1 }}>
                Saved {pendingPosts.length} {pendingPosts.length === 1 ? 'post' : 'posts'} to the SMM Calendar.
              </p>
              <button onClick={() => { setStep(1); setResult(null); setPendingPosts([]); setSaved(false); }}
                style={{ padding: '6px 12px', borderRadius: 6, background: 'transparent', color: C.dim, border: '1px solid ' + C.border, cursor: 'pointer', fontSize: 12 }}>
                Start Over
              </button>
            </div>
          )}

          {/* KPI Targets */}
          {result.kpiTargets && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>KPI Targets</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {Object.entries(result.kpiTargets).map(([key, val]) => (
                  <div key={key} style={{ background: C.bg, borderRadius: 8, padding: 12, textAlign: 'center' }}>
                    <p style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{val as string}</p>
                    <p style={{ fontSize: 11, color: C.dim }}>{key.replace(/([A-Z])/g, ' $1')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Raw fallback */}
      {result?.raw && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20, marginTop: 16 }}>
          <p style={{ fontSize: 12, color: C.yellow, marginBottom: 8 }}>Plan generated but couldn't parse the output. Raw response below:</p>
          <pre style={{ fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>{result.raw}</pre>
          <button onClick={() => { setStep(3); setResult(null); }} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: C.accent, color: C.bg, border: 'none' }}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

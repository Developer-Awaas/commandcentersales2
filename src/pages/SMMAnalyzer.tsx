import { useState, useEffect } from 'react';
import { BarChart3, Upload, RefreshCw, Download, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { aiCall, aiVision, isAiEnabled } from '../lib/ai-service';
import { logAiSession } from '../lib/session-logger';
import { buildSMMAnalyzerPrompt, buildScreenshotExtractionPrompt, SCREENSHOT_GUIDES } from '../lib/smm-prompts';
import { generateSMMReportPDF } from '../lib/pdf-generator';
import { useToast } from '../contexts/ToastContext';

const C = {
  bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7', accent: '#2563EB',
  text: '#18181B', dim: '#71717A', red: '#ef4444', yellow: '#eab308',
  green: '#22c55e', blue: '#3b82f6'
};

const STATUS_COLORS: Record<string, string> = { green: C.green, yellow: C.yellow, red: C.red };

export default function SMMAnalyzer() {
  const { showToast } = useToast();
  const [platform, setPlatform] = useState('instagram');
  const [period, setPeriod] = useState('Last 7 days');
  const [loading, setLoading] = useState(false);
  const [ssLoading, setSSLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const [metrics, setMetrics] = useState({
    followers: '', posts_published: '', avg_reach: '', avg_likes: '',
    avg_comments: '', avg_saves: '', avg_shares: '', engagement_rate: '',
    profile_visits: '', website_clicks: '', follower_growth: ''
  });

  useEffect(() => { fetchHistory(); }, [platform]);

  const fetchHistory = async () => {
    const { data } = await supabase.from('smm_metrics')
      .select('*').eq('platform', platform).eq('org_id', getOrgId())
      .order('date', { ascending: false }).limit(30);
    setHistory(data || []);
  };

  const handleScreenshot = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file || !isAiEnabled()) { showToast('Add Claude API key in Settings', 'info'); return; }
    setSSLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1];
        const prompt = buildScreenshotExtractionPrompt(type);
        const res = await aiVision([
          { type: 'image', source: { type: 'base64', media_type: file.type || 'image/png', data: base64 } },
          { type: 'text', text: prompt }
        ], 'Extract social media metrics. Return ONLY valid JSON.');

        if (res?.extracted) {
          const ext = res.extracted;
          setMetrics(prev => ({
            followers: ext.followers?.toString() || prev.followers,
            posts_published: prev.posts_published,
            avg_reach: ext.avg_reach?.toString() || prev.avg_reach,
            avg_likes: ext.avg_likes?.toString() || prev.avg_likes,
            avg_comments: ext.avg_comments?.toString() || prev.avg_comments,
            avg_saves: ext.avg_saves?.toString() || prev.avg_saves,
            avg_shares: ext.avg_shares?.toString() || prev.avg_shares,
            engagement_rate: ext.engagement_rate?.toString() || prev.engagement_rate,
            profile_visits: ext.profile_visits?.toString() || prev.profile_visits,
            website_clicks: ext.website_clicks?.toString() || prev.website_clicks,
            follower_growth: ext.follower_growth?.toString() || prev.follower_growth,
          }));
          showToast('Metrics extracted! Verify and fill missing fields.', 'success');
          if (res.missingFields?.length) showToast('Missing: ' + res.missingFields.join(', '), 'info');
        } else {
          showToast('Could not read screenshot', 'error');
        }
        setSSLoading(false);
      };
      reader.readAsDataURL(file);
    } catch { setSSLoading(false); showToast('Screenshot failed', 'error'); }
  };

  const saveMetrics = async () => {
    const { error } = await supabase.from('smm_metrics').insert({
      org_id: getOrgId(),
      platform,
      date: new Date().toISOString().split('T')[0],
      followers: parseInt(metrics.followers) || 0,
      posts_published: parseInt(metrics.posts_published) || 0,
      avg_reach: parseFloat(metrics.avg_reach) || 0,
      avg_likes: parseFloat(metrics.avg_likes) || 0,
      avg_comments: parseFloat(metrics.avg_comments) || 0,
      avg_saves: parseFloat(metrics.avg_saves) || 0,
      avg_shares: parseFloat(metrics.avg_shares) || 0,
      engagement_rate: parseFloat(metrics.engagement_rate) || 0,
      profile_visits: parseInt(metrics.profile_visits) || 0,
      website_clicks: parseInt(metrics.website_clicks) || 0,
      follower_growth: parseInt(metrics.follower_growth) || 0,
      data_source: 'manual',
    });
    if (!error) {
      showToast('Metrics saved!', 'success');
      fetchHistory();
    } else {
      console.error('[saveMetrics] smm_metrics INSERT failed', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      showToast('Failed to save', 'error');
    }
  };

  const analyze = async () => {
    await saveMetrics();
    if (!isAiEnabled()) { showToast('Metrics saved. Add API key for AI analysis.', 'info'); return; }
    setLoading(true);
    try {
      const prompt = buildSMMAnalyzerPrompt({
        platform,
        period,
        metrics: {
          followers: parseInt(metrics.followers) || undefined,
          posts_published: parseInt(metrics.posts_published) || undefined,
          avg_reach: parseFloat(metrics.avg_reach) || undefined,
          avg_likes: parseFloat(metrics.avg_likes) || undefined,
          avg_comments: parseFloat(metrics.avg_comments) || undefined,
          avg_saves: parseFloat(metrics.avg_saves) || undefined,
          avg_shares: parseFloat(metrics.avg_shares) || undefined,
          engagement_rate: parseFloat(metrics.engagement_rate) || undefined,
          profile_visits: parseInt(metrics.profile_visits) || undefined,
          website_clicks: parseInt(metrics.website_clicks) || undefined,
          follower_growth: parseInt(metrics.follower_growth) || undefined,
        },
      });
      const res = await aiCall(prompt);
      if (res && !res.error && !res.raw) {
        setAnalysis(res);
        logAiSession(supabase, {
          sessionType: 'smm_analysis',
          inputSummary: platform + ' analysis: ' + period,
          inputData: metrics,
          outputData: res,
          healthScore: res.healthScore,
        });
        showToast('Analysis complete!', 'success');
      } else {
        showToast('Analysis failed', 'error');
        if (res?.raw) setAnalysis({ raw: res.raw });
      }
    } catch { showToast('Error', 'error'); }
    setLoading(false);
  };

  const downloadReport = () => {
    if (!analysis || analysis.raw) return;
    generateSMMReportPDF({ platform, period, analysis, metrics });
  };

  const scoreColor = (s: number) => s >= 7 ? C.green : s >= 4 ? C.yellow : C.red;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>SMM Analyzer</h1>
          <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>Analyze Instagram and Facebook performance</p>
        </div>
        {analysis && !analysis.raw && (
          <button onClick={downloadReport} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: C.accent, color: '#FFFFFF', border: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Download size={14} /> Download Report
          </button>
        )}
      </div>

      {/* Platform + Period */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
          <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6 }}>Platform</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['instagram', 'facebook'].map(p => (
              <button key={p} onClick={() => setPlatform(p)} style={{
                flex: 1, padding: 10, borderRadius: 8, cursor: 'pointer', textTransform: 'capitalize', fontSize: 13, fontWeight: 600,
                background: platform === p ? (p === 'instagram' ? '#E1306C20' : '#1877F220') : C.bg,
                color: platform === p ? (p === 'instagram' ? '#E1306C' : '#1877F2') : C.dim,
                border: '1px solid ' + (platform === p ? (p === 'instagram' ? '#E1306C' : '#1877F2') : C.border),
              }}>{p}</button>
            ))}
          </div>
        </div>
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
          <label style={{ fontSize: 12, color: C.dim, display: 'block', marginBottom: 6 }}>Period</label>
          <select value={period} onChange={e => setPeriod(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}>
            {['Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days'].map(p => <option key={p}>{p}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {Object.entries(SCREENSHOT_GUIDES).filter(([k]) => k.startsWith(platform)).map(([key, guide]) => (
              <label key={key} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, background: C.bg, border: '1px solid ' + C.border, cursor: 'pointer', fontSize: 10, color: C.dim, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <Upload size={12} /> {guide.title.replace('Instagram ', '').replace('Facebook ', '')}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleScreenshot(e, key)} />
              </label>
            ))}
          </div>
          {ssLoading && <p style={{ fontSize: 11, color: C.accent, marginTop: 4 }}>Reading screenshot...</p>}
        </div>
      </div>

      {/* Metrics Input */}
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>
          {platform === 'instagram' ? '📸' : '📘'} {platform.charAt(0).toUpperCase() + platform.slice(1)} Metrics
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            ['Followers', 'followers'], ['Posts Published', 'posts_published'],
            ['Avg Reach', 'avg_reach'], ['Avg Likes', 'avg_likes'],
            ['Avg Comments', 'avg_comments'], ['Avg Saves', 'avg_saves'],
            ['Avg Shares', 'avg_shares'], ['Engagement Rate %', 'engagement_rate'],
            ['Profile Visits', 'profile_visits'], ['Website Clicks', 'website_clicks'],
            ['Follower Growth', 'follower_growth'],
          ].map(([label, key]) => (
            <div key={key}>
              <label style={{ fontSize: 11, color: C.dim, display: 'block', marginBottom: 4 }}>{label}</label>
              <input value={(metrics as any)[key]} onChange={e => setMetrics(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder="0" type="text"
                style={{ width: '100%', padding: 8, borderRadius: 6, background: C.bg, color: C.text, border: '1px solid ' + C.border, fontSize: 13 }}
              />
            </div>
          ))}
        </div>
      </div>

      <button onClick={analyze} disabled={loading} style={{
        width: '100%', padding: 14, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        background: loading ? C.border : C.accent, color: loading ? C.dim : '#FFFFFF', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {loading ? <><RefreshCw size={16} className="animate-spin" /> Analyzing...</> : <><BarChart3 size={16} /> Run Analysis</>}
      </button>

      {/* Analysis Results */}
      {analysis && !analysis.raw && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Health Score */}
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>Health Score</h3>
                <p style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>{analysis.assessment}</p>
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: scoreColor(analysis.healthScore) }}>
                {analysis.healthScore}<span style={{ fontSize: 16 }}>/10</span>
              </div>
            </div>
          </div>

          {/* Scorecard */}
          {analysis.scorecard && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Scorecard</h3>
              {analysis.scorecard.map((s: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, marginBottom: 4, background: '#F4F4F5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS[s.status] || C.dim }} />
                    <span style={{ fontSize: 13, color: C.text }}>{s.metric}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{s.value}</span>
                    <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>benchmark: {s.benchmark}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Content Performance */}
          {analysis.contentPerformance && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Content Performance</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: C.green + '10', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 11, color: C.green, marginBottom: 4 }}>Best Performing</p>
                  <p style={{ fontSize: 13, color: C.text }}>{analysis.contentPerformance.bestType}</p>
                </div>
                <div style={{ background: C.red + '10', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 11, color: C.red, marginBottom: 4 }}>Needs Improvement</p>
                  <p style={{ fontSize: 13, color: C.text }}>{analysis.contentPerformance.worstType}</p>
                </div>
              </div>
              <p style={{ fontSize: 13, color: C.accent, marginTop: 8 }}>{analysis.contentPerformance.recommendation}</p>
            </div>
          )}

          {/* Timing */}
          {analysis.timingAnalysis && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Timing Analysis</h3>
              <p style={{ fontSize: 13, color: C.text }}>Best day: <strong>{analysis.timingAnalysis.bestDay}</strong> at <strong>{analysis.timingAnalysis.bestTime}</strong></p>
              <p style={{ fontSize: 13, color: C.accent, marginTop: 4 }}>{analysis.timingAnalysis.recommendation}</p>
            </div>
          )}

          {/* Suggestions */}
          {analysis.suggestions && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Recommendations</h3>
              {analysis.suggestions.map((s: string, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: i < analysis.suggestions.length - 1 ? '1px solid ' + C.border : 'none' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: C.accent, color: '#FFFFFF', height: 'fit-content' }}>{i + 1}</span>
                  <p style={{ fontSize: 13, color: C.text }}>{s}</p>
                </div>
              ))}
            </div>
          )}

          {/* KPI Targets */}
          {analysis.kpiTargets && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Next Period Targets</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {Object.entries(analysis.kpiTargets).map(([key, val]) => (
                  <div key={key} style={{ background: '#F4F4F5', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                    <p style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{val as string}</p>
                    <p style={{ fontSize: 10, color: C.dim }}>{key.replace(/([A-Z])/g, ' $1')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {analysis?.raw && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20, marginTop: 20 }}>
          <p style={{ fontSize: 12, color: C.yellow }}>Raw output:</p>
          <pre style={{ fontSize: 12, color: C.text, whiteSpace: 'pre-wrap' }}>{analysis.raw}</pre>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 20, marginTop: 20 }}>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Metrics History</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>{['Date', 'Followers', 'Reach', 'Likes', 'Comments', 'Saves', 'Eng. Rate', 'Growth'].map(h => (
                  <th key={h} style={{ padding: '8px 6px', textAlign: 'left', color: C.dim, borderBottom: '1px solid ' + C.border, fontWeight: 500 }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {history.slice(0, 15).map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px', color: C.text }}>{row.date}</td>
                    <td style={{ padding: '6px', color: C.text }}>{row.followers?.toLocaleString('en-IN')}</td>
                    <td style={{ padding: '6px', color: C.text }}>{row.avg_reach?.toLocaleString('en-IN')}</td>
                    <td style={{ padding: '6px', color: C.text }}>{row.avg_likes}</td>
                    <td style={{ padding: '6px', color: C.text }}>{row.avg_comments}</td>
                    <td style={{ padding: '6px', color: C.text }}>{row.avg_saves}</td>
                    <td style={{ padding: '6px', color: C.text }}>{row.engagement_rate}%</td>
                    <td style={{ padding: '6px', color: row.follower_growth > 0 ? C.green : row.follower_growth < 0 ? C.red : C.dim }}>
                      {row.follower_growth > 0 ? '+' : ''}{row.follower_growth}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

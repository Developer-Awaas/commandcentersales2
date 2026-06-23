import { useState, useEffect, useRef, useCallback } from 'react';
import { Brain, Upload, Trash2, Sparkles, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Image as ImageIcon, TrendingUp, Eye, Copy, Check, Bot, Zap, Download, X, Layers } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { aiCall, logToLangfuse } from '../lib/ai-service';
import { generateImageWithGemini } from '../lib/gemini-service';

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = 'own_ad' | 'competitor' | 'industry_reference' | 'winning_template';
type Platform = 'meta_feed' | 'meta_story' | 'instagram_feed' | 'instagram_story' | 'whatsapp' | 'google_display';
type PerformanceTier = 'top_performer' | 'good_performer' | 'average' | 'underperformer' | 'reference_only';

interface VisionAnalysis {
  description?: string;
  patterns?: string[];
  section_1_scene_type?: string;
  section_3_lens?: string;
  section_4_lighting?: string;
  section_5_hex_colors?: string[];
  section_6_typography_elements?: string[];
  composition_split?: string;
  competitive_strengths?: string[];
  avoid_reasons?: string[];
}

interface TrainingCreative {
  id: string;
  image_url: string;
  storage_path: string | null;
  source: Source;
  platform: Platform | null;
  performance_tier: PerformanceTier;
  cpl: number | null;
  ctr: number | null;
  notes: string | null;
  vision_analysis: VisionAnalysis | null;
  extracted_patterns: Record<string, unknown> | null;
  is_live: boolean;
  created_at: string;
  project_id: string | null;
}

interface Project {
  id: string;
  name: string;
}

interface DesignDNA {
  dna_summary: string | null;
  confidence_level: string | null;
  last_recomputed_at: string | null;
  best_performing_angles: unknown[] | null;
  best_performing_compositions: unknown[] | null;
  best_performing_color_treatments: unknown[] | null;
}

interface BatchFile {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<Source, string> = {
  own_ad: 'Our Ad',
  competitor: 'Competitor',
  industry_reference: 'Industry Ref',
  winning_template: 'Winning Template',
};

const TIER_LABELS: Record<PerformanceTier, string> = {
  top_performer: 'Top Performer',
  good_performer: 'Good Performer',
  average: 'Average',
  underperformer: 'Underperformer',
  reference_only: 'Reference Only',
};

const TIER_COLORS: Record<PerformanceTier, string> = {
  top_performer: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  good_performer: 'bg-blue-100 text-blue-800 border-blue-200',
  average: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  underperformer: 'bg-red-100 text-red-800 border-red-200',
  reference_only: 'bg-surface-subtle text-text-secondary border-border',
};

const PLATFORM_LABELS: Record<Platform, string> = {
  meta_feed: 'Meta Feed',
  meta_story: 'Meta Story',
  instagram_feed: 'IG Feed',
  instagram_story: 'IG Story',
  whatsapp: 'WhatsApp',
  google_display: 'Google Display',
};

// ─── Vision analysis via Claude Haiku ─────────────────────────────────────────

async function analyzeCreativeWithVision(imageUrl: string): Promise<VisionAnalysis | null> {
  try {
    const { data, error } = await supabase.functions.invoke('claude-proxy', {
      body: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            {
              type: 'text',
              text: `You are Aanya Mehta, Senior Creative Director for Indian real estate advertising. Analyze this ad creative and extract structured design intelligence for image generation.

Return a JSON object with exactly these fields:
{
  "description": "2-3 sentence visual summary: layout type, dominant visual, color palette, typography style, mood",
  "patterns": ["layout: ...", "color: ...", "typography: ...", "composition: ...", "mood: ..."],
  "section_1_scene_type": "one of: GRAPHIC_DESIGN_FRAME | PHOTOREALISTIC_SCENE | TYPOGRAPHY_FORWARD",
  "section_3_lens": "e.g. 24mm wide-angle low-angle | 85mm portrait three-quarter | 35mm eye-level",
  "section_4_lighting": "e.g. Golden hour 3200K directional east shadows | Overcast diffused 5500K | Studio soft 4000K",
  "section_5_hex_colors": ["#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "section_6_typography_elements": ["ELEMENT_TYPE: style description"],
  "composition_split": "e.g. 60% visual / 40% info zone | 70% hero photo / 30% text overlay",
  "competitive_strengths": ["specific element that makes this ad effective"],
  "avoid_reasons": ["element that weakens this ad, if any"]
}

For section_6_typography_elements use these element type names: MIXED_WEIGHT_HEADLINE | PRICE_BADGE | PHOTO_CAPTION_BAR | FEATURE_CHECKLIST | FOOTER_STRIP | CTA_BUTTON | SUBHEADLINE | TAGLINE.
For section_5_hex_colors: read or estimate the 3-5 most dominant hex values visible in the image.
Return ONLY the JSON object, no markdown, no preamble.`,
            },
          ],
        }],
      },
    });

    if (error) {
      logToLangfuse('aanya-memory-vision-analysis', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: error.message });
      return null;
    }
    const text = ((data?.content ?? []) as { type: string; text: string }[])
      .filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const parsed = JSON.parse(text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim());
    logToLangfuse('aanya-memory-vision-analysis', {
      output: parsed,
      model: 'claude-haiku-4-5-20251001',
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
    });
    return parsed as VisionAnalysis;
  } catch (err) {
    logToLangfuse('aanya-memory-vision-analysis', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error' });
    return null;
  }
}

// ─── DNA Synthesis ────────────────────────────────────────────────────────────

async function synthesizeDNA(
  creatives: TrainingCreative[],
  projectId: string,
  projectName: string
): Promise<{ success: boolean; summary: string; cleared: number }> {
  const topPerformers = creatives.filter(c => c.performance_tier === 'top_performer' || c.performance_tier === 'good_performer');
  const underperformers = creatives.filter(c => c.performance_tier === 'underperformer');

  // Separate by source: own performance vs competitor intelligence
  const ownTopPerformers = topPerformers.filter(c => c.source === 'own_ad' || c.source === 'winning_template');
  const competitorCreatives = creatives.filter(c => c.source === 'competitor' || c.source === 'industry_reference');

  const topPatterns = ownTopPerformers.flatMap(c => c.vision_analysis?.patterns ?? []).filter(Boolean);
  const badPatterns = underperformers.flatMap(c => c.vision_analysis?.patterns ?? []).filter(Boolean);
  const topDescriptions = ownTopPerformers
    .map(c => c.vision_analysis?.description).filter(Boolean).slice(0, 6).join('\n');

  // Structured 9-section signals from own top performers
  const winningHex = [...new Set(ownTopPerformers.flatMap(c => c.vision_analysis?.section_5_hex_colors ?? []))].slice(0, 8);
  const winningTypography = [...new Set(ownTopPerformers.flatMap(c => c.vision_analysis?.section_6_typography_elements ?? []))].slice(0, 8);
  const winningLens = ownTopPerformers.map(c => c.vision_analysis?.section_3_lens).filter(Boolean).slice(0, 4);
  const winningLighting = ownTopPerformers.map(c => c.vision_analysis?.section_4_lighting).filter(Boolean).slice(0, 4);
  const sceneTypes = ownTopPerformers.map(c => c.vision_analysis?.section_1_scene_type).filter(Boolean);
  const ownStrengths = ownTopPerformers.flatMap(c => c.vision_analysis?.competitive_strengths ?? []).slice(0, 6);
  const avoidReasons = [
    ...underperformers.flatMap(c => c.vision_analysis?.avoid_reasons ?? []),
    ...underperformers.flatMap(c => c.vision_analysis?.patterns ?? []),
  ].filter(Boolean).slice(0, 6);

  // Competitor intelligence (from Diya's analysis)
  const competitorStrengths = competitorCreatives.flatMap(c => c.vision_analysis?.competitive_strengths ?? []).slice(0, 6);
  const competitorHex = [...new Set(competitorCreatives.flatMap(c => c.vision_analysis?.section_5_hex_colors ?? []))].slice(0, 6);
  const competitorTypography = [...new Set(competitorCreatives.flatMap(c => c.vision_analysis?.section_6_typography_elements ?? []))].slice(0, 6);
  const competitorWeaknesses = competitorCreatives.flatMap(c => c.vision_analysis?.avoid_reasons ?? []).slice(0, 4);

  const prompt = `You are Aanya Mehta, Senior Creative Director for Indian real estate advertising.

Project: ${projectName}
Training data: ${creatives.length} total — ${ownTopPerformers.length} own top/good performers, ${underperformers.length} underperformers, ${competitorCreatives.length} competitor references

OWN TOP PERFORMER PATTERNS (proven to work for this project):
${topPatterns.length > 0 ? topPatterns.map(p => `- ${p}`).join('\n') : 'None tagged yet'}

OWN TOP PERFORMER DESCRIPTIONS:
${topDescriptions || 'None available yet'}

WINNING COLOR PALETTE (hex from own top performers):
${winningHex.length > 0 ? winningHex.join(', ') : 'Not yet extracted'}

WINNING TYPOGRAPHY (Section 6 element types from top performers):
${winningTypography.length > 0 ? winningTypography.map(t => `- ${t}`).join('\n') : 'Not yet extracted'}

WINNING LENS / SHOT (Section 3):
${winningLens.length > 0 ? winningLens.map(l => `- ${l}`).join('\n') : 'Not yet extracted'}

WINNING LIGHTING (Section 4):
${winningLighting.length > 0 ? winningLighting.map(l => `- ${l}`).join('\n') : 'Not yet extracted'}

PREFERRED SCENE TYPES: ${sceneTypes.length > 0 ? [...new Set(sceneTypes)].join(', ') : 'None extracted'}

OWN AD STRENGTHS: ${ownStrengths.length > 0 ? ownStrengths.map(s => `- ${s}`).join('\n') : 'None tagged'}

WHAT TO AVOID (underperformers):
${[...badPatterns, ...avoidReasons].length > 0 ? [...new Set([...badPatterns, ...avoidReasons])].map(p => `- ${p}`).join('\n') : 'None tagged yet'}

COMPETITOR INTELLIGENCE (${competitorCreatives.length} competitor/industry references analyzed):
${competitorStrengths.length > 0 ? `Competitor strengths to adopt:\n${competitorStrengths.map(s => `- ${s}`).join('\n')}` : 'No competitor creatives analyzed yet'}
${competitorHex.length > 0 ? `Competitor color palette: ${competitorHex.join(', ')}` : ''}
${competitorTypography.length > 0 ? `Competitor typography elements:\n${competitorTypography.map(t => `- ${t}`).join('\n')}` : ''}
${competitorWeaknesses.length > 0 ? `Competitor weaknesses (avoid copying):\n${competitorWeaknesses.map(w => `- ${w}`).join('\n')}` : ''}

Based on this data, synthesize the Design DNA AND section-level prompt fragments.

Return a JSON object:
{
  "dna_summary": "3-5 sentence brief: winning creative formula including specific hex colors, preferred scene type, lens, typography element types, and how we differentiate from competitors.",
  "best_performing_angles": ["angle1", "angle2"],
  "best_performing_compositions": ["composition with lens + split e.g. 85mm portrait + 60/40 dual-photo-card"],
  "best_performing_color_treatments": ["treatment with hex codes e.g. navy #1A3A5C + gold #C9A961 on white"],
  "best_performing_copy_angles": ["copy angle1", "copy angle2"],
  "underperforming_patterns": ["specific pattern to avoid"],
  "confidence_level": "low|medium|high|very_high",
  "prompt_fragments": {
    "section_1": "Preferred scene type and opening description for Section 1 of the image prompt",
    "section_3": "Preferred lens mm + shot type for Section 3",
    "section_4": "Preferred lighting time + Kelvin + shadow direction for Section 4",
    "section_5_hex": ["#RRGGBB"],
    "section_6_elements": ["ELEMENT_TYPE: style description"],
    "section_8_avoid": ["specific visual pattern to exclude from negative prompts"]
  }
}

Return ONLY the JSON object.`;

  const result = await aiCall(
    prompt,
    'You are Aanya Mehta. Respond ONLY in valid JSON.',
    16000,
    { traceName: 'aanya-memory-synthesize-dna' }
  );

  if (result.error) return { success: false, summary: result.error as string, cleared: 0 };

  const parsed = result as {
    dna_summary?: string;
    best_performing_angles?: string[];
    best_performing_compositions?: string[];
    best_performing_color_treatments?: string[];
    best_performing_copy_angles?: string[];
    underperforming_patterns?: string[];
    confidence_level?: string;
    prompt_fragments?: {
      section_1?: string;
      section_3?: string;
      section_4?: string;
      section_5_hex?: string[];
      section_6_elements?: string[];
      section_8_avoid?: string[];
    };
  };

  const orgId = getOrgId();
  const { error } = await supabase.from('project_design_systems').upsert({
    project_id: projectId,
    org_id: orgId,
    dna_summary: parsed.dna_summary ?? '',
    best_performing_angles: (parsed.best_performing_angles ?? []).map(a => ({ angle: a, avg_cpl: 0, sample_size: 1 })),
    best_performing_compositions: (parsed.best_performing_compositions ?? []).map(c => ({ composition: c, avg_cpl: 0, sample_size: 1 })),
    best_performing_color_treatments: (parsed.best_performing_color_treatments ?? []).map(c => ({ color_treatment: c, avg_cpl: 0, sample_size: 1 })),
    best_performing_copy_angles: (parsed.best_performing_copy_angles ?? []).map(c => ({ copy_angle: c, avg_cpl: 0, sample_size: 1 })),
    underperforming_patterns: (parsed.underperforming_patterns ?? []).map(p => ({ pattern: p, sample_size: 1 })),
    confidence_level: parsed.confidence_level ?? 'low',
    total_creatives_analyzed: creatives.length,
    prompt_fragments: parsed.prompt_fragments ?? null,
    last_recomputed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id' });

  if (error) return { success: false, summary: `DB error: ${error.message}`, cleared: 0 };

  // ── Cleanup: only delete non-live rows (manually uploaded training data).
  // is_live=true rows are auto-promoted by Arjun from live campaigns — they persist
  // so their patterns remain available for future synthesis passes.
  const toDelete = creatives.filter(c => !c.is_live);
  const storagePaths = toDelete.map(c => c.storage_path).filter((p): p is string => Boolean(p));
  if (storagePaths.length > 0) {
    await supabase.storage.from('brand-assets').remove(storagePaths);
  }
  if (toDelete.length > 0) {
    await supabase.from('aanya_training_creatives').delete().in('id', toDelete.map(c => c.id));
  }

  return { success: true, summary: parsed.dna_summary ?? 'DNA synthesized.', cleared: toDelete.length };
}

// ─── Upload card component ─────────────────────────────────────────────────────

interface UploadCardProps {
  projects: Project[];
  onUploaded: () => void;
}

function UploadCard({ projects, onUploaded }: UploadCardProps) {
  const [tab, setTab] = useState<'single' | 'batch'>('single');

  // ── Single upload state ──────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [source, setSource] = useState<Source>('own_ad');
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [tier, setTier] = useState<PerformanceTier>('reference_only');
  const [cpl, setCpl] = useState('');
  const [ctr, setCtr] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const blobRef = useRef<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleFile = useCallback((f: File) => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    const url = URL.createObjectURL(f);
    blobRef.current = url;
    setFile(f);
    setPreview(url);
  }, []);

  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  };

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      const session = refreshData?.session;
      if (refreshErr || !session) throw new Error('Session expired — please sign out and sign back in.');
      const { data: profile, error: profileErr } = await supabase.from('profiles').select('org_id').eq('id', session.user.id).maybeSingle();
      if (profileErr) throw new Error(`Profile error: ${profileErr.message}`);
      if (!profile?.org_id) throw new Error('Could not load your organisation profile. Contact admin.');
      const orgId = profile.org_id;

      const ext = file.type.split('/')[1] ?? 'jpg';
      const path = `aanya-training/${orgId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: storErr } = await supabase.storage.from('brand-assets').upload(path, file, { contentType: file.type, upsert: false });
      if (storErr) {
        const msg = storErr.message ?? '';
        if (msg.toLowerCase().includes('bucket') || msg.toLowerCase().includes('not found')) throw new Error('Storage: bucket "brand-assets" not found — create it in Supabase → Storage.');
        if (msg.toLowerCase().includes('security') || msg.toLowerCase().includes('rls') || msg.toLowerCase().includes('policy') || msg.toLowerCase().includes('violates')) throw new Error('Storage upload blocked by RLS — check bucket policies.');
        throw new Error(`Storage upload failed: ${msg}`);
      }
      const { data: urlData } = supabase.storage.from('brand-assets').getPublicUrl(path);
      const imageUrl = urlData.publicUrl;
      const visionResult = await analyzeCreativeWithVision(imageUrl);
      const { error: dbErr } = await supabase.from('aanya_training_creatives').insert({
        org_id: orgId, project_id: projectId || null, image_url: imageUrl, storage_path: path,
        source, platform: platform || null, performance_tier: tier,
        cpl: cpl ? parseFloat(cpl) : null, ctr: ctr ? parseFloat(ctr) : null,
        notes: notes || null, vision_analysis: visionResult,
        extracted_patterns: visionResult ? { patterns: visionResult.patterns } : null,
      });
      if (dbErr) throw new Error(dbErr.message);
      setFile(null); setPreview(null); setCpl(''); setCtr(''); setNotes(''); setTier('reference_only');
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  // ── Batch upload state ───────────────────────────────────────────────────────
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [batchProjectId, setBatchProjectId] = useState('');
  const [batchSource, setBatchSource] = useState<Source>('own_ad');
  const [batchPlatform, setBatchPlatform] = useState<Platform | null>(null);
  const [batchTier, setBatchTier] = useState<PerformanceTier>('top_performer');
  const [batchCpl, setBatchCpl] = useState('');
  const [batchCtr, setBatchCtr] = useState('');
  const [batchUploading, setBatchUploading] = useState(false);
  const [batchSummary, setBatchSummary] = useState<{ ok: number; fail: number } | null>(null);
  const batchBlobsRef = useRef<string[]>([]);

  useEffect(() => () => { batchBlobsRef.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  function addBatchFiles(newFiles: FileList | File[]) {
    const imgs = Array.from(newFiles).filter(f => f.type.startsWith('image/'));
    const added: BatchFile[] = imgs.map(f => {
      const url = URL.createObjectURL(f);
      batchBlobsRef.current.push(url);
      return { id: Math.random().toString(36).slice(2), file: f, preview: url, status: 'pending' };
    });
    setBatchFiles(prev => [...prev, ...added]);
    setBatchSummary(null);
  }

  function removeBatchFile(id: string) {
    setBatchFiles(prev => prev.filter(f => f.id !== id));
  }

  function updateBatchFile(id: string, status: BatchFile['status'], error?: string) {
    setBatchFiles(prev => prev.map(f => f.id === id ? { ...f, status, error } : f));
  }

  async function uploadBatch() {
    const pending = batchFiles.filter(f => f.status === 'pending');
    if (pending.length === 0) return;
    setBatchUploading(true);
    setBatchSummary(null);

    const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
    const session = refreshData?.session;
    if (refreshErr || !session) {
      setBatchFiles(prev => prev.map(f => f.status === 'pending' ? { ...f, status: 'error', error: 'Session expired' } : f));
      setBatchUploading(false);
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', session.user.id).maybeSingle();
    if (!profile?.org_id) {
      setBatchFiles(prev => prev.map(f => f.status === 'pending' ? { ...f, status: 'error', error: 'Profile error' } : f));
      setBatchUploading(false);
      return;
    }
    const orgId = profile.org_id;

    let ok = 0, fail = 0;
    for (const bf of pending) {
      updateBatchFile(bf.id, 'uploading');
      try {
        const ext = bf.file.type.split('/')[1] ?? 'jpg';
        const path = `aanya-training/${orgId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: storErr } = await supabase.storage.from('brand-assets').upload(path, bf.file, { contentType: bf.file.type, upsert: false });
        if (storErr) throw new Error(storErr.message);
        const { data: urlData } = supabase.storage.from('brand-assets').getPublicUrl(path);
        const imageUrl = urlData.publicUrl;
        const visionResult = await analyzeCreativeWithVision(imageUrl);
        const { error: dbErr } = await supabase.from('aanya_training_creatives').insert({
          org_id: orgId, project_id: batchProjectId || null, image_url: imageUrl, storage_path: path,
          source: batchSource, platform: batchPlatform || null, performance_tier: batchTier,
          cpl: batchCpl ? parseFloat(batchCpl) : null, ctr: batchCtr ? parseFloat(batchCtr) : null,
          notes: null, vision_analysis: visionResult,
          extracted_patterns: visionResult ? { patterns: visionResult.patterns } : null,
        });
        if (dbErr) throw new Error(dbErr.message);
        updateBatchFile(bf.id, 'done');
        ok++;
      } catch (err) {
        updateBatchFile(bf.id, 'error', err instanceof Error ? err.message : 'Failed');
        fail++;
      }
    }

    setBatchSummary({ ok, fail });
    setBatchUploading(false);
    if (ok > 0) onUploaded();
  }

  const pendingCount = batchFiles.filter(f => f.status === 'pending').length;

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
      {/* Header with tab switcher */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary flex items-center gap-2">
          {tab === 'single' ? <Upload className="w-4 h-4 text-accent" /> : <Layers className="w-4 h-4 text-accent" />}
          {tab === 'single' ? 'Add Training Creative' : 'Batch Upload'}
        </h3>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          <button
            onClick={() => setTab('single')}
            className={`px-2.5 py-1 transition-colors ${tab === 'single' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-subtle'}`}
          >Single</button>
          <button
            onClick={() => setTab('batch')}
            className={`px-2.5 py-1 border-l border-border transition-colors ${tab === 'batch' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-subtle'}`}
          >Batch</button>
        </div>
      </div>

      {tab === 'single' ? (
        <>
          {/* Drop zone */}
          <div
            ref={dropRef}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => document.getElementById('atc-file-input')?.click()}
            className="border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent/60 hover:bg-surface-subtle/40 transition-colors min-h-[120px]"
          >
            {preview ? (
              <img src={preview} alt="preview" className="max-h-28 max-w-full object-contain rounded" />
            ) : (
              <>
                <ImageIcon className="w-8 h-8 text-text-muted" />
                <p className="text-sm text-text-secondary">Drag & drop or click to select image</p>
                <p className="text-xs text-text-muted">JPG, PNG, WebP</p>
              </>
            )}
          </div>
          <input id="atc-file-input" type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Project</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Source</label>
              <select value={source} onChange={e => setSource(e.target.value as Source)} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
                {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Platform</label>
              <select value={platform ?? ''} onChange={e => setPlatform(e.target.value as Platform || null)} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
                <option value="">Any</option>
                {Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Performance Tier</label>
              <select value={tier} onChange={e => setTier(e.target.value as PerformanceTier)} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
                {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">CPL (₹, optional)</label>
              <input type="number" value={cpl} onChange={e => setCpl(e.target.value)} placeholder="e.g. 420" className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary" />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">CTR (%, optional)</label>
              <input type="number" step="0.01" value={ctr} onChange={e => setCtr(e.target.value)} placeholder="e.g. 1.8" className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary" />
            </div>
          </div>

          <div>
            <label className="text-xs text-text-secondary mb-1 block">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="What made this work / not work?"
              rows={2} className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary resize-none" />
          </div>

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 leading-relaxed">{error}</div>}
          {!file && <p className="text-xs text-text-muted text-center">Select an image above to enable upload</p>}

          <button onClick={upload} disabled={!file || uploading}
            style={{ backgroundColor: file ? '#18181B' : '#A1A1AA', color: '#ffffff', cursor: file ? 'pointer' : 'not-allowed' }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading + Analysing...</> : <><Upload className="w-4 h-4" /> Upload & Analyse</>}
          </button>
        </>
      ) : (
        <>
          {/* Batch settings */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Project</label>
              <select value={batchProjectId} onChange={e => setBatchProjectId(e.target.value)} disabled={batchUploading}
                className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Source</label>
              <select value={batchSource} onChange={e => setBatchSource(e.target.value as Source)} disabled={batchUploading}
                className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
                {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Performance Tier</label>
              <select value={batchTier} onChange={e => setBatchTier(e.target.value as PerformanceTier)} disabled={batchUploading}
                className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
                {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Platform</label>
              <select value={batchPlatform ?? ''} onChange={e => setBatchPlatform(e.target.value as Platform || null)} disabled={batchUploading}
                className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary">
                <option value="">Any</option>
                {Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">CPL ₹ (optional)</label>
              <input type="number" value={batchCpl} onChange={e => setBatchCpl(e.target.value)} placeholder="e.g. 420" disabled={batchUploading}
                className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary" />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">CTR % (optional)</label>
              <input type="number" step="0.01" value={batchCtr} onChange={e => setBatchCtr(e.target.value)} placeholder="e.g. 1.8" disabled={batchUploading}
                className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary" />
            </div>
          </div>

          {/* Multi-file drop zone */}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (!batchUploading) addBatchFiles(e.dataTransfer.files); }}
            onClick={() => !batchUploading && document.getElementById('batch-file-input')?.click()}
            className="border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent/60 hover:bg-surface-subtle/40 transition-colors min-h-[90px]"
          >
            <ImageIcon className="w-6 h-6 text-text-muted" />
            <p className="text-sm text-text-secondary text-center">Drop multiple images or click to select</p>
            <p className="text-xs text-text-muted">{batchFiles.length > 0 ? `${batchFiles.length} file${batchFiles.length !== 1 ? 's' : ''} queued — drop more to add` : 'Select multiple files at once'}</p>
          </div>
          <input id="batch-file-input" type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files) addBatchFiles(e.target.files); e.target.value = ''; }} />

          {/* File grid with status overlays */}
          {batchFiles.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {batchFiles.map(bf => (
                <div key={bf.id} className="relative group aspect-square">
                  <img src={bf.preview} alt="" className="w-full h-full object-cover rounded-md border border-border" />
                  {bf.status === 'uploading' && (
                    <div className="absolute inset-0 bg-black/50 rounded-md flex items-center justify-center">
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    </div>
                  )}
                  {bf.status === 'done' && (
                    <div className="absolute inset-0 bg-emerald-500/70 rounded-md flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    </div>
                  )}
                  {bf.status === 'error' && (
                    <div className="absolute inset-0 bg-red-500/70 rounded-md flex items-center justify-center" title={bf.error}>
                      <AlertCircle className="w-4 h-4 text-white" />
                    </div>
                  )}
                  {bf.status === 'pending' && !batchUploading && (
                    <button
                      onClick={e => { e.stopPropagation(); removeBatchFile(bf.id); }}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-black/60 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5 text-white" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Progress bar while uploading */}
          {batchUploading && batchFiles.length > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-text-secondary">
                <span>Uploading & analysing...</span>
                <span>{batchFiles.filter(f => f.status === 'done' || f.status === 'error').length} / {batchFiles.length}</span>
              </div>
              <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${(batchFiles.filter(f => f.status === 'done' || f.status === 'error').length / batchFiles.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Summary */}
          {batchSummary && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${batchSummary.fail === 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {batchSummary.ok} uploaded{batchSummary.fail > 0 ? `, ${batchSummary.fail} failed` : ' — ready for DNA synthesis'}
            </div>
          )}

          <button
            onClick={uploadBatch}
            disabled={pendingCount === 0 || batchUploading}
            style={{ backgroundColor: pendingCount > 0 && !batchUploading ? '#18181B' : '#A1A1AA', color: '#ffffff', cursor: pendingCount > 0 && !batchUploading ? 'pointer' : 'not-allowed' }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {batchUploading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading + Analysing...</>
              : <><Layers className="w-4 h-4" /> Upload {pendingCount > 0 ? `${pendingCount} Image${pendingCount !== 1 ? 's' : ''}` : 'Images'}</>
            }
          </button>
        </>
      )}
    </div>
  );
}

// ─── Creative card component ───────────────────────────────────────────────────

interface CreativeCardProps {
  creative: TrainingCreative;
  onDelete: (id: string) => void;
}

function CreativeCard({ creative, onDelete }: CreativeCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden group">
      <div className="relative">
        <img src={creative.image_url} alt="training creative" className="w-full aspect-square object-cover" loading="lazy" />
        <button
          onClick={() => onDelete(creative.id)}
          className="absolute top-2 right-2 p-1.5 bg-danger text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <span className={`absolute bottom-2 left-2 text-xs font-medium px-2 py-0.5 rounded-full border ${TIER_COLORS[creative.performance_tier]}`}>
          {TIER_LABELS[creative.performance_tier]}
        </span>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <span className="text-xs text-text-muted">{SOURCE_LABELS[creative.source]}</span>
          {creative.platform && (
            <span className="text-xs bg-surface-subtle border border-border rounded px-1.5 py-0.5 text-text-secondary">
              {PLATFORM_LABELS[creative.platform]}
            </span>
          )}
        </div>

        {(creative.cpl || creative.ctr) && (
          <div className="flex gap-3 text-xs text-text-secondary">
            {creative.cpl && <span>CPL ₹{creative.cpl}</span>}
            {creative.ctr && <span>CTR {creative.ctr}%</span>}
          </div>
        )}

        {creative.vision_analysis && (
          <>
            <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80">
              <Eye className="w-3.5 h-3.5" />
              Aanya's Analysis
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {expanded && (
              <div className="text-xs text-text-secondary space-y-2 pt-1">
                {creative.vision_analysis.description && (
                  <p className="leading-relaxed">{creative.vision_analysis.description}</p>
                )}
                {creative.vision_analysis.patterns && creative.vision_analysis.patterns.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {creative.vision_analysis.patterns.map((p, i) => (
                      <span key={i} className="bg-surface-subtle border border-border rounded px-1.5 py-0.5 text-[11px]">{p}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── DNA Panel ────────────────────────────────────────────────────────────────

interface DNAPanelProps {
  projectId: string;
  projectName: string;
  creatives: TrainingCreative[];
  onSynthesized: () => void;
}

function DNAPanel({ projectId, projectName, creatives, onSynthesized }: DNAPanelProps) {
  const [dna, setDna] = useState<DesignDNA | null>(null);
  const [loading, setLoading] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    supabase.from('project_design_systems').select('dna_summary,confidence_level,last_recomputed_at,best_performing_angles,best_performing_compositions,best_performing_color_treatments').eq('project_id', projectId).maybeSingle()
      .then(({ data }) => setDna(data));
  }, [projectId]);

  async function handleSynthesize() {
    setSynthesizing(true);
    setResult(null);
    setLoading(true);
    const { success, summary, cleared } = await synthesizeDNA(creatives, projectId, projectName);
    if (success) {
      setResult({ ok: true, msg: `DNA synthesized from ${cleared} creative${cleared !== 1 ? 's' : ''} — training data cleared. Aanya will use this for all future generations.` });
      const { data } = await supabase.from('project_design_systems').select('dna_summary,confidence_level,last_recomputed_at,best_performing_angles,best_performing_compositions,best_performing_color_treatments').eq('project_id', projectId).maybeSingle();
      setDna(data);
      onSynthesized();
    } else {
      setResult({ ok: false, msg: summary });
    }
    setSynthesizing(false);
    setLoading(false);
  }

  const topAngles = (dna?.best_performing_angles as Array<{ angle?: string }> | null)?.map(a => a?.angle).filter(Boolean) ?? [];
  const topComps = (dna?.best_performing_compositions as Array<{ composition?: string }> | null)?.map(c => c?.composition).filter(Boolean) ?? [];
  const topColors = (dna?.best_performing_color_treatments as Array<{ color_treatment?: string }> | null)?.map(c => c?.color_treatment).filter(Boolean) ?? [];

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-500" />
          Design DNA
        </h3>
        <button
          onClick={handleSynthesize}
          disabled={synthesizing || creatives.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium disabled:opacity-50 hover:bg-purple-700 transition-colors"
        >
          {synthesizing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Synthesizing...</> : <><Sparkles className="w-3.5 h-3.5" />Synthesize DNA</>}
        </button>
      </div>

      {result && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-danger border border-red-200'}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          {result.msg}
        </div>
      )}

      {loading && !dna && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading DNA...
        </div>
      )}

      {dna?.dna_summary ? (
        <div className="space-y-3">
          <div className="bg-surface-subtle rounded-lg p-3">
            <p className="text-sm text-text-primary leading-relaxed">{dna.dna_summary}</p>
          </div>

          <div className="flex gap-2 flex-wrap text-xs text-text-secondary">
            <span className="bg-surface-subtle border border-border rounded px-2 py-0.5">
              Confidence: <strong className="text-text-primary">{dna.confidence_level ?? '—'}</strong>
            </span>
            {dna.last_recomputed_at && (
              <span className="bg-surface-subtle border border-border rounded px-2 py-0.5">
                Updated {new Date(dna.last_recomputed_at).toLocaleDateString('en-IN')}
              </span>
            )}
          </div>

          {topAngles.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-1">Top Angles</p>
              <div className="flex flex-wrap gap-1">
                {topAngles.map((a, i) => <span key={i} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5">{a}</span>)}
              </div>
            </div>
          )}

          {topComps.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-1">Compositions</p>
              <div className="flex flex-wrap gap-1">
                {topComps.map((c, i) => <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5">{c}</span>)}
              </div>
            </div>
          )}

          {topColors.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-1">Color Treatments</p>
              <div className="flex flex-wrap gap-1">
                {topColors.map((c, i) => <span key={i} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-0.5">{c}</span>)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          {creatives.length === 0
            ? 'Upload at least one training creative to synthesize DNA.'
            : 'Click "Synthesize DNA" to distil patterns from your training creatives.'}
        </p>
      )}
    </div>
  );
}

// ─── Crawl Parameters Panel ───────────────────────────────────────────────────

const PATTERN_CATEGORIES = ['Layout', 'Color', 'Typography', 'Copy angle', 'Composition', 'Mood'] as const;
type PatternCategory = typeof PATTERN_CATEGORIES[number];

const CATEGORY_COLORS: Record<PatternCategory, string> = {
  Layout:       'bg-blue-50 text-blue-700 border-blue-200',
  Color:        'bg-purple-50 text-purple-700 border-purple-200',
  Typography:   'bg-amber-50 text-amber-700 border-amber-200',
  'Copy angle': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Composition:  'bg-rose-50 text-rose-700 border-rose-200',
  Mood:         'bg-cyan-50 text-cyan-700 border-cyan-200',
};

function categorizePattern(p: string): PatternCategory {
  const lower = p.toLowerCase();
  for (const cat of PATTERN_CATEGORIES) {
    if (lower.startsWith(cat.toLowerCase() + ':')) return cat;
  }
  if (lower.includes('color') || lower.includes('palette') || lower.includes('hex') || lower.includes('bg ') || lower.includes('background')) return 'Color';
  if (lower.includes('font') || lower.includes('type') || lower.includes('sans') || lower.includes('serif') || lower.includes('headline') || lower.includes('bold')) return 'Typography';
  if (lower.includes('cta') || lower.includes('copy') || lower.includes('price') || lower.includes('urgency') || lower.includes('hook')) return 'Copy angle';
  if (lower.includes('shot') || lower.includes('hero') || lower.includes('card') || lower.includes('grid') || lower.includes('layout') || lower.includes('split')) return 'Composition';
  if (lower.includes('luxury') || lower.includes('aspirational') || lower.includes('minimal') || lower.includes('mood') || lower.includes('warm') || lower.includes('cool')) return 'Mood';
  return 'Layout';
}

function stripCategoryPrefix(p: string): string {
  return p.replace(/^[^:]+:\s*/i, '');
}

interface CrawlParametersPanelProps {
  creatives: TrainingCreative[];
  selectedProject: string;
  projects: Project[];
}

function CrawlParametersPanel({ creatives, selectedProject, projects }: CrawlParametersPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const topPerformers = creatives.filter(c => c.performance_tier === 'top_performer' || c.performance_tier === 'good_performer');
  const underperformers = creatives.filter(c => c.performance_tier === 'underperformer');

  // Aggregate patterns from top performers, deduplicated
  const topPatterns = Array.from(new Set(topPerformers.flatMap(c => c.vision_analysis?.patterns ?? [])));
  const avoidPatterns = Array.from(new Set(underperformers.flatMap(c => c.vision_analysis?.patterns ?? [])));

  // Group top patterns by category
  const grouped = PATTERN_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = topPatterns.filter(p => categorizePattern(p) === cat).map(stripCategoryPrefix);
    return acc;
  }, {} as Record<PatternCategory, string[]>);

  // Platform distribution (top performers only, fall back to all)
  const platformSource = topPerformers.length > 0 ? topPerformers : creatives;
  const platformCounts: Record<string, number> = {};
  platformSource.forEach(c => {
    if (c.platform) platformCounts[c.platform] = (platformCounts[c.platform] ?? 0) + 1;
  });
  const platformsSorted = Object.entries(platformCounts).sort(([, a], [, b]) => b - a);

  // Source distribution (all creatives)
  const sourceCounts: Record<string, number> = {};
  creatives.forEach(c => { sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1; });

  // CPL/CTR ranges from top performers
  const cpls = topPerformers.map(c => c.cpl).filter((v): v is number => v !== null);
  const ctrs = topPerformers.map(c => c.ctr).filter((v): v is number => v !== null);

  const descriptions = topPerformers.map(c => c.vision_analysis?.description).filter((d): d is string => Boolean(d));

  const projectName = selectedProject !== 'all'
    ? (projects.find(p => p.id === selectedProject)?.name ?? 'Selected Project')
    : 'All Projects';

  const agentJSON = {
    generated_at: new Date().toISOString(),
    scope: projectName,
    training_set: {
      total_creatives: creatives.length,
      top_good_performers: topPerformers.length,
      underperformers: underperformers.length,
      platforms: platformCounts,
      sources: sourceCounts,
      ...(cpls.length > 0 && { cpl_range_inr: { min: Math.min(...cpls), max: Math.max(...cpls), avg: Math.round(cpls.reduce((a, b) => a + b, 0) / cpls.length) } }),
      ...(ctrs.length > 0 && { ctr_range_pct: { min: Math.min(...ctrs), max: Math.max(...ctrs), avg: parseFloat((ctrs.reduce((a, b) => a + b, 0) / ctrs.length).toFixed(2)) } }),
    },
    crawl_targets: {
      platforms_to_prioritize: platformsSorted.map(([p]) => p),
      visual_patterns_to_replicate: grouped,
      sample_visual_descriptions: descriptions.slice(0, 5),
    },
    avoid: {
      patterns: avoidPatterns,
    },
  };

  const jsonString = JSON.stringify(agentJSON, null, 2);

  function copyJSON() {
    navigator.clipboard.writeText(jsonString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (creatives.length === 0) return null;

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-text-primary flex items-center gap-2">
            <Bot className="w-4 h-4 text-accent" />
            Crawl Parameters
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Aggregated parameters from {creatives.length} training creatives · feed directly to your crawling agents
          </p>
        </div>
        <button
          onClick={copyJSON}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ backgroundColor: '#18181B', color: '#ffffff' }}
        >
          {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy JSON</>}
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Creatives', value: creatives.length, color: 'text-text-primary' },
          { label: 'Top / Good Performers', value: topPerformers.length, color: 'text-emerald-600' },
          { label: 'Patterns Extracted', value: topPatterns.length, color: 'text-purple-600' },
          { label: 'Platforms Covered', value: Object.keys(platformCounts).length, color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="bg-surface-subtle rounded-lg px-3 py-2.5 text-center border border-border">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Pattern categories */}
      {topPatterns.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Top-Performer Visual Patterns</p>
          <div className="space-y-2.5">
            {PATTERN_CATEGORIES.filter(cat => grouped[cat].length > 0).map(cat => (
              <div key={cat} className="flex items-start gap-2">
                <span className="text-[11px] font-medium text-text-muted w-24 shrink-0 pt-0.5">{cat}</span>
                <div className="flex flex-wrap gap-1.5">
                  {grouped[cat].map((p, i) => (
                    <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[cat]}`}>{p}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Platform + Source side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {platformsSorted.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Platforms (top performers)</p>
            <div className="space-y-1.5">
              {platformsSorted.map(([platform, count]) => {
                const pct = Math.round((count / platformSource.length) * 100);
                return (
                  <div key={platform} className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary w-28 shrink-0">{PLATFORM_LABELS[platform as Platform] ?? platform}</span>
                    <div className="flex-1 bg-surface-subtle rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-text-muted w-6 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Source Breakdown</p>
          <div className="space-y-1.5">
            {Object.entries(sourceCounts).sort(([, a], [, b]) => b - a).map(([src, count]) => {
              const pct = Math.round((count / creatives.length) * 100);
              return (
                <div key={src} className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-28 shrink-0">{SOURCE_LABELS[src as Source] ?? src}</span>
                  <div className="flex-1 bg-surface-subtle rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-purple-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-text-muted w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* CPL / CTR ranges */}
      {(cpls.length > 0 || ctrs.length > 0) && (
        <div className="flex flex-wrap gap-3">
          {cpls.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">
              <span className="text-emerald-700 font-medium">CPL range (top performers): </span>
              <span className="text-emerald-800">₹{Math.min(...cpls)} – ₹{Math.max(...cpls)} · avg ₹{Math.round(cpls.reduce((a, b) => a + b, 0) / cpls.length)}</span>
            </div>
          )}
          {ctrs.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs">
              <span className="text-blue-700 font-medium">CTR range (top performers): </span>
              <span className="text-blue-800">{Math.min(...ctrs)}% – {Math.max(...ctrs)}% · avg {(ctrs.reduce((a, b) => a + b, 0) / ctrs.length).toFixed(2)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Avoid patterns */}
      {avoidPatterns.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Avoid (underperformer patterns)</p>
          <div className="flex flex-wrap gap-1.5">
            {avoidPatterns.map((p, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200">{stripCategoryPrefix(p)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Raw JSON toggle */}
      <div className="border-t border-border pt-3">
        <button
          onClick={() => setShowRaw(r => !r)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showRaw ? 'Hide' : 'Show'} raw JSON
        </button>
        {showRaw && (
          <pre className="mt-2 text-[11px] text-text-secondary bg-surface-subtle rounded-lg p-3 overflow-x-auto max-h-64 leading-relaxed">
            {jsonString}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Generate from DNA Panel ─────────────────────────────────────────────────

interface FullDesignDNA {
  dna_summary: string | null;
  confidence_level: string | null;
  best_performing_compositions: unknown[] | null;
  underperforming_patterns: unknown[] | null;
  prompt_fragments: {
    section_1?: string;
    section_3?: string;
    section_4?: string;
    section_5_hex?: string[];
    section_6_elements?: string[];
    section_8_avoid?: string[];
  } | null;
}

interface GenerateFromDNAPanelProps {
  projectId: string;
  projectName: string;
}

function GenerateFromDNAPanel({ projectId, projectName }: GenerateFromDNAPanelProps) {
  const [dna, setDna] = useState<FullDesignDNA | null>(null);
  const [brief, setBrief] = useState('');
  const [ratio, setRatio] = useState<'1:1' | '4:5' | '9:16'>('1:1');
  const [platform, setPlatform] = useState<'meta' | 'aisensy'>('meta');
  const [phase, setPhase] = useState<'idle' | 'writing-prompt' | 'generating' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');

  useEffect(() => {
    supabase
      .from('project_design_systems')
      .select('dna_summary,confidence_level,best_performing_compositions,underperforming_patterns,prompt_fragments')
      .eq('project_id', projectId)
      .maybeSingle()
      .then(({ data }) => setDna(data as FullDesignDNA | null));
  }, [projectId]);

  function buildDNABlock(d: FullDesignDNA): string {
    if (!d.dna_summary && !d.prompt_fragments) return 'No DNA synthesized yet — apply standard Indian real estate creative best practices.';
    const f = d.prompt_fragments;
    let block = `DESIGN DNA (from real ad performance — treat as hard constraints):\n`;
    if (d.dna_summary) block += `\nSUMMARY: ${d.dna_summary}\n`;
    if (f) {
      if (f.section_1) block += `\nSection 1 (scene): ${f.section_1}`;
      if (f.section_3) block += `\nSection 3 (camera/lens): ${f.section_3}`;
      if (f.section_4) block += `\nSection 4 (lighting): ${f.section_4}`;
      if (f.section_5_hex?.length) block += `\nSection 5 (color palette — use exactly): ${f.section_5_hex.join(', ')}`;
      if (f.section_6_elements?.length) block += `\nSection 6 (typography elements to render): ${f.section_6_elements.join(' | ')}`;
      if (f.section_8_avoid?.length) block += `\nSection 8 (negatives — exclude): ${f.section_8_avoid.join(', ')}`;
    }
    const comps = (d.best_performing_compositions as Array<{ composition?: string }> | null)?.map(c => c?.composition).filter(Boolean) ?? [];
    if (comps.length) block += `\nTop compositions: ${comps.slice(0, 2).join(' | ')}`;
    return block;
  }

  async function handleGenerate() {
    if (!brief.trim()) { setError('Enter a brief describing the property or campaign.'); return; }
    setError('');
    setImageUrl(null);
    setImageBase64(null);
    setPhase('writing-prompt');

    const dnaBlock = dna ? buildDNABlock(dna) : 'No DNA yet — apply Indian real estate best practices.';
    const platformGuidance = platform === 'aisensy'
      ? 'AiSensy/WhatsApp: conversational tone, clear CTA, clean layout optimised for mobile viewing'
      : 'Meta Ads Manager: headline ≤40 chars, hook in first line, strong visual hierarchy';

    const systemPrompt = `You are Aanya Mehta, Senior Creative Director for Indian real estate advertising.
Write a 9-section image generation prompt for GPT-Image-1.
Return ONLY the prompt text — no JSON, no headers, no explanation.`;

    const userPrompt = `Project: ${projectName}
Brief: ${brief}
Platform: ${platform === 'meta' ? 'Meta Ads' : 'AiSensy (WhatsApp)'} — ${platformGuidance}
Aspect ratio: ${ratio} (${ratio === '1:1' ? '1080×1080' : ratio === '4:5' ? '1080×1350' : '1080×1920'})

${dnaBlock}

Write the 9-section GPT-Image-1 prompt as flowing prose (500–800 words):
SECTION 1 → scene narrative
SECTION 2 → subject & composition percentages
SECTION 3 → camera lens mm + shot type
SECTION 4 → lighting time + Kelvin + shadow direction
SECTION 5 → color palette with hex codes
SECTION 6 → typography rendered IN the image: property name, price in ₹ (NEVER $), feature list, CTA
SECTION 7 → brand elements
SECTION 8 → negative prompts
SECTION 9 → technical specs for ${ratio} at 1080px

RULES:
- Always ₹/Rs — NEVER $, USD, Dollars
- SECTION 6 text must be rendered inside the image (not CSS overlay)
- Apply DNA constraints exactly as specified`;

    try {
      const promptResult = await aiCall(userPrompt, systemPrompt, 2000, { traceName: 'aanya-memory-generate-from-dna' });
      if (promptResult.error) throw new Error(String(promptResult.error));

      const imagePrompt = ((promptResult as { content?: { type: string; text: string }[] }).content ?? [])
        .filter(b => b.type === 'text').map(b => b.text).join('').trim()
        || (typeof promptResult === 'string' ? promptResult : JSON.stringify(promptResult));

      setPhase('generating');
      const images = await generateImageWithGemini(imagePrompt, ratio);
      const img = images[0];
      setImageBase64(img.base64);
      setImageMime(img.mimeType);
      setImageUrl(`data:${img.mimeType};base64,${img.base64}`);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
      setPhase('error');
    }
  }

  function downloadImage() {
    if (!imageBase64) return;
    const link = document.createElement('a');
    link.href = `data:${imageMime};base64,${imageBase64}`;
    link.download = `aanya-dna-${projectName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.${imageMime.split('/')[1] ?? 'jpg'}`;
    link.click();
  }

  const isGenerating = phase === 'writing-prompt' || phase === 'generating';
  const hasDNA = dna?.dna_summary || dna?.prompt_fragments;

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-text-primary flex items-center gap-2">
        <Zap className="w-4 h-4 text-amber-500" />
        Generate from DNA
      </h3>

      {!hasDNA && (
        <p className="text-sm text-text-secondary">
          Synthesize DNA above first — then generate images that apply your learned brand formula.
        </p>
      )}

      {hasDNA && (
        <>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Property / Campaign Brief</label>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              placeholder={`e.g. "Horizon Heights, Pune — 2BHK from ₹68L, launch offer, rooftop pool, metro nearby"`}
              rows={3}
              className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2 text-text-primary resize-none"
              disabled={isGenerating}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Format</label>
              <div className="flex gap-1">
                {(['1:1', '4:5', '9:16'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setRatio(r)}
                    disabled={isGenerating}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${ratio === r ? 'bg-accent text-white border-accent' : 'bg-surface border-border text-text-secondary hover:border-accent/50'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Platform</label>
              <div className="flex gap-1">
                {([['meta', 'Meta'], ['aisensy', 'WhatsApp']] as const).map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setPlatform(v)}
                    disabled={isGenerating}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${platform === v ? 'bg-accent text-white border-accent' : 'bg-surface border-border text-text-secondary hover:border-accent/50'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !brief.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#18181B', color: '#ffffff' }}
          >
            {phase === 'writing-prompt' && <><Loader2 className="w-4 h-4 animate-spin" /> Writing prompt...</>}
            {phase === 'generating' && <><Loader2 className="w-4 h-4 animate-spin" /> Generating image...</>}
            {(phase === 'idle' || phase === 'done' || phase === 'error') && <><Sparkles className="w-4 h-4" /> Generate from DNA</>}
          </button>

          {imageUrl && (
            <div className="space-y-2">
              <img
                src={imageUrl}
                alt="Generated from DNA"
                className="w-full rounded-lg border border-border object-cover"
                style={{ aspectRatio: ratio === '1:1' ? '1/1' : ratio === '4:5' ? '4/5' : '9/16' }}
              />
              <button
                onClick={downloadImage}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-border text-text-secondary hover:bg-surface-subtle transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download Image
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AanyaMemory() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creatives, setCreatives] = useState<TrainingCreative[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [filterTier, setFilterTier] = useState<PerformanceTier | 'all'>('all');
  const [loadingCreatives, setLoadingCreatives] = useState(true);

  const orgId = getOrgId();

  async function fetchProjects() {
    const { data } = await supabase.from('projects').select('id, name').eq('org_id', orgId).order('name');
    setProjects(data ?? []);
  }

  async function fetchCreatives() {
    setLoadingCreatives(true);
    let q = supabase.from('aanya_training_creatives').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
    if (selectedProject !== 'all') q = q.eq('project_id', selectedProject);
    if (filterTier !== 'all') q = q.eq('performance_tier', filterTier);
    const { data } = await q;
    setCreatives((data ?? []) as TrainingCreative[]);
    setLoadingCreatives(false);
  }

  useEffect(() => { fetchProjects(); }, []);
  useEffect(() => { fetchCreatives(); }, [selectedProject, filterTier]);

  async function deleteCreative(id: string) {
    await supabase.from('aanya_training_creatives').delete().eq('id', id);
    setCreatives(prev => prev.filter(c => c.id !== id));
  }

  const projectForDNA = selectedProject !== 'all' ? projects.find(p => p.id === selectedProject) : null;
  const creativesForDNA = selectedProject !== 'all' ? creatives.filter(c => c.project_id === selectedProject) : creatives;

  const stats = {
    total: creatives.length,
    top: creatives.filter(c => c.performance_tier === 'top_performer').length,
    withAnalysis: creatives.filter(c => c.vision_analysis !== null).length,
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-500" />
            Aanya's Memory
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Train Aanya on real-world creatives. The more she learns, the better she generates.
          </p>
        </div>

        {/* Stats bar */}
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-text-primary">{stats.total}</p>
            <p className="text-xs text-text-muted">Creatives</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">{stats.top}</p>
            <p className="text-xs text-text-muted">Top Performers</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-600">{stats.withAnalysis}</p>
            <p className="text-xs text-text-muted">AI Analysed</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={selectedProject}
          onChange={e => setSelectedProject(e.target.value)}
          className="text-sm bg-surface-card border border-border rounded-lg px-3 py-2 text-text-primary"
        >
          <option value="all">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select
          value={filterTier}
          onChange={e => setFilterTier(e.target.value as PerformanceTier | 'all')}
          className="text-sm bg-surface-card border border-border rounded-lg px-3 py-2 text-text-primary"
        >
          <option value="all">All Tiers</option>
          {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* Crawl Parameters */}
      <CrawlParametersPanel creatives={creatives} selectedProject={selectedProject} projects={projects} />

      {/* 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_300px] gap-6">
        {/* Left: Upload + DNA */}
        <div className="space-y-4">
          <UploadCard projects={projects} onUploaded={fetchCreatives} />
          {(projectForDNA || selectedProject !== 'all') && projects.length > 0 && (
            <DNAPanel
              projectId={projectForDNA?.id ?? projects[0]?.id ?? ''}
              projectName={projectForDNA?.name ?? projects[0]?.name ?? 'All Projects'}
              creatives={creativesForDNA}
              onSynthesized={fetchCreatives}
            />
          )}
          {projectForDNA && (
            <GenerateFromDNAPanel
              projectId={projectForDNA.id}
              projectName={projectForDNA.name}
            />
          )}
          {selectedProject === 'all' && projects.length > 0 && (
            <div className="bg-surface-card border border-border rounded-xl p-4 text-sm text-text-secondary flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              Select a project to synthesize its Design DNA.
            </div>
          )}
        </div>

        {/* Middle + Right: Gallery */}
        <div className="lg:col-span-2">
          {loadingCreatives ? (
            <div className="flex items-center justify-center py-16 text-text-muted gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading training creatives...
            </div>
          ) : creatives.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3 border-2 border-dashed border-border rounded-xl">
              <Brain className="w-10 h-10 text-text-muted" />
              <p className="text-text-secondary font-medium">No training creatives yet</p>
              <p className="text-sm text-text-muted max-w-xs">Upload your best-performing ads and reference images so Aanya can learn your brand's winning formula.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {creatives.map(c => (
                <CreativeCard key={c.id} creative={c} onDelete={deleteCreative} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// src/components/CreativeInputs.tsx
// Two reusable components used by all creative-generation flows:
//   1. QuickReferenceUploader — drag-and-drop ad-hoc reference uploads with intent labels
//   2. LanguageSelector — multi-select language picker with primary/secondary ordering

import { useState, useEffect, useRef } from 'react';

// ============================================================
// 1. QUICK REFERENCE UPLOADER
// ============================================================

export interface QuickReferenceUpload {
  preview_url: string;  // blob URL for <img> thumbnail (revoked on unmount)
  base64: string;       // raw base64 image data (no data: prefix) — passed to Claude Vision
  mimeType: string;     // e.g. 'image/jpeg'
  user_intent: string;
  role_hint?: string;
  filename?: string;
  visual_description?: string;  // filled by Strategy.tsx after Claude Vision analysis
}

const QUICK_REF_ROLES = [
  { value: 'logo', label: 'Logo (use exactly)', hint: 'Place this logo in the creative as-is' },
  { value: 'project_image', label: 'Project image', hint: 'Use as the building/project hero' },
  { value: 'lifestyle_mood', label: 'Lifestyle/mood reference', hint: 'Inspiration only — use mood and palette, not exact elements' },
  { value: 'competitor', label: 'Competitor for differentiation', hint: 'Differentiate FROM this — note its style and produce something distinct' },
  { value: 'amenity', label: 'Amenity image', hint: 'Specific amenity to feature' },
  { value: 'reference_design', label: 'Reference design', hint: 'Design direction inspiration' },
  { value: 'other', label: 'Other (describe below)', hint: '' },
];

export function QuickReferenceUploader({
  onChange,
  maxFiles = 5,
}: {
  onChange: (refs: QuickReferenceUpload[]) => void;
  maxFiles?: number;
}) {
  const [refs, setRefs] = useState<QuickReferenceUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Track blob URLs separately so we can revoke them on unmount
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => { blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u)); };
  }, []);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (refs.length + files.length > maxFiles) {
      setUploadError(`Maximum ${maxFiles} reference images allowed.`);
      return;
    }
    setUploading(true);
    setUploadError(null);
    const newRefs: QuickReferenceUpload[] = [];

    for (const file of Array.from(files)) {
      try {
        const { base64, mimeType } = await readFileAsBase64(file);
        const previewUrl = URL.createObjectURL(file);
        blobUrlsRef.current.push(previewUrl);
        newRefs.push({
          preview_url: previewUrl,
          base64,
          mimeType,
          user_intent: '',
          role_hint: 'reference_design',
          filename: file.name,
        });
      } catch {
        setUploadError(`Could not read ${file.name}`);
      }
    }

    const updated = [...refs, ...newRefs];
    setRefs(updated);
    onChange(updated);
    setUploading(false);
  }

  function readFileAsBase64(file: File): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const [header, base64] = result.split(',');
        const mimeType = header.split(':')[1].split(';')[0];
        resolve({ base64, mimeType });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateRef(index: number, updates: Partial<QuickReferenceUpload>) {
    const updated = refs.map((r, i) => i === index ? { ...r, ...updates } : r);
    setRefs(updated);
    onChange(updated);
  }

  function removeRef(index: number) {
    URL.revokeObjectURL(refs[index].preview_url);
    const updated = refs.filter((_, i) => i !== index);
    setRefs(updated);
    onChange(updated);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-primary">Quick References (optional)</label>
        <span className="text-xs text-text-tertiary">{refs.length}/{maxFiles}</span>
      </div>
      <p className="text-xs text-text-tertiary -mt-2">
        Upload logo, project images, mood references, or competitor designs. Aanya's AI will analyze each image and inject a visual description into her brief.
      </p>

      {refs.length < maxFiles && (
        <label className="block">
          <div className={`border-2 border-dashed rounded p-4 text-center cursor-pointer transition ${uploading ? 'border-brand bg-brand-subtle' : 'border-border hover:border-brand hover:bg-brand-subtle'}`}>
            {uploading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-brand">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Uploading…
              </div>
            ) : (
              <>
                <div className="text-sm text-text-tertiary">Click to upload reference images</div>
                <div className="text-xs text-text-disabled mt-1">PNG, JPG, WEBP — max 10MB each</div>
              </>
            )}
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
            onChange={e => handleUpload(e.target.files)} disabled={uploading} />
        </label>
      )}

      {uploadError && (
        <p className="text-xs text-red-400">{uploadError}</p>
      )}

      {refs.length > 0 && (
        <div className="space-y-2">
          {/* Aanya-will-use banner */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            <p className="text-xs text-emerald-400">
              {refs.length === 1 ? '1 reference uploaded' : `${refs.length} references uploaded`} — Aanya will run Claude Vision analysis on {refs.length === 1 ? 'it' : 'each'} before generating
            </p>
          </div>

          {refs.map((ref, i) => (
            <div key={i} className="flex gap-3 p-3 bg-surface-elevated border border-border rounded">
              <img
                src={ref.preview_url}
                alt={ref.filename ?? 'reference'}
                className="w-16 h-16 object-cover rounded flex-shrink-0"
              />
              <div className="flex-1 space-y-2 min-w-0">
                <div className="flex items-center gap-1.5">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-emerald-400 flex-shrink-0">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                  <span className="text-[10px] text-emerald-400 font-medium truncate">
                    {ref.filename ?? 'image'} · uploaded
                  </span>
                </div>
                <select value={ref.role_hint} onChange={e => updateRef(i, { role_hint: e.target.value })}
                  className="w-full bg-surface-sunken border border-border rounded px-2 py-1 text-xs">
                  {QUICK_REF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <input type="text" value={ref.user_intent}
                  placeholder="What is this for? e.g. 'Use as the project building hero'"
                  onChange={e => updateRef(i, { user_intent: e.target.value })}
                  className="w-full bg-surface-sunken border border-border rounded px-2 py-1 text-xs" />
              </div>
              <button onClick={() => removeRef(i)} className="text-red-400 hover:text-red-300 text-xs flex-shrink-0 self-start pt-0.5">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 2. LANGUAGE SELECTOR
// ============================================================

const LANGUAGE_OPTIONS = [
  { code: 'English', label: 'English', script: 'Latin' },
  { code: 'Odia', label: 'ଓଡ଼ିଆ Odia', script: 'Odia' },
  { code: 'Hindi', label: 'हिन्दी Hindi', script: 'Devanagari' },
  { code: 'Bengali', label: 'বাংলা Bengali', script: 'Bengali' },
];

export function LanguageSelector({
  value,
  onChange,
  defaultLanguages = ['English'],
}: {
  value: string[];
  onChange: (langs: string[]) => void;
  defaultLanguages?: string[];
}) {
  // Initialize with default if empty
  useEffect(() => {
    if (value.length === 0 && defaultLanguages.length > 0) {
      onChange(defaultLanguages);
    }
  }, []);

  function toggle(lang: string) {
    if (value.includes(lang)) {
      // Don't allow empty selection
      if (value.length === 1) return;
      onChange(value.filter(l => l !== lang));
    } else {
      onChange([...value, lang]);
    }
  }

  function moveToFirst(lang: string) {
    if (!value.includes(lang)) return;
    const reordered = [lang, ...value.filter(l => l !== lang)];
    onChange(reordered);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-2">
        Creative Languages
        <span className="text-xs text-text-tertiary ml-2">(first selected = primary, larger size in design)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {LANGUAGE_OPTIONS.map(opt => {
          const selected = value.includes(opt.code);
          const isPrimary = value[0] === opt.code;
          return (
            <button key={opt.code} type="button"
              onClick={() => selected ? moveToFirst(opt.code) : toggle(opt.code)}
              onContextMenu={e => { e.preventDefault(); toggle(opt.code); }}
              className={`px-3 py-2 rounded border text-sm transition ${
                isPrimary ? 'border-brand bg-brand-subtle text-brand-text' :
                selected ? 'border-brand-border bg-brand-subtle text-brand' :
                'border-border text-text-tertiary hover:border-border-strong'
              }`}>
              {isPrimary && '⭐ '}{opt.label}
            </button>
          );
        })}
      </div>
      {value.length > 1 && (
        <p className="text-xs text-text-tertiary mt-2">
          Active languages: {value.join(' → ')} · Click selected language to make it primary · Right-click to deselect
        </p>
      )}
    </div>
  );
}

// ============================================================
// 3. CAMPAIGN GOAL SELECTOR (used in creative inputs)
// ============================================================

export const CAMPAIGN_GOALS = [
  { value: 'lead_generation', label: 'Lead Generation', desc: 'Drive form fills, WhatsApp inquiries', funnel: 'BOFU' },
  { value: 'branding', label: 'Branding', desc: 'Build trust and awareness, no direct sell', funnel: 'TOFU/MOFU' },
  { value: 'awareness', label: 'Awareness', desc: 'Pattern-interrupt, memorable hook', funnel: 'TOFU' },
  { value: 'festive_event', label: 'Festive / Event', desc: 'Festival or company event creative', funnel: 'All' },
  { value: 'engagement', label: 'Engagement', desc: 'Polls, this-or-that, comment-bait (SMM)', funnel: 'SMM' },
  { value: 'milestone', label: 'Milestone', desc: 'Units sold, years completed, achievements', funnel: 'TOFU' },
  { value: 'educational', label: 'Educational', desc: 'Tips, market insights, area guides', funnel: 'TOFU/MOFU' },
];

export function CampaignGoalSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (goal: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-2">Campaign Goal</label>
      <div className="grid grid-cols-2 gap-2">
        {CAMPAIGN_GOALS.map(g => (
          <button key={g.value} type="button" onClick={() => onChange(g.value)}
            className={`text-left p-3 rounded border transition ${
              value === g.value ? 'border-brand bg-brand-subtle' : 'border-border hover:border-border-strong'
            }`}>
            <div className="font-medium text-sm">{g.label}</div>
            <div className="text-xs text-text-tertiary mt-0.5">{g.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// src/components/CreativeInputs.tsx
// Two reusable components used by all creative-generation flows:
//   1. QuickReferenceUploader — drag-and-drop ad-hoc reference uploads with intent labels
//   2. LanguageSelector — multi-select language picker with primary/secondary ordering

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================
// 1. QUICK REFERENCE UPLOADER
// ============================================================

export interface QuickReferenceUpload {
  url: string;
  user_intent: string;
  role_hint?: string;
  filename?: string;
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
  orgId,
  onChange,
  maxFiles = 5,
}: {
  orgId: string;
  onChange: (refs: QuickReferenceUpload[]) => void;
  maxFiles?: number;
}) {
  const [refs, setRefs] = useState<QuickReferenceUpload[]>([]);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (refs.length + files.length > maxFiles) {
      alert(`Maximum ${maxFiles} reference images per generation.`);
      return;
    }

    setUploading(true);
    const newRefs: QuickReferenceUpload[] = [];

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop();
      const filename = `${orgId}/quick_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;

      const { error } = await supabase.storage
        .from('quick-references')
        .upload(filename, file);

      if (error) { console.error(error); continue; }

      const { data: { publicUrl } } = supabase.storage
        .from('quick-references')
        .getPublicUrl(filename);

      newRefs.push({
        url: publicUrl,
        user_intent: '',
        role_hint: 'reference_design',
        filename: file.name,
      });
    }

    const updated = [...refs, ...newRefs];
    setRefs(updated);
    onChange(updated);
    setUploading(false);
  }

  function updateRef(index: number, updates: Partial<QuickReferenceUpload>) {
    const updated = refs.map((r, i) => i === index ? { ...r, ...updates } : r);
    setRefs(updated);
    onChange(updated);
  }

  function removeRef(index: number) {
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
        Upload logo, project images, mood references, or competitor designs. Aanya uses them as designed inputs.
      </p>

      {refs.length < maxFiles && (
        <label className="block">
          <div className="border-2 border-dashed border-border rounded p-4 text-center cursor-pointer hover:border-brand hover:bg-brand-subtle transition">
            <div className="text-sm text-text-tertiary">
              {uploading ? 'Uploading...' : 'Click to upload reference images'}
            </div>
            <div className="text-xs text-text-disabled mt-1">PNG, JPG, WEBP — max 10MB each</div>
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
            onChange={e => handleUpload(e.target.files)} disabled={uploading} />
        </label>
      )}

      {refs.length > 0 && (
        <div className="space-y-2">
          {refs.map((ref, i) => (
            <div key={i} className="flex gap-3 p-3 bg-surface-elevated border border-border rounded">
              <img src={ref.url} alt="" className="w-16 h-16 object-cover rounded" />
              <div className="flex-1 space-y-2">
                <select value={ref.role_hint} onChange={e => updateRef(i, { role_hint: e.target.value })}
                  className="w-full bg-surface-sunken border border-border rounded px-2 py-1 text-xs">
                  {QUICK_REF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <input type="text" value={ref.user_intent} placeholder="What is this image for? (e.g., 'Use as the project hero')"
                  onChange={e => updateRef(i, { user_intent: e.target.value })}
                  className="w-full bg-surface-sunken border border-border rounded px-2 py-1 text-xs" />
              </div>
              <button onClick={() => removeRef(i)} className="text-red-400 hover:text-red-300 text-xs">✕</button>
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

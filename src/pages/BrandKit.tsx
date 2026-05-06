// src/pages/BrandKit.tsx
// Brand Kit configuration — accessible from Settings → Brand Kit
// Uploads logos, sets colors, fonts, tagline, design aesthetic, cultural motifs.
// One brand kit per organization.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface BrandKitData {
  id?: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  text_color: string;
  background_color: string;
  primary_font: string;
  secondary_font: string;
  display_font: string;
  tagline: string;
  brand_voice: string;
  brand_story: string;
  logo_color_url: string;
  logo_white_url: string;
  logo_dark_url: string;
  design_aesthetic: string;
  cultural_motifs: string[];
  reference_brands: string[];
  default_languages: string[];
}

const AESTHETIC_OPTIONS = [
  { value: 'premium_minimal', label: 'Premium Minimal', desc: 'Whitespace, sans-serif, photo-driven (Sobha, DLF Camellias)' },
  { value: 'luxury_opulent', label: 'Luxury Opulent', desc: 'Gold/navy, serif, dramatic (Lodha, Damac)' },
  { value: 'warm_aspirational', label: 'Warm Aspirational', desc: 'Earth tones, lifestyle-led (Mahindra, Brigade)' },
  { value: 'contemporary_urban', label: 'Contemporary Urban', desc: 'Geometric, modern (Godrej Trees, Emaar)' },
  { value: 'custom', label: 'Custom', desc: 'Define your own direction' },
];

const MOTIF_OPTIONS = [
  { value: 'konark_wheel_subtle', label: 'Konark Wheel (subtle watermark)' },
  { value: 'pattachitra', label: 'Pattachitra borders' },
  { value: 'odia_script_accent', label: 'Odia script accents' },
  { value: 'kalinga_motifs', label: 'Kalinga architectural motifs' },
  { value: 'no_motifs', label: 'No cultural motifs (modern only)' },
];

const LANGUAGE_OPTIONS = ['English', 'Odia', 'Hindi', 'Bengali'];

const BRAND_OPTIONS = [
  'Sobha', 'DLF Camellias', 'Phoenix Mills',
  'Lodha Altamount', 'Damac Hills', 'Bukhatir',
  'Mahindra Lifespaces', 'Brigade', 'Tata Housing',
  'Godrej Trees', 'Emaar Beachfront', 'Oberoi 360 West',
];

export default function BrandKit() {
  const [kit, setKit] = useState<BrandKitData>({
    primary_color: '#1A3A5C',
    secondary_color: '#C9A961',
    accent_color: '#D4A574',
    text_color: '#1A1A1A',
    background_color: '#FAFAF7',
    primary_font: 'Inter',
    secondary_font: 'Playfair Display',
    display_font: 'Bebas Neue',
    tagline: '',
    brand_voice: '',
    brand_story: '',
    logo_color_url: '',
    logo_white_url: '',
    logo_dark_url: '',
    design_aesthetic: 'premium_minimal',
    cultural_motifs: [],
    reference_brands: [],
    default_languages: ['English'],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgId, setOrgId] = useState<string>('');
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) { setLoading(false); return; }
    setOrgId(profile.org_id);

    const { data: existingKit } = await supabase
      .from('brand_kits')
      .select('*')
      .eq('org_id', profile.org_id)
      .maybeSingle();

    if (existingKit) {
      setKit({
        ...existingKit,
        cultural_motifs: existingKit.cultural_motifs || [],
        reference_brands: existingKit.reference_brands || [],
        default_languages: existingKit.default_languages || ['English'],
      });
    }
    setLoading(false);
  }

  async function uploadLogo(file: File, slot: 'logo_color_url' | 'logo_white_url' | 'logo_dark_url') {
    if (!orgId) return;
    const ext = file.name.split('.').pop();
    const filename = `${orgId}/${slot}_${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('brand-assets')
      .upload(filename, file, { upsert: true });

    if (upErr) {
      setMessage({ type: 'error', text: `Logo upload failed: ${upErr.message}` });
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('brand-assets')
      .getPublicUrl(filename);

    setKit(prev => ({ ...prev, [slot]: publicUrl }));
    setMessage({ type: 'success', text: `${slot.replace('_url', '').replace('logo_', '').toUpperCase()} logo uploaded` });
  }

  async function save() {
    if (!orgId) return;
    setSaving(true);

    const { error } = await supabase
      .from('brand_kits')
      .upsert({ ...kit, org_id: orgId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });

    if (error) {
      setMessage({ type: 'error', text: `Save failed: ${error.message}` });
    } else {
      setMessage({ type: 'success', text: 'Brand Kit saved. All creative generation now uses these settings.' });
    }
    setSaving(false);
  }

  if (loading) return <div className="p-8 text-text-tertiary">Loading brand kit...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Brand Kit</h1>
        <p className="text-text-tertiary">Configure once. Every creative generation uses these settings to produce on-brand designer-grade output.</p>
      </div>

      {message && (
        <div className={`p-3 rounded ${message.type === 'success' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
          {message.text}
        </div>
      )}

      {/* SECTION 1: LOGOS */}
      <section className="bg-surface-elevated/50 rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">Logos</h2>
        <div className="grid grid-cols-3 gap-4">
          <LogoUpload label="Color Logo" url={kit.logo_color_url} onUpload={(f) => uploadLogo(f, 'logo_color_url')} bg="#FAFAF7" />
          <LogoUpload label="White Logo" url={kit.logo_white_url} onUpload={(f) => uploadLogo(f, 'logo_white_url')} bg="#1A1A1A" />
          <LogoUpload label="Dark/Black Logo" url={kit.logo_dark_url} onUpload={(f) => uploadLogo(f, 'logo_dark_url')} bg="#FAFAF7" />
        </div>
      </section>

      {/* SECTION 2: COLOR PALETTE */}
      <section className="bg-surface-elevated/50 rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">Color Palette</h2>
        <div className="grid grid-cols-5 gap-4">
          <ColorPicker label="Primary" value={kit.primary_color} onChange={v => setKit({...kit, primary_color: v})} />
          <ColorPicker label="Secondary" value={kit.secondary_color} onChange={v => setKit({...kit, secondary_color: v})} />
          <ColorPicker label="Accent" value={kit.accent_color} onChange={v => setKit({...kit, accent_color: v})} />
          <ColorPicker label="Text" value={kit.text_color} onChange={v => setKit({...kit, text_color: v})} />
          <ColorPicker label="Background" value={kit.background_color} onChange={v => setKit({...kit, background_color: v})} />
        </div>
      </section>

      {/* SECTION 3: TYPOGRAPHY */}
      <section className="bg-surface-elevated/50 rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">Typography</h2>
        <div className="grid grid-cols-3 gap-4">
          <FontInput label="Primary Font (body)" value={kit.primary_font} onChange={v => setKit({...kit, primary_font: v})} hint="e.g., Inter, Söhne" />
          <FontInput label="Secondary Font (headlines)" value={kit.secondary_font} onChange={v => setKit({...kit, secondary_font: v})} hint="e.g., Playfair Display" />
          <FontInput label="Display Font (CTAs)" value={kit.display_font} onChange={v => setKit({...kit, display_font: v})} hint="e.g., Bebas Neue" />
        </div>
        <p className="text-xs text-gray-500 mt-2">Use Google Fonts names. Nanobanana renders text styles inspired by these — exact font isn't guaranteed but the style direction will be preserved.</p>
      </section>

      {/* SECTION 4: BRAND VOICE */}
      <section className="bg-surface-elevated/50 rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">Brand Voice</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-tertiary mb-1">Tagline</label>
            <input type="text" value={kit.tagline} onChange={e => setKit({...kit, tagline: e.target.value})}
              placeholder="Building Trust, Crafting Homes"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" />
          </div>
          <div>
            <label className="block text-sm text-text-tertiary mb-1">Brand Voice (1-2 sentences)</label>
            <textarea value={kit.brand_voice} onChange={e => setKit({...kit, brand_voice: e.target.value})}
              placeholder="Premium yet approachable, rooted in Odisha heritage, contemporary in execution"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white h-20" />
          </div>
          <div>
            <label className="block text-sm text-text-tertiary mb-1">Brand Story (optional, 3-5 sentences)</label>
            <textarea value={kit.brand_story} onChange={e => setKit({...kit, brand_story: e.target.value})}
              placeholder="Founded in 2010 in Bhubaneswar, NHCPL has delivered..."
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white h-32" />
          </div>
        </div>
      </section>

      {/* SECTION 5: DESIGN AESTHETIC */}
      <section className="bg-surface-elevated/50 rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">Design Aesthetic</h2>
        <div className="space-y-2">
          {AESTHETIC_OPTIONS.map(opt => (
            <label key={opt.value} className={`block p-3 rounded border cursor-pointer transition ${kit.design_aesthetic === opt.value ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-700 hover:border-gray-600'}`}>
              <input type="radio" name="aesthetic" value={opt.value} checked={kit.design_aesthetic === opt.value}
                onChange={e => setKit({...kit, design_aesthetic: e.target.value})} className="mr-3" />
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs text-text-tertiary ml-2">— {opt.desc}</span>
            </label>
          ))}
        </div>
      </section>

      {/* SECTION 6: CULTURAL MOTIFS */}
      <section className="bg-surface-elevated/50 rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">Cultural Motifs</h2>
        <p className="text-sm text-text-tertiary mb-3">Subtle regional grounding — used as borders, watermarks (5-10% opacity), or background patterns. Never dominant.</p>
        <div className="grid grid-cols-2 gap-2">
          {MOTIF_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={kit.cultural_motifs.includes(opt.value)}
                onChange={e => {
                  const motifs = e.target.checked
                    ? [...kit.cultural_motifs, opt.value]
                    : kit.cultural_motifs.filter(m => m !== opt.value);
                  setKit({...kit, cultural_motifs: motifs});
                }} />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* SECTION 7: REFERENCE BRANDS */}
      <section className="bg-surface-elevated/50 rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">Reference Brands (for visual inspiration)</h2>
        <p className="text-sm text-text-tertiary mb-3">Select 2-4 brands whose creative direction inspires you. Aanya (the AI designer) will reference these aesthetic directions.</p>
        <div className="grid grid-cols-3 gap-2">
          {BRAND_OPTIONS.map(brand => (
            <label key={brand} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={kit.reference_brands.includes(brand)}
                onChange={e => {
                  const brands = e.target.checked
                    ? [...kit.reference_brands, brand]
                    : kit.reference_brands.filter(b => b !== brand);
                  setKit({...kit, reference_brands: brands});
                }} />
              <span className="text-sm">{brand}</span>
            </label>
          ))}
        </div>
      </section>

      {/* SECTION 8: DEFAULT LANGUAGES */}
      <section className="bg-surface-elevated/50 rounded-lg p-6 border border-border">
        <h2 className="text-xl font-semibold mb-4">Default Creative Languages</h2>
        <p className="text-sm text-text-tertiary mb-3">Languages to default to when generating creatives. User can override per-creative.</p>
        <div className="flex gap-3">
          {LANGUAGE_OPTIONS.map(lang => (
            <label key={lang} className={`px-4 py-2 rounded border cursor-pointer transition ${kit.default_languages.includes(lang) ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-700'}`}>
              <input type="checkbox" checked={kit.default_languages.includes(lang)} className="mr-2"
                onChange={e => {
                  const langs = e.target.checked
                    ? [...kit.default_languages, lang]
                    : kit.default_languages.filter(l => l !== lang);
                  setKit({...kit, default_languages: langs.length > 0 ? langs : ['English']});
                }} />
              {lang}
            </label>
          ))}
        </div>
      </section>

      {/* SAVE BAR */}
      <div className="sticky bottom-0 bg-black/95 border-t border-gray-800 p-4 flex justify-end">
        <button onClick={save} disabled={saving}
          className="px-6 py-2 bg-emerald-500 text-black rounded-md font-medium hover:bg-emerald-400 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Brand Kit'}
        </button>
      </div>
    </div>
  );
}

// === Sub-components ===

function LogoUpload({ label, url, onUpload, bg }: { label: string; url?: string; onUpload: (f: File) => void; bg: string }) {
  return (
    <div>
      <label className="block text-sm text-text-tertiary mb-2">{label}</label>
      <div className="aspect-square rounded border-2 border-dashed border-gray-700 flex items-center justify-center relative overflow-hidden" style={{ backgroundColor: bg }}>
        {url ? (
          <img src={url} alt={label} className="max-w-full max-h-full object-contain" />
        ) : (
          <span className="text-gray-500 text-xs">No logo</span>
        )}
      </div>
      <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="mt-2 text-xs"
        onChange={e => e.target.files && onUpload(e.target.files[0])} />
    </div>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-text-tertiary mb-1">{label}</label>
      <div className="flex gap-2 items-center">
        <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-12 h-10 rounded cursor-pointer" />
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-2 text-xs font-mono" />
      </div>
    </div>
  );
}

function FontInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label className="block text-sm text-text-tertiary mb-1">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

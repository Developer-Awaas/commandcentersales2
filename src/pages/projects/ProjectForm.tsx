import { useState } from 'react';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOrgId } from '../../lib/constants';
import { logActivity } from '../../lib/session-logger';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { Card } from '../../components/ui/Card';
import {
  type Project,
  type ProjectConfiguration,
  EMPTY_FORM,
  EMPTY_CONFIG,
  CONFIG_TYPE_OPTIONS,
  deriveFieldsFromConfigs,
  autoCreateConfigFromProject,
} from './types';
import { useToast } from '../../contexts/ToastContext';

interface ProjectFormProps {
  project: Project | null;
  onCancel: () => void;
  onSaved: () => void;
}

type FormData = typeof EMPTY_FORM;

function toForm(p: Project): FormData {
  return {
    name: p.name ?? '',
    code: p.code ?? '',
    locality: p.locality ?? '',
    city: p.city ?? 'Bhubaneswar',
    nearest_landmarks: p.nearest_landmarks ?? '',
    status: p.status ?? 'Upcoming',
    completion_pct: p.completion_pct,
    expected_possession: p.expected_possession ?? '',
    total_units: p.total_units,
    units_remaining: p.units_remaining,
    unit_types: p.unit_types ?? '',
    carpet_area_range: p.carpet_area_range ?? '',
    price_range_lacs: p.price_range_lacs ?? '',
    per_sqft_rate: p.per_sqft_rate,
    usps: p.usps ?? '',
    amenities: p.amenities ?? '',
    target_buyer: p.target_buyer ?? 'End-user',
    priority: p.priority ?? 'Medium',
    budget_segment: p.budget_segment ?? '',
    rera_number: p.rera_number ?? '',
    landing_page_url: p.landing_page_url ?? '',
    brochure_url: p.brochure_url ?? '',
    whatsapp_flow: p.whatsapp_flow ?? '',
    notes: p.notes ?? '',
    meta_ad_account_id: p.meta_ad_account_id ?? '',
    configurations: autoCreateConfigFromProject(p),
    price_history: p.price_history ?? [],
  };
}

const STATUS_OPTIONS = [
  { value: 'Upcoming', label: 'Upcoming' },
  { value: 'Under Construction', label: 'Under Construction' },
  { value: 'Ready to Move', label: 'Ready to Move' },
];

const TARGET_OPTIONS = [
  { value: 'End-user', label: 'End-user' },
  { value: 'Investor', label: 'Investor' },
  { value: 'Both', label: 'Both' },
];

const PRIORITY_OPTIONS = [
  { value: 'High', label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low', label: 'Low' },
];

const CONFIG_TYPE_SELECT_OPTIONS = CONFIG_TYPE_OPTIONS.map((t) => ({ value: t, label: t }));

function ConfigRow({
  config,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  config: ProjectConfiguration;
  index: number;
  onChange: (idx: number, field: keyof ProjectConfiguration, value: unknown) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}) {
  return (
    <div className="grid gap-3 p-4 rounded-lg border border-border bg-surface relative">
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-1">
          <Select
            label="Type"
            options={CONFIG_TYPE_SELECT_OPTIONS}
            value={config.type}
            onChange={(e) => onChange(index, 'type', e.target.value)}
          />
        </div>
        <div className="col-span-1">
          <Input
            label="Carpet Area"
            value={config.carpet}
            onChange={(e) => onChange(index, 'carpet', e.target.value)}
            placeholder="e.g. 850 sqft"
          />
        </div>
        <div className="col-span-1">
          <Input
            label="Price (₹ Lacs)"
            value={config.price_lacs}
            onChange={(e) => onChange(index, 'price_lacs', e.target.value)}
            placeholder="e.g. 62"
          />
        </div>
        <div className="col-span-1">
          <Input
            label="Total Units"
            type="number"
            min={0}
            value={config.total_units ?? ''}
            onChange={(e) => onChange(index, 'total_units', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="e.g. 6"
          />
        </div>
        <div className="col-span-1">
          <Input
            label="Remaining"
            type="number"
            min={0}
            value={config.remaining_units ?? ''}
            onChange={(e) => onChange(index, 'remaining_units', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="e.g. 2"
          />
        </div>
        <div className="col-span-1 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Available</label>
          <button
            type="button"
            onClick={() => onChange(index, 'available', !config.available)}
            className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
              config.available
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {config.available ? 'Available' : 'Sold Out'}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-5">
          <Input
            label="Notes (optional)"
            value={config.notes}
            onChange={(e) => onChange(index, 'notes', e.target.value)}
            placeholder='e.g. "Last 2 left", "Sold out"'
          />
        </div>
        {canRemove && (
          <div className="col-span-1 flex items-end pb-0.5">
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all text-xs w-full justify-center"
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectForm({ project, onCancel, onSaved }: ProjectFormProps) {
  const { showToast } = useToast();
  const isEdit = project !== null;
  const [form, setForm] = useState<FormData>(isEdit ? toForm(project!) : { ...EMPTY_FORM, configurations: [{ ...EMPTY_CONFIG }] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof FormData, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function numOrNull(val: string): number | null {
    const n = Number(val);
    return val === '' || isNaN(n) ? null : n;
  }

  function updateConfig(idx: number, field: keyof ProjectConfiguration, value: unknown) {
    setForm((prev) => {
      const configs = [...(prev.configurations ?? [])];
      configs[idx] = { ...configs[idx], [field]: value };
      const derived = deriveFieldsFromConfigs(configs);
      return { ...prev, configurations: configs, ...derived };
    });
  }

  function addConfig() {
    setForm((prev) => ({
      ...prev,
      configurations: [...(prev.configurations ?? []), { ...EMPTY_CONFIG }],
    }));
  }

  function removeConfig(idx: number) {
    setForm((prev) => {
      const configs = (prev.configurations ?? []).filter((_, i) => i !== idx);
      const derived = deriveFieldsFromConfigs(configs);
      return { ...prev, configurations: configs, ...derived };
    });
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError('Project name is required.');
      return;
    }
    if (!form.configurations || form.configurations.length === 0) {
      setError('At least one configuration is required.');
      return;
    }
    setError(null);
    setSaving(true);

    const derived = deriveFieldsFromConfigs(form.configurations);
    const rawMetaId = (form.meta_ad_account_id ?? '').trim();
    const normalizedMetaId = rawMetaId && !rawMetaId.startsWith('act_') ? `act_${rawMetaId}` : rawMetaId;
    const payload = {
      ...form,
      ...derived,
      meta_ad_account_id: normalizedMetaId || null,
      updated_at: new Date().toISOString(),
    };

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from('projects').update({ ...payload, org_id: getOrgId() }).eq('id', project!.id));
    } else {
      ({ error: err } = await supabase.from('projects').insert({ ...payload, is_active: true, org_id: getOrgId() }));
    }

    setSaving(false);
    if (err) {
      setError(err.message);
      showToast('Failed to save project', 'error');
    } else {
      logActivity(supabase, {
        action: isEdit ? 'edited_project' : 'created_project',
        entityType: 'project',
        details: { name: form.name, city: form.city },
      });
      showToast('Project saved successfully!', 'success');
      onSaved();
    }
  }

  const configs = form.configurations ?? [];

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={16} />
            Cancel
          </button>
          <h1 className="text-xl font-semibold text-text-primary">
            {isEdit ? 'Edit Project' : 'Add Project'}
          </h1>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save size={15} />
          {saving ? 'Saving…' : 'Save Project'}
        </Button>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-950/40 border border-red-800/40 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6 max-w-5xl">
        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Project Name *"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Sunrise Heights"
          />
          <Input
            label="Project Code"
            value={form.code ?? ''}
            onChange={(e) => set('code', e.target.value)}
            placeholder="e.g. SH-001"
          />
          <Input
            label="Locality"
            value={form.locality ?? ''}
            onChange={(e) => set('locality', e.target.value)}
            placeholder="e.g. Patia"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Input
            label="City"
            value={form.city ?? ''}
            onChange={(e) => set('city', e.target.value)}
            placeholder="e.g. Bhubaneswar"
          />
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={form.status ?? 'Upcoming'}
            onChange={(e) => set('status', e.target.value)}
          />
          <Input
            label="Completion %"
            type="number"
            min={0}
            max={100}
            value={form.completion_pct ?? ''}
            onChange={(e) => set('completion_pct', numOrNull(e.target.value))}
            placeholder="e.g. 65"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Expected Possession"
            value={form.expected_possession ?? ''}
            onChange={(e) => set('expected_possession', e.target.value)}
            placeholder="e.g. Dec 2025"
          />
          <Input
            label="Nearest Landmarks"
            value={form.nearest_landmarks ?? ''}
            onChange={(e) => set('nearest_landmarks', e.target.value)}
            placeholder="e.g. Near KIIT, 2km from NH-16"
          />
        </div>

        {/* Configurations */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-text-primary">Configurations</p>
              <p className="text-xs text-text-tertiary mt-0.5">Add each unit type with its pricing and availability</p>
            </div>
            <button
              type="button"
              onClick={addConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-subtle border border-brand-border text-sm text-brand-text hover:bg-brand-subtle-hover transition-all"
            >
              <Plus size={13} />
              Add Configuration
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {configs.map((cfg, idx) => (
              <ConfigRow
                key={idx}
                config={cfg}
                index={idx}
                onChange={updateConfig}
                onRemove={removeConfig}
                canRemove={configs.length > 1}
              />
            ))}
          </div>
          {configs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-3 text-xs text-text-tertiary">
              <span>Types: <span className="text-text-primary">{form.unit_types || '—'}</span></span>
              <span>Total units: <span className="text-text-primary">{form.total_units ?? '—'}</span> · Remaining: <span className="text-text-primary">{form.units_remaining ?? '—'}</span></span>
              <span>Price range: <span className="text-text-primary">{form.price_range_lacs ? `₹${form.price_range_lacs}L` : '—'}</span></span>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Textarea
            label="USPs (comma-separated)"
            value={form.usps ?? ''}
            onChange={(e) => set('usps', e.target.value)}
            placeholder="e.g. Rooftop Garden, Club House, 24/7 Security"
            rows={3}
          />
          <Textarea
            label="Amenities (comma-separated)"
            value={form.amenities ?? ''}
            onChange={(e) => set('amenities', e.target.value)}
            placeholder="e.g. Swimming Pool, Gym, Parking"
            rows={3}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Select
            label="Target Buyer"
            options={TARGET_OPTIONS}
            value={form.target_buyer ?? 'End-user'}
            onChange={(e) => set('target_buyer', e.target.value)}
          />
          <Select
            label="Priority"
            options={PRIORITY_OPTIONS}
            value={form.priority ?? 'Medium'}
            onChange={(e) => set('priority', e.target.value)}
          />
          <Input
            label="Budget Segment"
            value={form.budget_segment ?? ''}
            onChange={(e) => set('budget_segment', e.target.value)}
            placeholder="e.g. Affordable, Premium"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Input
            label="RERA Number"
            value={form.rera_number ?? ''}
            onChange={(e) => set('rera_number', e.target.value)}
            placeholder="e.g. RP/01/2024/…"
          />
          <Input
            label="Landing Page URL"
            type="url"
            value={form.landing_page_url ?? ''}
            onChange={(e) => set('landing_page_url', e.target.value)}
            placeholder="https://…"
          />
          <Input
            label="Brochure URL"
            type="url"
            value={form.brochure_url ?? ''}
            onChange={(e) => set('brochure_url', e.target.value)}
            placeholder="https://…"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="WhatsApp Flow"
            type="url"
            value={form.whatsapp_flow ?? ''}
            onChange={(e) => set('whatsapp_flow', e.target.value)}
            placeholder="https://…"
          />
        </div>

        <Card className="p-5">
          <p className="text-sm font-semibold text-text-primary mb-0.5">Meta Ads Integration</p>
          <p className="text-xs text-text-tertiary mb-4">
            Ad account running campaigns for this project. Overrides the org-level account for metric sync.
            Access token is shared — set it once in <strong>Settings → Meta Ads Integration</strong>.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Ad Account ID</label>
            <p className="text-[11px] text-text-tertiary -mt-0.5">
              Format: <code className="bg-surface-sunken px-1 rounded">act_123456789</code> — find it in Meta Business Manager → Ad Accounts. Leave blank to use the org-level account.
            </p>
            <input
              type="text"
              value={form.meta_ad_account_id ?? ''}
              onChange={(e) => set('meta_ad_account_id', e.target.value)}
              placeholder="act_123456789"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
            />
          </div>
        </Card>

        <Textarea
          label="Notes"
          value={form.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Internal notes about this project…"
          rows={4}
        />
      </div>
    </div>
  );
}

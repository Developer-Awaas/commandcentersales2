import { useEffect, useRef, useState } from 'react';
import { X, Upload } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { Spinner } from '../../components/ui/Spinner';
import {
  CampaignGoalSelector,
  LanguageSelector,
  QuickReferenceUploader,
} from '../../components/CreativeInputs';
import { type QuickGenerateInputs, type StrategyProject } from './types';

const OBJECTIVE_OPTIONS = [
  { value: 'Lead Generation', label: 'Lead Generation' },
  { value: 'Branding', label: 'Branding' },
  { value: 'Awareness', label: 'Awareness' },
  { value: 'Retargeting', label: 'Retargeting' },
  { value: 'Offer/Discount', label: 'Offer / Discount' },
  { value: 'Event/Launch', label: 'Event / Launch' },
  { value: 'Site Visit Drive', label: 'Site Visit Drive' },
];

const AD_PLATFORM_OPTIONS = [
  { value: 'AiSensy', label: 'AiSensy' },
  { value: 'Meta Ads Manager', label: 'Meta Ads Manager' },
];

interface QuickGenerateFormProps {
  projects: StrategyProject[];
  projectsLoading: boolean;
  inputs: QuickGenerateInputs;
  onChange: (inputs: QuickGenerateInputs) => void;
  orgId: string;
  brandKitDefaultLanguages?: string[];
}

export function QuickGenerateForm({
  projects,
  projectsLoading,
  inputs,
  onChange,
  orgId,
  brandKitDefaultLanguages,
}: QuickGenerateFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!inputs.referenceImage) { setReferencePreviewUrl(null); return; }
    const url = URL.createObjectURL(inputs.referenceImage);
    setReferencePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [inputs.referenceImage]);

  function set<K extends keyof QuickGenerateInputs>(key: K, value: QuickGenerateInputs[K]) {
    onChange({ ...inputs, [key]: value });
  }

  function setCustom<K extends keyof QuickGenerateInputs['customProject']>(
    key: K,
    value: string
  ) {
    onChange({ ...inputs, customProject: { ...inputs.customProject, [key]: value } });
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    set('referenceImage', file);
  }

  function removeImage() {
    set('referenceImage', null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const projectOptions = [
    ...projects.map((p) => ({ value: p.id, label: p.name })),
    { value: 'custom', label: 'Custom Project' },
  ];

  const isCustom = inputs.projectId === 'custom';
  const isMeta = inputs.adPlatform.toLowerCase().includes('meta');

  return (
    <div className="flex flex-col gap-5">
      {/* Project selector */}
      <Card className="p-5 flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Project</p>
        {projectsLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Spinner size="sm" />
            <span className="text-xs text-text-tertiary">Loading projects…</span>
          </div>
        ) : (
          <Select
            label="Project"
            options={projectOptions}
            value={inputs.projectId}
            onChange={(e) => set('projectId', e.target.value)}
          />
        )}

        {isCustom && (
          <div className="flex flex-col gap-3 pt-1 border-t border-border">
            <Input
              label="Project Name"
              value={inputs.customProject.name}
              onChange={(e) => setCustom('name', e.target.value)}
              placeholder="e.g. Sunrise Heights"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Locality"
                value={inputs.customProject.locality}
                onChange={(e) => setCustom('locality', e.target.value)}
                placeholder="e.g. Patia"
              />
              <Input
                label="City"
                value={inputs.customProject.city}
                onChange={(e) => setCustom('city', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Price (Lacs)"
                value={inputs.customProject.price}
                onChange={(e) => setCustom('price', e.target.value)}
                placeholder="e.g. 45–75"
              />
              <Input
                label="Units Left"
                type="number"
                min={0}
                value={inputs.customProject.unitsLeft}
                onChange={(e) => setCustom('unitsLeft', e.target.value)}
                placeholder="e.g. 8"
              />
              <Input
                label="Type"
                value={inputs.customProject.type}
                onChange={(e) => setCustom('type', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide block mb-1.5">USPs</label>
              <textarea
                rows={2}
                value={inputs.customProject.usps}
                onChange={(e) => setCustom('usps', e.target.value)}
                placeholder="e.g. Rooftop Garden, Premium Clubhouse"
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors resize-y"
              />
            </div>
          </div>
        )}
      </Card>

      {/* Campaign Goal — senior designer input */}
      <CampaignGoalSelector
        value={inputs.campaignGoal}
        onChange={(v) => set('campaignGoal', v)}
      />

      {/* Creative Brief */}
      <Card className="p-5">
        <label className="text-xs font-semibold uppercase tracking-widest text-text-tertiary block mb-3">
          Creative Brief
        </label>
        <textarea
          rows={3}
          value={inputs.prompt}
          onChange={(e) => set('prompt', e.target.value)}
          placeholder="e.g. Launch creative for The Zenith — 8 premium 3BHK units in Nayapalli. Drive WhatsApp inquiries from professionals 30–50 looking for their forever home."
          className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors resize-y min-h-[80px]"
        />
      </Card>

      {/* Platform selectors */}
      <div className="grid grid-cols-2 gap-5">
        <Card className="p-5 flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Platform & Objective</p>
          <Select
            label="Ad Platform"
            options={AD_PLATFORM_OPTIONS}
            value={inputs.adPlatform}
            onChange={(e) => set('adPlatform', e.target.value)}
          />
          {isMeta && (
            <Select
              label="Objective"
              options={OBJECTIVE_OPTIONS}
              value={inputs.objective}
              onChange={(e) => set('objective', e.target.value)}
            />
          )}
        </Card>

        <Card className="p-5 flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Reference Image</p>
          {inputs.referenceImage ? (
            <div className="flex items-center gap-3">
              <img
                src={referencePreviewUrl ?? ''}
                alt="Reference"
                className="w-16 h-16 object-cover rounded-lg border border-border"
              />
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-primary truncate max-w-[140px]">{inputs.referenceImage.name}</span>
                <button
                  onClick={removeImage}
                  className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  <X size={12} /> Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-5 rounded-lg border border-dashed border-border hover:border-brand-border hover:bg-brand-subtle transition-all"
            >
              <Upload size={16} className="text-text-tertiary" />
              <span className="text-xs text-text-tertiary">Click to upload image</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
          />
        </Card>
      </div>

      {/* Language Selector */}
      <LanguageSelector
        value={inputs.languages}
        onChange={(v) => set('languages', v)}
        defaultLanguages={brandKitDefaultLanguages}
      />

      {/* Quick Reference Uploader */}
      <QuickReferenceUploader
        orgId={orgId}
        onChange={(refs) => set('quickRefs', refs)}
        maxFiles={5}
      />

      {/* Competitor Analysis */}
      <Card className="p-5">
        <Textarea
          label="Competitor Analysis"
          rows={2}
          value={inputs.competitorAnalysis}
          onChange={(e) => set('competitorAnalysis', e.target.value)}
          placeholder="Paste competitor FB page URLs, company names, or ad descriptions. AI will differentiate your ad."
        />
      </Card>
    </div>
  );
}

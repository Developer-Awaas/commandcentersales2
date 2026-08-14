import { AD_PLATFORM_OPTIONS, type AdPlatform } from '../../lib/ad-platform';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ProjectMediaPicker } from '../../components/ProjectMediaPicker';
import { getOrgId } from '../../lib/constants';
import { supabase } from '../../lib/supabase';
import { analyzeReferenceZones } from '../../lib/ai-service';
import { autoMatchSlots, buildDefaultSlots, orderPhotoPanels, replicateCaptionState, type MediaTile, type PanelSlot, type PhotoPanel } from '../../lib/reference-style';
import PhotoPanelAssigner, { type MediaOption } from './PhotoPanelAssigner';
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

interface QuickGenerateFormProps {
  projects: StrategyProject[];
  projectsLoading: boolean;
  inputs: QuickGenerateInputs;
  onChange: (inputs: QuickGenerateInputs) => void;
  brandKitDefaultLanguages?: string[];
}

export function QuickGenerateForm({
  projects,
  projectsLoading,
  inputs,
  onChange,
  brandKitDefaultLanguages,
}: QuickGenerateFormProps) {
  function set<K extends keyof QuickGenerateInputs>(key: K, value: QuickGenerateInputs[K]) {
    onChange({ ...inputs, [key]: value });
  }

  function setCustom<K extends keyof QuickGenerateInputs['customProject']>(
    key: K,
    value: string
  ) {
    onChange({ ...inputs, customProject: { ...inputs.customProject, [key]: value } });
  }

  const projectOptions = [
    ...projects.map((p) => ({ value: p.id, label: p.name })),
    { value: 'custom', label: 'Custom Project' },
  ];

  const isCustom = inputs.projectId === 'custom';
  const isMeta = inputs.adPlatform === 'meta';
  // Replicate mode is active when a reference carries the Style-reference role.
  const replicateActive = inputs.quickRefs.some((r) => r.role_hint === 'replicate_creative');
  const replicateRef = inputs.quickRefs.find((r) => r.role_hint === 'replicate_creative');

  // The detection effect fires on the reference's id only, so it must not close
  // over a stale `inputs` when it merges its result back.
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const [detecting, setDetecting] = useState(false);
  const analyzedIdRef = useRef<string | null>(null);
  const [projectMedia, setProjectMedia] = useState<{ id: string; url: string; label: string; assetType: string }[]>([]);

  // V5 STEP 1 — panel detection runs ONCE per reference, here at upload time
  // rather than at submit, because the assignment UI has to exist before the
  // user can press Generate. The result (zones AND panels) is cached into
  // inputs so Strategy.tsx reuses it instead of making a second vision call.
  useEffect(() => {
    if (!replicateRef) {
      analyzedIdRef.current = null;
      if (inputsRef.current.referencePanels) {
        onChange({ ...inputsRef.current, referencePanels: undefined, referenceZones: undefined, panelSlots: undefined });
      }
      return;
    }
    if (analyzedIdRef.current === replicateRef.id) return;
    analyzedIdRef.current = replicateRef.id;

    let cancelled = false;
    (async () => {
      setDetecting(true);
      try {
        const res = await analyzeReferenceZones({ base64: replicateRef.base64, mimeType: replicateRef.mimeType });
        if (cancelled) return;
        const panels = res?.photoPanels ?? [];
        onChange({
          ...inputsRef.current,
          referencePanels: panels,
          referenceZones: res?.zones,
          panelSlots: panels.length ? buildDefaultSlots(panels) : undefined,
        });
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replicateRef?.id]);

  // Assignable media = the project photos the user actually selected above.
  useEffect(() => {
    if (isCustom || !inputs.projectId) { setProjectMedia([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('project_assets')
        .select('id, asset_url, asset_type')
        .eq('project_id', inputs.projectId);
      if (cancelled) return;
      setProjectMedia(
        ((data ?? []) as { id: string; asset_url?: string; asset_type?: string }[])
          .filter((r) => !!r.asset_url)
          .map((r) => ({
            id: r.id,
            url: r.asset_url as string,
            label: (r.asset_type ?? 'photo').replace(/_/g, ' '),
            assetType: r.asset_type ?? 'other',
          })),
      );
    })();
    return () => { cancelled = true; };
  }, [inputs.projectId, isCustom]);

  const mediaOptions: MediaOption[] = useMemo(
    () => projectMedia.filter((m) => inputs.projectMediaIds.includes(m.id)),
    [projectMedia, inputs.projectMediaIds],
  );

  const panels = inputs.referencePanels ?? [];
  const showAssigner = replicateActive && panels.length >= 2;
  // Note: inputs.referencePanels (not `panels`) — [] after a run that found
  // nothing is a real answer, undefined before the run is not.
  const captionState = replicateCaptionState(inputs.referencePanels, detecting);

  const mediaTiles: MediaTile[] = useMemo(
    () => projectMedia
      .filter((m) => inputs.projectMediaIds.includes(m.id))
      // label rides along: tile text is free-form ('Rooftop pool') and is
      // often the only place the amenity is actually named.
      .map((m) => ({ id: m.id, url: m.url, assetType: m.assetType, label: m.label })),
    [projectMedia, inputs.projectMediaIds],
  );

  // P2.13 — label auto-match. Each detected section is pre-bound to the project
  // photo whose asset_type matches the section's content_hint ("swimming pool"
  // → amenity_pool). Runs whenever the panel set or the selection changes, and
  // never overwrites a slot the user set by hand (autoMatchSlots takes prior).
  //
  // A section with no confident match stays 'unassigned' rather than taking
  // whatever is left over: the gate below is only worth having if a decided
  // slot means someone actually decided it.
  const matchKey = `${panels.map((p) => `${p.index}:${p.contentHint ?? ''}`).join('|')}__${mediaTiles.map((t) => t.id).join(',')}`;
  const lastMatchRef = useRef<string>('');
  useEffect(() => {
    if (!showAssigner) return;
    if (lastMatchRef.current === matchKey) return;
    lastMatchRef.current = matchKey;
    const prior = inputsRef.current.panelSlots ?? [];
    const next = autoMatchSlots(panels, mediaTiles, null, prior);
    if (JSON.stringify(next) === JSON.stringify(prior)) return;
    onChange({ ...inputsRef.current, panelSlots: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, showAssigner]);

  /** Tile dropdown → slots. `null` releases whatever section the photo held. */
  function handleAssignSection(assetUrl: string, panelIndex: number | null) {
    const prior = inputs.panelSlots ?? buildDefaultSlots(panels);
    onChange({
      ...inputs,
      panelSlots: prior.map((s) => {
        // One photo fills at most one section — moving it releases the old one.
        if (s.source === 'media' && s.mediaUrl === assetUrl && s.panelIndex !== panelIndex) {
          return { panelIndex: s.panelIndex, source: 'unassigned' as const };
        }
        if (s.panelIndex === panelIndex) {
          // No `suggested` — the user chose this one, so it must stop being
          // badged as inferred.
          return { panelIndex: s.panelIndex, source: 'media' as const, mediaUrl: assetUrl };
        }
        return s;
      }),
    });
  }

  /** Stepper: grow with synthetic panels, shrink from the end. Slots follow. */
  function handleCountChange(next: number) {
    const current = inputs.referencePanels ?? [];
    let resized: PhotoPanel[];
    if (next < current.length) {
      resized = current.slice(0, next);
    } else {
      const extra: PhotoPanel[] = Array.from({ length: next - current.length }, (_, i) => ({
        index: current.length + i + 1,
        // Placed bottom-centre; the user knows the real position, the model is
        // told by slot number, and an approximate badge beats a missing slot.
        bbox: [0.35, 0.82, 0.3, 0.12] as [number, number, number, number],
        shapeHint: 'rect' as const,
        approxArea: 0.036,
      }));
      resized = [...current, ...extra];
    }
    const ordered = orderPhotoPanels(resized);
    const prior = inputs.panelSlots ?? [];
    onChange({
      ...inputs,
      referencePanels: ordered,
      panelSlots: ordered.map((p) => prior.find((s) => s.panelIndex === p.index) ?? { panelIndex: p.index, source: 'unassigned' as const }),
    });
  }

  function handleSlotChange(panelIndex: number, next: PanelSlot) {
    const prior = inputs.panelSlots ?? buildDefaultSlots(panels);
    onChange({
      ...inputs,
      // Only one panel can hold the hero — rebinding it elsewhere releases the old one.
      panelSlots: prior.map((s) => {
        if (s.panelIndex === panelIndex) return next;
        if (next.source === 'hero' && s.source === 'hero') return { ...s, source: 'unassigned' as const };
        return s;
      }),
    });
  }

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
      <Card className="p-5 flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Platform & Objective</p>
        <Select
          label="Ad Platform"
          options={AD_PLATFORM_OPTIONS}
          value={inputs.adPlatform}
          onChange={(e) => set('adPlatform', e.target.value as AdPlatform)}
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

      {/* Language Selector */}
      <LanguageSelector
        value={inputs.languages}
        onChange={(v) => set('languages', v)}
        defaultLanguages={brandKitDefaultLanguages}
      />

      {/* Reference images — real project photos + ad-hoc uploads for Aanya to ground the creative in */}
      <Card className="p-5 flex flex-col gap-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Reference Images</p>
        {!isCustom && inputs.projectId ? (
          <ProjectMediaPicker
            projectId={inputs.projectId}
            orgId={getOrgId()}
            selectedIds={inputs.projectMediaIds}
            onChange={(ids) => set('projectMediaIds', ids)}
            heroId={inputs.heroRefKey}
            onSetHero={(id) => set('heroRefKey', id)}
            panels={showAssigner ? panels : undefined}
            slots={showAssigner ? (inputs.panelSlots ?? buildDefaultSlots(panels)) : undefined}
            onAssignSection={showAssigner ? handleAssignSection : undefined}
          />
        ) : (
          <p className="text-xs text-text-disabled">Select a saved project above to pick from its uploaded photos.</p>
        )}
        <div className="pt-1 border-t border-border">
          <QuickReferenceUploader
            onChange={(refs) => set('quickRefs', refs)}
            heroId={inputs.heroRefKey}
            onSetHero={(id) => set('heroRefKey', id)}
            allowStyleReference
          />
        </div>
        {/* Mode-aware captions: the "exact photo, enhanced" promise is only true
            in hero-edit mode; in replicate mode the hero is placed INTO the
            copied layout, so show the replicate caption instead (Fix 2). */}
        {inputs.heroRefKey && !replicateActive && (
          <p className="text-xs text-amber-400 -mt-2">★ Hero image marked — the generated creative will be this exact photo, enhanced (quality/mood only), not a reimagined scene.</p>
        )}
        {replicateActive && (
          <>
            <p className="text-xs text-sky-400 -mt-2">⧉ Replicate mode — layout copied from the style reference; this hero appears as the building. Produces one image at the reference's aspect ratio. Assign a project photo the ★ Hero role above.</p>

            {/* P2.13 PART B — detection-aware. The previous copy promised that
                the user's photos "replace the reference's OTHER photo zones"
                and nudged them to select more, on every reference including
                ones with no other photo zones at all: a false description of
                what the run will do, plus a nudge for photos with nowhere to
                go. Each state now says only what is true for it. */}
            {captionState === 'pending' && (
              <p className="text-[11px] text-text-tertiary -mt-1 flex items-center gap-2">
                {detecting && <Spinner size="sm" />}
                Aanya analyses the reference’s layout and photo sections after upload.
              </p>
            )}

            {captionState === 'single' && (
              // No mention of other photo zones, and deliberately no amber nudge.
              <p className="text-[11px] text-text-tertiary -mt-1">★ Hero anchors the <strong>building at its photographed angle</strong> (one photo → locked to that angle; several exterior photos → best-fitting view, never invents unseen sides). The reference’s layout and styling are replicated around it.</p>
            )}

            {captionState === 'multi' && (
              // The inline tile assignment below replaces what the old block
              // spent three sentences explaining, so one pointer is enough.
              <p className="text-[11px] text-text-tertiary -mt-1">★ Hero anchors the <strong>main building</strong>. <strong>Assign your photos to the numbered sections below</strong> — the reference’s own photos are never kept, and any section left empty becomes a blank design block.</p>
            )}
            {/* V5 STEP 2 — per-panel assignment. Only for multi-panel references;
                single-panel/none leaves the previous flow exactly as it was. */}
            {showAssigner && replicateRef && (
              <PhotoPanelAssigner
                previewUrl={replicateRef.preview_url}
                panels={panels}
                slots={inputs.panelSlots ?? buildDefaultSlots(panels)}
                mediaOptions={mediaOptions}
                onCountChange={handleCountChange}
                onSlotChange={handleSlotChange}
              />
            )}
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer -mt-1">
              <input
                type="checkbox"
                checked={!!inputs.textOverlayMode}
                onChange={(e) => set('textOverlayMode', e.target.checked)}
                className="rounded border-border"
              />
              <span>🧩 Blank template mode <strong>(off by default)</strong> — the AI leaves the design text-free; you compose the text in <strong>Edit Text</strong>. Nothing is auto-placed: every essential (name, headline, price, contact) arrives as a pre-filled suggestion chip you tap to place and drag. Leave this <strong>unchecked</strong> for the default AI-designed creative (the model bakes the full, polished design including text).</span>
            </label>
          </>
        )}
      </Card>

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

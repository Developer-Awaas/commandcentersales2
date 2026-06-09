import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOrgId, getUserId } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';
import { downloadImage } from '../lib/image-utils';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';
import {
  Check, X, RefreshCw, Download, ChevronLeft, ChevronRight,
  ExternalLink, Maximize2, ImageIcon, Layers,
} from 'lucide-react';
import { AdobeExpressModal } from './AdobeExpressModal';
import { CanvaConnectButton } from './CanvaConnectButton';

export interface CreativeAsset {
  id: string;
  org_id: string;
  campaign_id: string | null;
  funnel_stage: string;
  angle: string;
  image_url: string;
  edited_image_url: string | null;
  storage_path: string;
  prompt_used: string | null;
  status: string;
  canva_edit_url: string | null;
  editor_used: string | null;
  created_at: string;
}

interface CreativeViewerProps {
  orgId?: string;
  campaignId: string;
  funnelStage: string;
  brandKit?: {
    primaryColor: string;
    accentColor: string;
    photographyStyle: string;
    typographyStyle: string;
  };
  projectContext?: {
    name: string;
    city: string;
    type: string;
    description: string;
    targetBuyer: string;
    adFormat: string;
  };
}

const ANGLES = ['lifestyle', 'architecture', 'amenity'] as const;

const STATUS_COLORS: Record<string, string> = {
  generating: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  generated: 'bg-brand-subtle text-brand border-brand-border',
  editing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  edited: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  approved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
};

function AngleBadge({ angle }: { angle: string }) {
  return (
    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium border border-border bg-surface text-text-tertiary capitalize">
      {angle}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border capitalize ${STATUS_COLORS[status] ?? STATUS_COLORS.generated}`}>
      {status}
    </span>
  );
}

function SkeletonCard() {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="w-full aspect-square bg-surface-sunken animate-pulse" />
      <div className="p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="h-5 w-20 rounded-md bg-surface-sunken animate-pulse" />
          <div className="h-5 w-16 rounded-md bg-surface-sunken animate-pulse" />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-7 rounded-lg bg-surface-sunken animate-pulse" />
          ))}
        </div>
      </div>
    </Card>
  );
}

interface CreativeCardProps {
  asset: CreativeAsset;
  onAction: (assetId: string, action: string) => void;
  onOpenLightbox: (asset: CreativeAsset) => void;
  loadingAction: string | null;
}

function CreativeCard({ asset, onAction, onOpenLightbox, loadingAction }: CreativeCardProps) {
  const displayUrl = asset.edited_image_url ?? asset.image_url;
  const isLoading = (action: string) => loadingAction === `${asset.id}-${action}`;

  return (
    <Card className="flex flex-col overflow-hidden">
      {/* Image */}
      <div
        className="relative w-full aspect-square overflow-hidden cursor-pointer group bg-surface-sunken"
        onClick={() => onOpenLightbox(asset)}
      >
        <img
          src={displayUrl}
          alt={`${asset.angle} creative`}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
          <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        </div>
      </div>

      {/* Card body */}
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <AngleBadge angle={asset.angle} />
          <StatusBadge status={asset.status} />
          {asset.editor_used && (
            <span className="text-[10px] text-text-tertiary capitalize">{asset.editor_used}</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => onAction(asset.id, 'approve')}
            disabled={asset.status === 'approved' || !!loadingAction}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading('approve') ? <Spinner size="sm" /> : <Check size={11} />}
            Approve
          </button>

          <button
            onClick={() => onAction(asset.id, 'reject')}
            disabled={asset.status === 'rejected' || !!loadingAction}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-border text-text-tertiary text-[10px] font-medium hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading('reject') ? <Spinner size="sm" /> : <X size={11} />}
            Reject
          </button>

          <button
            onClick={() => onAction(asset.id, 'regenerate')}
            disabled={!!loadingAction}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium hover:bg-amber-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading('regenerate') ? <Spinner size="sm" /> : <RefreshCw size={11} />}
            Regen
          </button>

          <button
            onClick={() => onAction(asset.id, 'canva')}
            disabled={!!loadingAction}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-medium hover:bg-teal-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading('canva') ? <Spinner size="sm" /> : <ExternalLink size={11} />}
            Canva
          </button>

          <button
            onClick={() => onAction(asset.id, 'adobe')}
            disabled={!!loadingAction}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-400 text-[10px] font-medium hover:bg-purple-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading('adobe') ? <Spinner size="sm" /> : <Layers size={11} />}
            Adobe
          </button>

          <button
            onClick={() => downloadImage(displayUrl, `creative-${asset.angle}-${asset.funnel_stage}.jpg`)}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-border text-text-tertiary text-[10px] font-medium hover:text-text-primary hover:border-border-strong transition-all"
          >
            <Download size={11} />
            Download
          </button>
        </div>
      </div>
    </Card>
  );
}

interface LightboxProps {
  assets: CreativeAsset[];
  initialIndex: number;
  onClose: () => void;
  onAction: (assetId: string, action: string) => void;
}

function CreativeLightbox({ assets, initialIndex, onClose, onAction }: LightboxProps) {
  const [idx, setIdx] = useState(initialIndex);
  const [showPrompt, setShowPrompt] = useState(false);
  const asset = assets[idx];
  const displayUrl = asset?.edited_image_url ?? asset?.image_url;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(assets.length - 1, i + 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assets.length, onClose]);

  if (!asset) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col max-w-3xl w-full bg-surface-elevated border border-border rounded-2xl overflow-hidden shadow-modal max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <AngleBadge angle={asset.angle} />
            <StatusBadge status={asset.status} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">{idx + 1} / {assets.length}</span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-all">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="relative flex-1 flex items-center justify-center bg-surface-sunken min-h-0 overflow-hidden">
          <img src={displayUrl} alt={asset.angle} className="max-h-[50vh] max-w-full object-contain" />

          {idx > 0 && (
            <button
              onClick={() => setIdx(idx - 1)}
              className="absolute left-3 p-2 rounded-xl bg-surface-elevated border border-border text-text-tertiary hover:text-text-primary transition-all"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {idx < assets.length - 1 && (
            <button
              onClick={() => setIdx(idx + 1)}
              className="absolute right-3 p-2 rounded-xl bg-surface-elevated border border-border text-text-tertiary hover:text-text-primary transition-all"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        {/* Prompt (collapsible) */}
        {asset.prompt_used && (
          <div className="px-5 py-3 border-t border-border flex-shrink-0">
            <button
              onClick={() => setShowPrompt((v) => !v)}
              className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1.5"
            >
              <ImageIcon size={11} />
              {showPrompt ? 'Hide prompt' : 'Show prompt'}
            </button>
            {showPrompt && (
              <pre className="mt-2 text-[10px] text-text-tertiary font-mono leading-relaxed whitespace-pre-wrap bg-surface-sunken rounded-lg p-3 border border-border max-h-28 overflow-y-auto">
                {asset.prompt_used}
              </pre>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-2 flex-wrap flex-shrink-0">
          <button
            onClick={() => onAction(asset.id, 'approve')}
            disabled={asset.status === 'approved'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-40"
          >
            <Check size={12} /> Approve
          </button>
          <button
            onClick={() => onAction(asset.id, 'reject')}
            disabled={asset.status === 'rejected'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-tertiary text-xs font-medium hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
          >
            <X size={12} /> Reject
          </button>
          <button
            onClick={() => onAction(asset.id, 'canva')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-medium hover:bg-teal-500/20 transition-all"
          >
            <ExternalLink size={12} /> Edit in Canva
          </button>
          <button
            onClick={() => onAction(asset.id, 'adobe')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium hover:bg-purple-500/20 transition-all"
          >
            <Layers size={12} /> Edit in Adobe Express
          </button>
          <button
            onClick={() => downloadImage(displayUrl ?? '', `creative-${asset.angle}.jpg`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-tertiary text-xs font-medium hover:text-text-primary transition-all"
          >
            <Download size={12} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}

export function CreativeViewer({ orgId, campaignId, funnelStage, brandKit, projectContext }: CreativeViewerProps) {
  const resolvedOrgId = orgId ?? getOrgId();
  const { showToast } = useToast();
  const [assets, setAssets] = useState<CreativeAsset[]>([]);
  const [generating, setGenerating] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<{ assets: CreativeAsset[]; index: number } | null>(null);
  const [adobeAsset, setAdobeAsset] = useState<CreativeAsset | null>(null);
  const [showCanvaConnect, setShowCanvaConnect] = useState(false);
  const [pendingCanvaAssetId, setPendingCanvaAssetId] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const loadAssets = useCallback(async () => {
    const { data } = await supabase
      .from('creative_assets')
      .select('*')
      .eq('org_id', resolvedOrgId)
      .eq('funnel_stage', funnelStage)
      .order('created_at', { ascending: true });
    if (campaignId) {
      setAssets(((data ?? []) as CreativeAsset[]).filter((a) => a.campaign_id === campaignId));
    } else {
      setAssets((data ?? []) as CreativeAsset[]);
    }
  }, [resolvedOrgId, campaignId, funnelStage]);

  useEffect(() => {
    loadAssets();

    channelRef.current = supabase
      .channel(`creative-viewer-${resolvedOrgId}-${funnelStage}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'creative_assets', filter: `org_id=eq.${resolvedOrgId}` },
        (payload) => {
          const updated = payload.new as CreativeAsset;
          if (!updated?.id) { loadAssets(); return; }
          if (updated.funnel_stage !== funnelStage) return;
          if (campaignId && updated.campaign_id !== campaignId) return;

          setAssets((prev) => {
            const idx = prev.findIndex((a) => a.id === updated.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updated;
              return next;
            }
            return [...prev, updated];
          });
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [loadAssets, resolvedOrgId, funnelStage, campaignId]);

  async function handleGenerate() {
    if (!projectContext || !brandKit) {
      showToast('Project context and brand kit required to generate creatives.', 'error');
      return;
    }
    setGenerating(true);

    // Insert placeholder rows to show skeletons
    const placeholders = ANGLES.map((angle) => ({
      id: `placeholder-${angle}`,
      org_id: resolvedOrgId,
      campaign_id: campaignId || null,
      funnel_stage: funnelStage,
      angle,
      image_url: '',
      edited_image_url: null,
      storage_path: '',
      prompt_used: null,
      status: 'generating',
      canva_edit_url: null,
      editor_used: null,
      created_at: new Date().toISOString(),
    } as CreativeAsset));
    setAssets(placeholders);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-creatives`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          orgId: resolvedOrgId,
          campaignId: campaignId ?? null,
          funnelStage,
          brandKit,
          projectContext,
        }),
      });
      const json = await res.json() as { success: boolean; assets: CreativeAsset[]; errors: string[] };
      if (json.errors?.length) {
        showToast(`${json.assets.length}/3 images generated. Some failed.`, 'error');
      } else {
        showToast('3 creatives generated!', 'success');
      }
      // Realtime will update the cards; reload as fallback
      await loadAssets();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Generation failed', 'error');
      setAssets([]);
    }
    setGenerating(false);
  }

  async function handleAction(assetId: string, action: string) {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    setLoadingAction(`${assetId}-${action}`);

    try {
      if (action === 'approve') {
        await supabase.from('creative_assets').update({
          status: 'approved',
          approved_by: getUserId(),
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', assetId);
        setAssets((prev) => prev.map((a) => a.id === assetId ? { ...a, status: 'approved' } : a));
        showToast('Creative approved!', 'success');
      } else if (action === 'reject') {
        await supabase.from('creative_assets').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', assetId);
        setAssets((prev) => prev.map((a) => a.id === assetId ? { ...a, status: 'rejected' } : a));
        showToast('Creative rejected.', 'error');
      } else if (action === 'regenerate') {
        if (!projectContext || !brandKit) { showToast('Project context required', 'error'); return; }
        // Delete old asset and regenerate this angle
        await supabase.from('creative_assets').delete().eq('id', assetId);
        setAssets((prev) => prev.map((a) => a.id === assetId ? { ...a, status: 'generating', image_url: '' } : a));

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const res = await fetch(`${supabaseUrl}/functions/v1/generate-creatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify({ orgId: resolvedOrgId, campaignId, funnelStage, brandKit, projectContext }),
        });
        const json = await res.json() as { assets: CreativeAsset[] };
        const match = json.assets.find((a) => a.angle === asset.angle);
        if (match) {
          setAssets((prev) => prev.map((a) => a.id === assetId ? match : a));
        }
        showToast('Regenerated!', 'success');
      } else if (action === 'canva') {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const res = await fetch(`${supabaseUrl}/functions/v1/canva-open-editor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify({ creativeAssetId: assetId, userId: getUserId() }),
        });
        const json = await res.json() as { needsAuth?: boolean; authUrl?: string; editUrl?: string; error?: string };
        if (json.needsAuth) {
          setPendingCanvaAssetId(assetId);
          setShowCanvaConnect(true);
        } else if (json.editUrl) {
          window.open(json.editUrl, '_blank');
          setAssets((prev) => prev.map((a) => a.id === assetId ? { ...a, status: 'editing' } : a));
        } else if (json.error) {
          showToast(json.error, 'error');
        }
      } else if (action === 'adobe') {
        setAdobeAsset(asset);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    }
    setLoadingAction(null);
  }

  function handleAdobeSave(editedUrl: string) {
    if (!adobeAsset) return;
    setAssets((prev) => prev.map((a) =>
      a.id === adobeAsset.id ? { ...a, edited_image_url: editedUrl, status: 'edited', editor_used: 'adobe_express' } : a
    ));
    setAdobeAsset(null);
    showToast('Adobe Express edit saved!', 'success');
  }

  const realAssets = assets.filter((a) => a.status !== 'generating' && a.image_url);
  const skeletonCount = assets.filter((a) => a.status === 'generating').length;
  const hasAssets = realAssets.length > 0 || skeletonCount > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">AI-Generated Creatives</p>
          <p className="text-xs text-text-tertiary mt-0.5 capitalize">{funnelStage} stage · 3 visual angles</p>
        </div>
        {!hasAssets && (
          <Button onClick={handleGenerate} disabled={generating} size="md">
            {generating ? <Spinner size="sm" /> : <ImageIcon size={14} />}
            {generating ? 'Generating…' : 'Generate Creatives'}
          </Button>
        )}
        {hasAssets && (
          <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={generating}>
            {generating ? <Spinner size="sm" /> : <RefreshCw size={12} />}
            Regenerate All
          </Button>
        )}
      </div>

      {/* Canva connect overlay */}
      {showCanvaConnect && (
        <div className="p-4 rounded-xl border border-teal-500/20 bg-teal-500/10">
          <p className="text-sm text-teal-300 mb-3">Connect your Canva account to edit this creative.</p>
          <CanvaConnectButton
            userId={getUserId()}
            onConnected={() => {
              setShowCanvaConnect(false);
              if (pendingCanvaAssetId) handleAction(pendingCanvaAssetId, 'canva');
            }}
          />
        </div>
      )}

      {/* Grid: 3 columns */}
      {!hasAssets ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-dashed border-border text-center gap-3">
          <ImageIcon size={32} className="text-text-disabled" />
          <p className="text-sm text-text-tertiary">No creatives generated yet.</p>
          <p className="text-xs text-text-tertiary">Click "Generate Creatives" to create 3 AI images.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {ANGLES.map((angle) => {
            const asset = realAssets.find((a) => a.angle === angle);
            const isGenerating = assets.some((a) => a.angle === angle && a.status === 'generating');
            if (isGenerating || (!asset && generating)) return <SkeletonCard key={angle} />;
            if (!asset) return null;
            return (
              <CreativeCard
                key={asset.id}
                asset={asset}
                onAction={handleAction}
                onOpenLightbox={(a) => setLightboxAsset({ assets: realAssets, index: realAssets.indexOf(a) })}
                loadingAction={loadingAction}
              />
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightboxAsset && (
        <CreativeLightbox
          assets={lightboxAsset.assets}
          initialIndex={lightboxAsset.index}
          onClose={() => setLightboxAsset(null)}
          onAction={(id, action) => { setLightboxAsset(null); handleAction(id, action); }}
        />
      )}

      {/* Adobe Express Modal */}
      {adobeAsset && (
        <AdobeExpressModal
          imageUrl={adobeAsset.edited_image_url ?? adobeAsset.image_url}
          assetId={adobeAsset.id}
          orgId={resolvedOrgId}
          onSave={handleAdobeSave}
          onClose={() => setAdobeAsset(null)}
        />
      )}
    </div>
  );
}

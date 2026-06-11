// BACKLOG: Deprecate organizations.brand_colors in favor of brand_kits table.
// Settings should redirect users to the Brand Kit page for color management.
// brand_colors field kept for now to avoid breaking existing prompt-builders that read it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, X, Plus, CheckCircle, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';

import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../contexts/ToastContext';

interface OrgData {
  name: string;
  brand_colors: string;
  tone_of_voice: string;
  whatsapp_number: string;
  primary_city: string;
  secondary_city: string;
  fb_page_url: string;
  ig_page_url: string;
  default_age_range: string;
}

interface Competitor {
  id: string;
  name: string;
}

const DEFAULT_ORG: OrgData = {
  name: '',
  brand_colors: '#1B4332, #2DD4A8, #FFFFFF',
  tone_of_voice: 'Professional & Premium',
  whatsapp_number: '',
  primary_city: 'Bhubaneswar',
  secondary_city: 'Cuttack',
  fb_page_url: '',
  ig_page_url: '',
  default_age_range: '28-50',
};

const DEFAULT_COMPETITORS = [
  'Harshpriya',
  'Utkal',
  'Z Estates',
  'Acrerise (Metro Group)',
  'Falcon',
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">
      {children}
    </p>
  );
}

export function SettingsPage() {
  const { showToast } = useToast();
  const [org, setOrg] = useState<OrgData>(DEFAULT_ORG);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgSaving, setOrgSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [compLoading, setCompLoading] = useState(true);
  const [newCompName, setNewCompName] = useState('');
  const [addingComp, setAddingComp] = useState(false);

  // Meta Ads Integration
  const [metaIntegrationId, setMetaIntegrationId] = useState<string | null>(null);
  const [metaAccountId, setMetaAccountId] = useState('');
  const [metaToken, setMetaToken] = useState('');
  const [showMetaToken, setShowMetaToken] = useState(false);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaSyncing, setMetaSyncing] = useState(false);
  const [metaLastSync, setMetaLastSync] = useState<string | null>(null);
  const [metaSyncMsg, setMetaSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    loadOrg();
    loadCompetitors();
    loadMetaIntegration();
  }, []);

  async function loadMetaIntegration() {
    setMetaLoading(true);
    const { data } = await supabase
      .from('org_integrations')
      .select('id,meta_ad_account_id,meta_access_token,last_sync_at')
      .eq('org_id', getOrgId())
      .eq('provider', 'meta')
      .maybeSingle();
    if (data) {
      setMetaIntegrationId(data.id ?? null);
      setMetaAccountId(data.meta_ad_account_id ?? '');
      setMetaToken(data.meta_access_token ?? '');
      setMetaLastSync(data.last_sync_at ?? null);
    }
    setMetaLoading(false);
  }

  async function saveMetaIntegration() {
    setMetaSaving(true);
    const payload = {
      org_id: getOrgId(),
      provider: 'meta',
      meta_ad_account_id: metaAccountId.trim(),
      meta_access_token: metaToken.trim(),
      is_active: !!(metaAccountId.trim() && metaToken.trim()),
    };
    if (metaIntegrationId) {
      await supabase.from('org_integrations').update(payload).eq('id', metaIntegrationId);
    } else {
      const { data } = await supabase.from('org_integrations').insert(payload).select('id').single();
      if (data) setMetaIntegrationId(data.id);
    }
    setMetaSaving(false);
    setMetaSyncMsg('Integration saved.');
    setTimeout(() => setMetaSyncMsg(null), 3000);
  }

  async function triggerMetaSync() {
    setMetaSyncing(true);
    setMetaSyncMsg(null);
    try {
      const { error } = await supabase.functions.invoke('meta-insights-sync', { body: {} });
      if (error) {
        setMetaSyncMsg('Sync failed: ' + error.message);
      } else {
        setMetaSyncMsg('Sync triggered — check Analyzer in ~30 seconds.');
        await loadMetaIntegration();
      }
    } catch (err: unknown) {
      setMetaSyncMsg('Sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    setMetaSyncing(false);
    setTimeout(() => setMetaSyncMsg(null), 8000);
  }

  async function loadOrg() {
    setOrgLoading(true);
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', getOrgId())
      .maybeSingle();
    if (data) {
      setOrg({
        name: data.name ?? '',
        brand_colors: data.brand_colors ?? DEFAULT_ORG.brand_colors,
        tone_of_voice: data.tone_of_voice ?? DEFAULT_ORG.tone_of_voice,
        whatsapp_number: data.whatsapp_number ?? '',
        primary_city: data.primary_city ?? DEFAULT_ORG.primary_city,
        secondary_city: data.secondary_city ?? DEFAULT_ORG.secondary_city,
        fb_page_url: data.fb_page_url ?? '',
        ig_page_url: data.ig_page_url ?? '',
        default_age_range: data.default_age_range ?? DEFAULT_ORG.default_age_range,
      });
    }
    setOrgLoading(false);
  }

  async function loadCompetitors() {
    setCompLoading(true);
    const { data } = await supabase
      .from('competitors')
      .select('id,name')
      .eq('org_id', getOrgId())
      .order('created_at');
    const list = (data ?? []) as Competitor[];
    if (list.length === 0) {
      await seedDefaultCompetitors();
    } else {
      setCompetitors(list);
    }
    setCompLoading(false);
  }

  async function seedDefaultCompetitors() {
    const inserts = DEFAULT_COMPETITORS.map((name) => ({ org_id: getOrgId(), name }));
    const { data } = await supabase
      .from('competitors')
      .upsert(inserts, { onConflict: 'org_id,name', ignoreDuplicates: true })
      .select('id,name');
    setCompetitors((data ?? []) as Competitor[]);
  }

  const saveOrg = useCallback(
    async (values: OrgData) => {
      setOrgSaving(true);
      await supabase.from('organizations').update(values).eq('id', getOrgId());
      setOrgSaving(false);
      showToast('Settings saved!', 'success');
    },
    [showToast]
  );

  function handleOrgChange(key: keyof OrgData, value: string) {
    const updated = { ...org, [key]: value };
    setOrg(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveOrg(updated), 1000);
  }

  async function addCompetitor() {
    const name = newCompName.trim();
    if (!name) return;
    if (competitors.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      showToast('Competitor already exists.', 'error');
      return;
    }
    setAddingComp(true);
    const { data } = await supabase
      .from('competitors')
      .insert({ org_id: getOrgId(), name })
      .select('id,name')
      .single();
    if (data) setCompetitors((prev) => [...prev, data as Competitor]);
    setNewCompName('');
    setAddingComp(false);
  }

  async function deleteCompetitor(id: string) {
    setCompetitors((prev) => prev.filter((c) => c.id !== id));
    await supabase.from('competitors').delete().eq('id', id).eq('org_id', getOrgId());
  }

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center gap-3 mb-7">
        <Settings size={20} className="text-brand" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Settings</h1>
          <p className="text-text-tertiary text-xs mt-0.5">Configure brand, competitors, and API connections</p>
        </div>
      </div>

      <div className="flex flex-col gap-6 max-w-3xl">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>Brand</SectionLabel>
            {orgSaving && (
              <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                <Spinner size="sm" />
                Saving…
              </div>
            )}
          </div>
          {orgLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading…</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Company Name"
                value={org.name}
                onChange={(e) => handleOrgChange('name', e.target.value)}
                placeholder="Neelachala Homes"
              />
              <div className="flex flex-col gap-1">
                <Input
                  label="Brand Colors"
                  value={org.brand_colors}
                  onChange={(e) => handleOrgChange('brand_colors', e.target.value)}
                  placeholder="#1B4332, #2DD4A8, #FFFFFF"
                />
                <p className="text-[10px] text-amber-500/80 leading-snug">
                  Note: Brand colors used by AI creative generation are managed in Brand Kit. This field is legacy and will be removed in a future update.
                </p>
              </div>
              <Input
                label="Tone of Voice"
                value={org.tone_of_voice}
                onChange={(e) => handleOrgChange('tone_of_voice', e.target.value)}
                placeholder="Professional & Premium"
              />
              <Input
                label="WhatsApp Number"
                value={org.whatsapp_number}
                onChange={(e) => handleOrgChange('whatsapp_number', e.target.value)}
                placeholder="+91 9876543210"
              />
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>Social & Targeting</SectionLabel>
            {orgSaving && (
              <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                <Spinner size="sm" />
                Saving…
              </div>
            )}
          </div>
          {orgLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading…</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Primary City"
                value={org.primary_city}
                onChange={(e) => handleOrgChange('primary_city', e.target.value)}
                placeholder="Bhubaneswar"
              />
              <Input
                label="Secondary City"
                value={org.secondary_city}
                onChange={(e) => handleOrgChange('secondary_city', e.target.value)}
                placeholder="Cuttack"
              />
              <Input
                label="Facebook Page URL"
                value={org.fb_page_url}
                onChange={(e) => handleOrgChange('fb_page_url', e.target.value)}
                placeholder="https://facebook.com/page"
              />
              <Input
                label="Instagram Page URL"
                value={org.ig_page_url}
                onChange={(e) => handleOrgChange('ig_page_url', e.target.value)}
                placeholder="https://instagram.com/page"
              />
              <Input
                label="Default Age Range"
                value={org.default_age_range}
                onChange={(e) => handleOrgChange('default_age_range', e.target.value)}
                placeholder="28-50"
              />
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>Competitors ({competitors.length})</SectionLabel>
          </div>
          {compLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading…</span>
            </div>
          ) : (
            <>
              {competitors.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {competitors.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-sunken border border-border text-sm text-text-primary"
                    >
                      {c.name}
                      <button
                        onClick={() => deleteCompetitor(c.id)}
                        className="text-text-tertiary hover:text-red-400 transition-colors ml-0.5"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Add competitor name…"
                  value={newCompName}
                  onChange={(e) => setNewCompName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCompetitor()}
                  className="flex-1"
                />
                <button
                  onClick={addCompetitor}
                  disabled={addingComp || !newCompName.trim()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-subtle border border-brand-border text-brand text-sm font-medium hover:bg-brand-subtle-hover disabled:opacity-40 transition-all"
                >
                  {addingComp ? <Spinner size="sm" /> : <Plus size={13} />}
                  Add
                </button>
              </div>
            </>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>Meta Ads Integration</SectionLabel>
            {metaLastSync && (
              <span className="text-[10px] text-text-tertiary">Last synced: {new Date(metaLastSync).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
          <p className="text-[11px] text-text-tertiary leading-relaxed mb-4">
            Enter your Meta Ad Account ID and a long-lived access token. Once saved, click <strong>Sync Now</strong> to pull campaign metrics immediately, or they auto-refresh every 15 minutes via scheduled job.
          </p>
          {metaLoading ? (
            <div className="flex items-center gap-2 py-3">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading…</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Ad Account ID</label>
                <p className="text-[11px] text-text-tertiary -mt-0.5">Format: <code className="bg-surface-sunken px-1 rounded">act_123456789</code> — find it in Meta Business Manager → Ad Accounts</p>
                <input
                  type="text"
                  value={metaAccountId}
                  onChange={(e) => setMetaAccountId(e.target.value)}
                  placeholder="act_123456789"
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Access Token</label>
                <p className="text-[11px] text-text-tertiary -mt-0.5">Long-lived user or system access token with <code className="bg-surface-sunken px-1 rounded">ads_read</code> permission</p>
                <div className="relative">
                  <input
                    type={showMetaToken ? 'text' : 'password'}
                    value={metaToken}
                    onChange={(e) => setMetaToken(e.target.value)}
                    placeholder="EAAxxxxxxx…"
                    className="w-full bg-surface border border-border rounded-lg pl-3 pr-9 py-2 text-sm text-text-primary focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMetaToken((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
                  >
                    {showMetaToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={saveMetaIntegration}
                  disabled={metaSaving || (!metaAccountId.trim() && !metaToken.trim())}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-subtle border border-brand-border text-brand text-sm font-medium hover:bg-brand-subtle-hover disabled:opacity-40 transition-all"
                >
                  {metaSaving ? <Spinner size="sm" /> : <CheckCircle size={13} />}
                  {metaSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={triggerMetaSync}
                  disabled={metaSyncing || !metaAccountId.trim() || !metaToken.trim()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border text-text-tertiary hover:text-text-primary hover:border-brand-border text-sm transition-all disabled:opacity-40"
                >
                  {metaSyncing ? <Spinner size="sm" /> : <RefreshCw size={13} />}
                  {metaSyncing ? 'Syncing…' : 'Sync Now'}
                </button>
              </div>
              {metaSyncMsg && (
                <p className="text-xs text-brand">{metaSyncMsg}</p>
              )}
              {metaAccountId && metaToken && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle size={12} />
                  Integration configured — auto-sync active
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

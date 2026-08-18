// BACKLOG: Deprecate organizations.brand_colors in favor of brand_kits table.
// Settings should redirect users to the Brand Kit page for color management.
// brand_colors field kept for now to avoid breaking existing prompt-builders that read it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, X, Plus, CheckCircle, Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
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
  ig_follower_target: number | null;
  ig_reach_target: number | null;
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
  ig_follower_target: null,
  ig_reach_target: null,
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
  const [metaAccountId, setMetaAccountId] = useState('');
  const [metaToken, setMetaToken] = useState('');
  // RB-MO — provenance surfaced in the UI. A connection you cannot attribute
  // to an app is what let a dead-app token sit here looking healthy for a
  // month; the answer now has a place on screen.
  const [metaAppIdRow, setMetaAppIdRow] = useState<string | null>(null);
  const [metaScopes, setMetaScopes] = useState<string[] | null>(null);
  const [metaTokenExp, setMetaTokenExp] = useState<string | null>(null);
  const [metaVerifiedAt, setMetaVerifiedAt] = useState<string | null>(null);
  const [showAdvancedMeta, setShowAdvancedMeta] = useState(false);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [showMetaToken, setShowMetaToken] = useState(false);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaSyncing, setMetaSyncing] = useState(false);
  const [metaLastSync, setMetaLastSync] = useState<string | null>(null);
  const [metaSyncMsg, setMetaSyncMsg] = useState<string | null>(null);
  const [showMetaSetup, setShowMetaSetup] = useState(false);

  useEffect(() => {
    loadOrg();
    loadCompetitors();
    loadMetaIntegration();
  }, []);

  async function loadMetaIntegration() {
    setMetaLoading(true);
    const { data } = await supabase
      .from('org_integrations')
      .select('id,meta_ad_account_id,meta_access_token,last_sync_at,meta_app_id,meta_granted_scopes,token_expires_at,meta_verified_at')
      .eq('org_id', getOrgId())
      .eq('provider', 'meta')
      .maybeSingle();
    if (data) {
      setMetaAccountId(data.meta_ad_account_id ?? '');
      setMetaToken(data.meta_access_token ?? '');
      setMetaLastSync(data.last_sync_at ?? null);
      setMetaAppIdRow((data as { meta_app_id?: string | null }).meta_app_id ?? null);
      setMetaScopes((data as { meta_granted_scopes?: string[] | null }).meta_granted_scopes ?? null);
      setMetaTokenExp((data as { token_expires_at?: string | null }).token_expires_at ?? null);
      setMetaVerifiedAt((data as { meta_verified_at?: string | null }).meta_verified_at ?? null);
    }
    setMetaLoading(false);
  }

  // RB-MO STEP 4 — the paste path no longer writes org_integrations directly.
  // /debug_token needs the app secret, which cannot reach the browser, so the
  // only place a token can be verified is server-side. meta-token-connect is
  // that door: it rejects dead or foreign-app tokens before anything is
  // stored, which is precisely what nothing did before.
  async function saveMetaIntegration() {
    setMetaSaving(true);
    setMetaSyncMsg(null);
    const rawId = metaAccountId.trim();
    // Meta requires act_<numeric_id> — normalize silently so bare IDs work.
    const normalizedId = rawId && !rawId.startsWith('act_') ? `act_${rawId}` : rawId;
    try {
      const { data, error } = await supabase.functions.invoke('meta-token-connect', {
        body: { token: metaToken.trim(), adAccountId: normalizedId },
      });
      const res = (data ?? {}) as {
        ok?: boolean; error?: string; appId?: string; grantedScopes?: string[];
        expiresAt?: string | null; adAccountId?: string | null;
      };
      if (error || !res.ok) {
        // Surface Meta's own words — "Application has been deleted" is a far
        // more actionable message than "save failed".
        setMetaSyncMsg(`Rejected: ${res.error ?? error?.message ?? 'token could not be verified'}`);
        return;
      }
      setMetaAppIdRow(res.appId ?? null);
      setMetaScopes(res.grantedScopes ?? null);
      setMetaTokenExp(res.expiresAt ?? null);
      setMetaVerifiedAt(new Date().toISOString());
      if (res.adAccountId) setMetaAccountId(res.adAccountId);
      else setMetaAccountId(normalizedId);
      setMetaSyncMsg('Token verified and saved.');
      await loadMetaIntegration();
    } finally {
      setMetaSaving(false);
      setTimeout(() => setMetaSyncMsg(null), 6000);
    }
  }

  // OAuth entry point. The tab is opened SYNCHRONOUSLY on the click, before
  // any await — the same user-activation rule the Canva flow had to learn the
  // hard way (bug #45d): opening it after the await gets silently blocked.
  async function connectMetaOAuth() {
    const tab = window.open('', '_blank');
    setMetaConnecting(true);
    setMetaSyncMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('meta-oauth-start', {
        body: { returnUrl: window.location.href },
      });
      const res = (data ?? {}) as { authUrl?: string; error?: string };
      if (error || !res.authUrl) {
        tab?.close();
        setMetaSyncMsg(`Could not start Facebook connect: ${res.error ?? error?.message ?? 'unknown error'}`);
        return;
      }
      if (tab) tab.location.href = res.authUrl;
      else window.location.href = res.authUrl; // popup blocked — same-window fallback
    } finally {
      setMetaConnecting(false);
    }
  }

  async function triggerMetaSync() {
    setMetaSyncing(true);
    setMetaSyncMsg(null);
    try {
      // meta-sync-now, NOT meta-insights-sync: the latter is cron-shaped with
      // no CORS headers, so this call never survived the browser preflight —
      // and because it also has no method check, the preflight itself ran a
      // full all-org sweep. See meta-sync-now's header.
      const { data, error } = await supabase.functions.invoke('meta-sync-now', { body: {} });
      if (error) {
        setMetaSyncMsg('Sync failed: ' + error.message);
      } else {
        // The function returns 200 even when an org fails — check per-org results.
        type SyncResult = { org_id: string; status: string; error?: string };
        const results: SyncResult[] = (data as { results?: SyncResult[] })?.results ?? [];
        const failed = results.find((r) => r.status === 'error');
        if (failed) {
          setMetaSyncMsg('Sync failed: ' + (failed.error ?? 'Unknown error'));
        } else {
          setMetaSyncMsg('Sync triggered — check Analyzer in ~30 seconds.');
          await loadMetaIntegration();
        }
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
        ig_follower_target: data.ig_follower_target ?? null,
        ig_reach_target: data.ig_reach_target ?? null,
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

  // Numeric variant for the follower/reach targets (CC-P4 Step 4).
  function handleOrgNumberChange(key: 'ig_follower_target' | 'ig_reach_target', value: string) {
    const updated = { ...org, [key]: value === '' ? null : parseInt(value) || null };
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
                label="Instagram Follower Target"
                type="number"
                value={org.ig_follower_target?.toString() ?? ''}
                onChange={(e) => handleOrgNumberChange('ig_follower_target', e.target.value)}
                placeholder="e.g. 10000"
              />
              <Input
                label="Instagram Avg Reach Target"
                type="number"
                value={org.ig_reach_target?.toString() ?? ''}
                onChange={(e) => handleOrgNumberChange('ig_reach_target', e.target.value)}
                placeholder="e.g. 5000"
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
          <p className="text-[11px] text-text-tertiary leading-relaxed mb-3">
            Connect your Facebook account to grant access to your Pages, Instagram accounts, and ad accounts. Campaign metrics then refresh automatically every 15 minutes.
          </p>

          {/* Setup guide */}
          <div className="mb-4 border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowMetaSetup(s => !s)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 bg-surface-sunken hover:bg-surface-subtle text-xs font-medium text-text-secondary transition-colors"
            >
              <span>How to get your Access Token &amp; Account ID</span>
              {showMetaSetup ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showMetaSetup && (
              <div className="px-4 py-4 bg-surface text-[11px] text-text-secondary leading-relaxed space-y-3.5">
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-subtle border border-brand-border text-brand text-[10px] font-bold flex items-center justify-center">1</span>
                  <div>
                    <p className="font-medium text-text-primary mb-0.5">Create a System User</p>
                    <p className="text-text-tertiary">Meta Business Manager → Business Settings → Users → System Users → <em>New System User</em>. Set role to <strong>Employee</strong>.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-subtle border border-brand-border text-brand text-[10px] font-bold flex items-center justify-center">2</span>
                  <div>
                    <p className="font-medium text-text-primary mb-0.5">Add your Ad Account</p>
                    <p className="text-text-tertiary">System User → <em>Add Assets</em> → Ad Accounts → select your account → Permission: <strong>Analyst</strong> (minimum to read metrics).</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-subtle border border-brand-border text-brand text-[10px] font-bold flex items-center justify-center">3</span>
                  <div>
                    <p className="font-medium text-text-primary mb-1">Generate Access Token</p>
                    <p className="text-text-tertiary mb-1.5">System User → <em>Generate Token</em> → select your app → enable these permissions:</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {[
                        ['ads_read', 'Read campaign & ad metrics'],
                        ['ads_management', 'Required for async insights jobs'],
                        ['business_management', 'Access Business objects'],
                        ['pages_read_engagement', 'Page-level reach & engagement'],
                      ].map(([perm, desc]) => (
                        <div key={perm} className="flex items-start gap-1.5">
                          <CheckCircle size={11} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <code className="text-[10px] bg-surface-sunken px-1 py-0.5 rounded text-text-primary">{perm}</code>
                            <p className="text-[10px] text-text-tertiary mt-0.5">{desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-text-tertiary mt-1.5">System User tokens do <strong>not expire</strong> — unlike user tokens.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-subtle border border-brand-border text-brand text-[10px] font-bold flex items-center justify-center">4</span>
                  <div>
                    <p className="font-medium text-text-primary mb-0.5">Find your Ad Account ID</p>
                    <p className="text-text-tertiary">Business Manager → Ad Accounts → copy the numeric ID → prepend <code className="bg-surface-sunken px-1 rounded">act_</code> e.g. <code className="bg-surface-sunken px-1 rounded">act_1234567890</code></p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-subtle border border-brand-border text-brand text-[10px] font-bold flex items-center justify-center">5</span>
                  <div>
                    <p className="font-medium text-text-primary mb-0.5">Paste both fields below and click Save</p>
                    <p className="text-text-tertiary">Campaign metrics will sync automatically every 15 minutes once connected.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
          {metaLoading ? (
            <div className="flex items-center gap-2 py-3">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading…</span>
            </div>
          ) : (
            <>
              {/* Primary path: real OAuth consent. A reviewer needs a consent
                  screen to exercise; a token paste form is not one. */}
              <div className="flex flex-col gap-2 mb-4">
                <button
                  onClick={connectMetaOAuth}
                  disabled={metaConnecting}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1877F2] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-all"
                >
                  {metaConnecting ? <Spinner size="sm" /> : <CheckCircle size={14} />}
                  {metaAppIdRow ? 'Reconnect with Facebook' : 'Connect with Facebook'}
                </button>

                {metaAppIdRow ? (
                  <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-surface-sunken border border-border">
                    <span className="text-[11px] text-emerald-400 font-medium">Connected — verified against Meta</span>
                    <span className="text-[10px] text-text-tertiary">App ID {metaAppIdRow}</span>
                    <span className="text-[10px] text-text-tertiary">
                      {metaTokenExp
                        ? `Token expires ${new Date(metaTokenExp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                        : 'Token does not expire (System User)'}
                    </span>
                    {metaScopes && metaScopes.length > 0 && (
                      <span className="text-[10px] text-text-tertiary">Granted: {metaScopes.join(', ')}</span>
                    )}
                    {metaVerifiedAt && (
                      <span className="text-[10px] text-text-disabled">
                        Last verified {new Date(metaVerifiedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-text-tertiary">Not connected.</p>
                )}
              </div>

              {/* Retained, not deprecated: System User tokens are the right
                  shape for headless sync (they do not expire) and an existing
                  customer re-minting a token uses exactly this. Folded away
                  because it is the expert path, not the default one. */}
              <button
                type="button"
                onClick={() => setShowAdvancedMeta((v) => !v)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-surface-sunken hover:bg-surface-subtle text-xs font-medium text-text-secondary transition-colors"
              >
                <span>Advanced — paste a System User token</span>
                <span className="text-text-tertiary">{showAdvancedMeta ? '−' : '+'}</span>
              </button>

              {showAdvancedMeta && (
            <div className="flex flex-col gap-4 mt-4">
              <p className="text-[11px] text-text-tertiary">
                Pasted tokens are verified against Meta before they are stored — a token from another app, or from an app that no longer exists, is rejected here rather than failing silently later.
              </p>
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
                <p className={`text-xs ${metaSyncMsg.startsWith('Sync failed') ? 'text-red-400' : 'text-brand'}`}>{metaSyncMsg}</p>
              )}
              {metaSyncMsg && metaSyncMsg.startsWith('Rejected') && (
                <p className="text-[11px] text-red-400">{metaSyncMsg}</p>
              )}
            </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

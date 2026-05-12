// BACKLOG: Deprecate organizations.brand_colors in favor of brand_kits table.
// Settings should redirect users to the Brand Kit page for color management.
// brand_colors field kept for now to avoid breaking existing prompt-builders that read it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, Lock, X, Plus, AlertTriangle, CheckCircle, Wifi, WifiOff, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId, ADMIN_EMAIL } from '../lib/constants';
import { getApiKey, setApiKey, aiCall, getTodayAiCallsCount } from '../lib/ai-service';

function isAdmin(): boolean {
  return localStorage.getItem('user_email') === ADMIN_EMAIL;
}
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

const LOCKED_API_FIELDS = [
  { key: 'meta_app_id', label: 'Meta App ID' },
  { key: 'meta_app_secret', label: 'Meta App Secret' },
  { key: 'aisensy', label: 'AiSensy API Key' },
];

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';
type TestResult = { status: TestStatus; message: string };
type KeySaveStatus = 'idle' | 'saved';

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

  const [claudeKey, setClaudeKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
  const [keySaveStatus, setKeySaveStatus] = useState<KeySaveStatus>('idle');
  const [userAiLimit, setUserAiLimit] = useState(30);
  const [todayCallsUsed, setTodayCallsUsed] = useState(0);

  useEffect(() => {
    loadOrg();
    loadCompetitors();
    getTodayAiCallsCount().then(setTodayCallsUsed);
    const stored = getApiKey();
    if (stored) setClaudeKey(stored);
    const uid = localStorage.getItem('user_id');
    if (uid) {
      supabase.from('profiles').select('daily_ai_limit').eq('id', uid).maybeSingle().then(({ data }) => {
        if (data?.daily_ai_limit) setUserAiLimit(data.daily_ai_limit);
      });
    }
  }, []);

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
    const { data } = await supabase.from('competitors').insert(inserts).select('id,name');
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

  function handleClaudeKeyChange(val: string) {
    setClaudeKey(val);
    setTestResult({ status: 'idle', message: '' });
    setKeySaveStatus('idle');
  }

  function saveClaudeKey() {
    setApiKey(claudeKey.trim());
    setKeySaveStatus('saved');
    showToast('API key saved!', 'success');
    setTimeout(() => setKeySaveStatus('idle'), 3000);
  }

  async function testConnection() {
    setTestResult({ status: 'testing', message: '' });
    const res = await aiCall('Return {"status":"ok"}');
    if (res.error) {
      setTestResult({ status: 'fail', message: String(res.error) });
      showToast('API connection failed. Check your key.', 'error');
    } else {
      setTestResult({ status: 'ok', message: 'Connected successfully!' });
      showToast('API connected successfully!', 'success');
    }
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

        {!isAdmin() && (
          <Card className="p-5">
            <SectionLabel>AI Usage</SectionLabel>
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-lg bg-surface-sunken border border-border">
              <div className="flex-1">
                <p className="text-sm text-text-primary font-medium mb-1">AI features powered by admin's API key</p>
                <p className="text-xs text-text-tertiary">Daily usage: <span className="text-brand font-semibold">{todayCallsUsed}</span> / <span className="text-text-primary">{userAiLimit}</span> calls today</p>
              </div>
            </div>
          </Card>
        )}

        {isAdmin() && (
        <Card className="p-5">
          <SectionLabel>API Configuration</SectionLabel>

          {/* Status indicator */}
          <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg border mb-5 ${getApiKey() ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
            {getApiKey() ? (
              <>
                <CheckCircle size={13} className="text-emerald-400 flex-shrink-0" />
                <p className="text-xs text-emerald-300">API key configured — AI features are active.</p>
              </>
            ) : (
              <>
                <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-300">No API key — AI features will not work.</p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
                Claude API Key (Anthropic)
              </label>
              <p className="text-[11px] text-text-tertiary leading-relaxed -mt-0.5">
                AI features require an Anthropic API key. Get one at console.anthropic.com — stored locally in this browser only.
              </p>
              <div className="flex items-center gap-2 mt-1">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={claudeKey}
                    onChange={(e) => handleClaudeKeyChange(e.target.value)}
                    placeholder="sk-ant-api03-..."
                    className="w-full bg-surface border border-border rounded-lg pl-3 pr-9 py-2 text-sm text-text-primary focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
                    title={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  onClick={saveClaudeKey}
                  disabled={!claudeKey.trim()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-subtle border border-brand-border text-brand text-sm font-medium hover:bg-brand-subtle-hover disabled:opacity-40 transition-all flex-shrink-0 whitespace-nowrap"
                >
                  {keySaveStatus === 'saved' ? <CheckCircle size={13} /> : null}
                  {keySaveStatus === 'saved' ? 'Saved' : 'Save API Key'}
                </button>
                <button
                  onClick={testConnection}
                  disabled={!claudeKey.trim() || testResult.status === 'testing'}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text-primary hover:bg-surface-hover disabled:opacity-40 transition-all flex-shrink-0 whitespace-nowrap"
                >
                  {testResult.status === 'testing'
                    ? <Spinner size="sm" />
                    : testResult.status === 'ok'
                    ? <Wifi size={13} className="text-emerald-400" />
                    : testResult.status === 'fail'
                    ? <WifiOff size={13} className="text-red-400" />
                    : <Wifi size={13} />}
                  Test Key
                </button>
              </div>
              {testResult.status === 'ok' && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle size={12} />
                  {testResult.message}
                </div>
              )}
              {testResult.status === 'fail' && (
                <p className="text-xs text-red-400">{testResult.message}</p>
              )}
            </div>

            {LOCKED_API_FIELDS.map((field) => (
              <div key={field.key} className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
                  {field.label}
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                    <Lock size={13} className="text-text-tertiary" />
                  </div>
                  <input
                    readOnly
                    disabled
                    placeholder="Configure in Supabase Edge Function secrets"
                    className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-tertiary cursor-not-allowed opacity-60"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
        )}
      </div>
    </div>
  );
}

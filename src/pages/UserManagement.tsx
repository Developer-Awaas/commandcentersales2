import { useEffect, useState, useCallback } from 'react';
import { Users, Plus, ShieldCheck, Pencil, Trash2, RefreshCw, ToggleLeft, ToggleRight, X, Eye, EyeOff, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../contexts/ToastContext';

interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  module_access: Record<string, boolean>;
  daily_ai_limit: number;
  created_at?: string;
}

const ROLES = ['admin', 'manager', 'viewer', 'beta_tester'];

const ALL_MODULES: { key: string; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'projects', label: 'Projects' },
  { key: 'strategy_quick', label: 'Strategy' },
  { key: 'ad_config', label: 'Ad Config' },
  { key: 'creatives', label: 'Ad Creatives' },
  { key: 'ad_review', label: 'Ad Review' },
  { key: 'analyzer', label: 'Lead Analyzer' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'campaign_wizard', label: 'Campaign Wizard' },
  { key: 'ai_sessions', label: 'AI History' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'reports', label: 'Reports' },
  { key: 'smm_planner', label: 'SMM Planner' },
  { key: 'smm_calendar', label: 'SMM Calendar' },
  { key: 'smm_creatives', label: 'SMM Creatives' },
  { key: 'smm_analyzer', label: 'SMM Analyzer' },
  { key: 'content_library', label: 'Content Library' },
  { key: 'settings', label: 'Settings' },
  { key: 'user_management', label: 'Users' },
];

function genPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const DEFAULT_MODULES: Record<string, boolean> = {
  dashboard: true,
  projects: true,
  strategy_quick: true,
  ad_config: true,
  creatives: true,
  ad_review: true,
  analyzer: true,
  campaigns: true,
  notifications: true,
  reports: true,
};

const TH = 'px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary border-b border-border';
const TD = 'px-4 py-3 text-sm border-b border-border';

function roleColor(role: string) {
  if (role === 'admin') return 'text-[#2dd4a8] border-[#2dd4a8]/30 bg-[#2dd4a8]/10';
  if (role === 'manager') return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
  if (role === 'beta_tester') return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
  return 'text-text-tertiary border-border bg-[#111916]';
}

interface ModalState {
  open: boolean;
  mode: 'add' | 'edit';
  user?: UserRow;
}

export function UserManagement() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'add' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // form state
  const [fname, setFname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [role, setRole] = useState('manager');
  const [modules, setModules] = useState<Record<string, boolean>>(DEFAULT_MODULES);
  const [aiLimit, setAiLimit] = useState(30);
  const [formErr, setFormErr] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id,full_name,email,role,is_active,module_access,daily_ai_limit,created_at')
      .eq('org_id', getOrgId())
      .order('created_at');
    setUsers((data ?? []) as UserRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  function openAdd() {
    const pwd = genPassword();
    setFname(''); setEmail(''); setPassword(pwd); setShowPwd(true);
    setRole('manager'); setModules(DEFAULT_MODULES); setAiLimit(30); setFormErr('');
    setModal({ open: true, mode: 'add' });
  }

  function openEdit(u: UserRow) {
    setFname(u.full_name ?? ''); setEmail(u.email ?? ''); setPassword('');
    setShowPwd(false); setRole(u.role);
    const ma = typeof u.module_access === 'object' && !Array.isArray(u.module_access)
      ? u.module_access as Record<string, boolean>
      : DEFAULT_MODULES;
    setModules(ma); setAiLimit(u.daily_ai_limit ?? 30); setFormErr('');
    setModal({ open: true, mode: 'edit', user: u });
  }

  function closeModal() { setModal({ open: false, mode: 'add' }); }

  function toggleModule(key: string) {
    setModules(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    if (!fname.trim()) { setFormErr('Full name is required.'); return; }
    if (!email.trim()) { setFormErr('Email is required.'); return; }
    if (modal.mode === 'add' && password.length < 8) { setFormErr('Password must be at least 8 characters.'); return; }
    setSaving(true); setFormErr('');

    if (modal.mode === 'add') {
      const { data: authData, error: authErr } = await supabase.auth.signUp({ email, password });
      if (authErr || !authData.user) {
        setFormErr(authErr?.message ?? 'Failed to create auth user.');
        setSaving(false); return;
      }
      const userId = authData.user.id;
      const { error: profileErr } = await supabase.from('profiles').insert({
        id: userId,
        org_id: getOrgId(),
        full_name: fname.trim(),
        email: email.trim(),
        role,
        is_active: true,
        module_access: modules,
        daily_ai_limit: role === 'admin' ? 999 : aiLimit,
      });
      if (profileErr) {
        setFormErr(profileErr.message);
        setSaving(false); return;
      }
      showToast(`User created! Email: ${email} | Password: ${password}`, 'success');
      closeModal();
      loadUsers();
    } else {
      const uid = modal.user!.id;
      const { error } = await supabase.from('profiles').update({
        full_name: fname.trim(),
        role,
        module_access: modules,
        daily_ai_limit: role === 'admin' ? 999 : aiLimit,
      }).eq('id', uid);
      if (error) { setFormErr(error.message); setSaving(false); return; }
      showToast('User updated.', 'success');
      closeModal();
      loadUsers();
    }
    setSaving(false);
  }

  async function toggleActive(u: UserRow) {
    await supabase.from('profiles').update({ is_active: !u.is_active }).eq('id', u.id);
    showToast(`${u.full_name} ${u.is_active ? 'deactivated' : 'activated'}.`, 'success');
    loadUsers();
  }

  async function resetPassword(u: UserRow) {
    const pwd = genPassword();
    const { error } = await supabase.auth.admin.updateUserById(u.id, { password: pwd });
    if (error) {
      showToast('Password reset failed: ' + error.message, 'error');
    } else {
      showToast(`New password for ${u.email}: ${pwd}`, 'success');
    }
  }

  async function deleteUser(id: string) {
    await supabase.from('profiles').update({ is_active: false }).eq('id', id);
    showToast('User deactivated.', 'success');
    setConfirmDelete(null);
    loadUsers();
  }

  const initials = (u: UserRow) => (u.full_name ?? u.email ?? '?').slice(0, 1).toUpperCase();

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-3">
          <Users size={20} className="text-[#2dd4a8]" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">User Management</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Manage team members and their access</p>
          </div>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#2dd4a8]/10 border border-[#2dd4a8]/20 text-[#2dd4a8] text-sm font-medium hover:bg-[#2dd4a8]/15 transition-all"
        >
          <Plus size={13} />
          Add User
        </button>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 p-6">
            <Spinner size="sm" /><span className="text-xs text-text-tertiary">Loading...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Name</th>
                  <th className={TH}>Email</th>
                  <th className={TH}>Role</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>AI Limit</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-[#111916] transition-colors">
                    <td className={`${TD} text-text-primary font-medium`}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-[#2dd4a8]/10 border border-[#2dd4a8]/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-[11px] font-bold text-[#2dd4a8]">{initials(u)}</span>
                        </div>
                        {u.full_name ?? '—'}
                      </div>
                    </td>
                    <td className={`${TD} text-text-tertiary`}>{u.email ?? '—'}</td>
                    <td className={TD}>
                      <div className="flex items-center gap-1.5">
                        {u.role === 'admin' && <ShieldCheck size={13} className="text-[#2dd4a8]" />}
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${roleColor(u.role)}`}>
                          {u.role}
                        </span>
                      </div>
                    </td>
                    <td className={TD}>
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${u.is_active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className={`${TD} text-text-tertiary`}>{u.daily_ai_limit ?? 30}/day</td>
                    <td className={TD}>
                      <div className="flex items-center gap-1">
                        <ActionBtn title="Edit" onClick={() => openEdit(u)}><Pencil size={13} /></ActionBtn>
                        <ActionBtn title={u.is_active ? 'Deactivate' : 'Activate'} onClick={() => toggleActive(u)}>
                          {u.is_active ? <ToggleRight size={14} className="text-emerald-400" /> : <ToggleLeft size={14} className="text-text-tertiary" />}
                        </ActionBtn>
                        <ActionBtn title="Reset Password" onClick={() => resetPassword(u)}><RefreshCw size={13} /></ActionBtn>
                        <ActionBtn title="Delete" onClick={() => setConfirmDelete(u.id)} className="hover:text-red-400"><Trash2 size={13} /></ActionBtn>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-text-tertiary">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add/Edit Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[#0e1611] border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-text-primary font-semibold">{modal.mode === 'add' ? 'Add User' : 'Edit User'}</h2>
              <button onClick={closeModal} className="text-text-tertiary hover:text-text-primary transition-colors"><X size={18} /></button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <Input label="Full Name *" value={fname} onChange={e => setFname(e.target.value)} placeholder="Jane Smith" />
              <Input label="Email *" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" disabled={modal.mode === 'edit'} />

              {modal.mode === 'add' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Temporary Password *</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full bg-surface border border-border rounded-lg pl-3 pr-9 py-2 text-sm text-text-primary placeholder-[#4a6558] focus:outline-none focus:border-[#2dd4a8] focus:ring-1 focus:ring-[#2dd4a8] transition-colors"
                      />
                      <button type="button" onClick={() => setShowPwd(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary">
                        {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <button onClick={() => { const p = genPassword(); setPassword(p); setShowPwd(true); }} className="p-2 rounded-lg bg-[#1e2e24] border border-[#2a3f32] text-text-tertiary hover:text-text-primary transition-colors" title="Generate new password"><RefreshCw size={14} /></button>
                    <button onClick={() => { navigator.clipboard.writeText(password); showToast('Password copied!', 'success'); }} className="p-2 rounded-lg bg-[#1e2e24] border border-[#2a3f32] text-text-tertiary hover:text-text-primary transition-colors" title="Copy password"><Copy size={14} /></button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Role</label>
                <select
                  value={role}
                  onChange={e => { setRole(e.target.value); if (e.target.value === 'admin') setAiLimit(999); else if (aiLimit === 999) setAiLimit(30); }}
                  className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-[#2dd4a8] transition-colors"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Daily AI Limit</label>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={aiLimit}
                  onChange={e => setAiLimit(Number(e.target.value))}
                  className="w-32 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-[#2dd4a8] transition-colors"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Module Access</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {ALL_MODULES.map(m => (
                    <label key={m.key} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={!!modules[m.key]}
                        onChange={() => toggleModule(m.key)}
                        className="accent-[#2dd4a8] w-3.5 h-3.5"
                      />
                      <span className="text-xs text-[#c0d4c8] group-hover:text-text-primary transition-colors">{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {formErr && <p className="text-xs text-red-400">{formErr}</p>}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button onClick={closeModal} className="px-4 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary transition-colors">Cancel</button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2dd4a8] text-[#0a0f0d] text-sm font-semibold hover:bg-[#25c49a] disabled:opacity-50 transition-all"
                >
                  {saving ? <Spinner size="sm" /> : null}
                  {modal.mode === 'add' ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#0e1611] border border-border rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-text-primary font-semibold mb-2">Deactivate User?</h3>
            <p className="text-sm text-text-tertiary mb-5">The user will be marked inactive and lose access. This can be reversed.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary transition-colors">Cancel</button>
              <button onClick={() => deleteUser(confirmDelete)} className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/30 transition-all">Deactivate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({ children, onClick, title, className = '' }: { children: React.ReactNode; onClick: () => void; title: string; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-[#1e2e24] transition-all ${className}`}
    >
      {children}
    </button>
  );
}

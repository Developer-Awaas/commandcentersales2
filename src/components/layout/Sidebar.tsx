import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  Loader2,
  Zap,
  Target,
  Palette,
  Eye,
  TrendingUp,
  Megaphone,
  Bell,
  BarChart3,
  Users,
  Settings,
  LogOut,
  Clock,
  Calendar,
  CalendarDays,
  Image,
  Library,
  Smartphone,
  Wand2,
  ChevronDown,
  Bot,
} from 'lucide-react';

import { supabase } from '../../lib/supabase';
import type { Profile } from '../../lib/supabase';
import { useNavigation, type AppSection } from '../../contexts/NavigationContext';
import { hasModuleAccess } from '../../lib/access';
import { LEADGEN_V2_ENABLED } from '../../lib/feature-flags';

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  profile: Profile | null;
  onSignOut?: () => void;
  activeSection: AppSection;
  onSectionChange: (section: AppSection) => void;
  wizardActive?: boolean;
}

type NavItem = { id: string; label: string; icon: React.ElementType };

const DASHBOARD_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'ai-sessions', label: 'AI History', icon: Clock },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
];

const LEAD_GEN_NAV: NavItem[] = [
  { id: 'strategy', label: 'Strategy', icon: Zap },
  { id: 'campaign-wizard', label: 'Campaign Wizard', icon: Wand2 },
  { id: 'ad-config', label: 'Ad Config', icon: Target },
  { id: 'creatives', label: 'Ad Creatives', icon: Palette },
  { id: 'ad-review', label: 'Ad Review', icon: Eye },
  { id: 'analyzer', label: 'Performance Analyzer', icon: TrendingUp },
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
  ...(LEADGEN_V2_ENABLED ? [{ id: 'leadgen-v2', label: 'Aarav Agent ✦', icon: Bot }] : []),
];

const SMM_NAV: NavItem[] = [
  { id: 'smm-planner', label: 'SMM Planner', icon: Calendar },
  { id: 'smm-calendar', label: 'Content Calendar', icon: CalendarDays },
  { id: 'smm-creatives', label: 'SMM Creatives', icon: Image },
  { id: 'smm-analyzer', label: 'SMM Analyzer', icon: BarChart3 },
  { id: 'content-library', label: 'Content Library', icon: Library },
];

const BOTTOM_NAV: NavItem[] = [
  { id: 'brand-kit', label: 'Brand Kit', icon: Palette },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'users', label: 'Users', icon: Users },
];

const SECTIONS: { id: AppSection; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'lead_gen', label: 'Lead Gen', icon: Target },
  { id: 'smm', label: 'Social Media', icon: Smartphone },
];

export function Sidebar({
  activePage,
  onNavigate,
  profile,
  onSignOut,
  activeSection,
  onSectionChange,
  wizardActive: _wizardActive,
}: SidebarProps) {
  const { generatingPage, generationProgress } = useNavigation();
  const [learningMode, setLearningMode] = useState<boolean>(() => {
    return localStorage.getItem('learning_mode') !== 'false';
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [openSections, setOpenSections] = useState<Set<AppSection>>(() => new Set([activeSection]));

  useEffect(() => {
    setOpenSections(prev => new Set([...prev, activeSection]));
  }, [activeSection]);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, []);

  async function fetchUnreadCount() {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);
    setUnreadCount(count ?? 0);
  }

  function toggleLearningMode() {
    const next = !learningMode;
    setLearningMode(next);
    localStorage.setItem('learning_mode', next ? 'true' : 'false');
  }

  async function handleSignOut() {
    if (onSignOut) {
      await onSignOut();
    } else {
      await supabase.auth.signOut();
    }
  }

  function toggleSection(sec: AppSection) {
    if (sec !== activeSection) {
      onSectionChange(sec);
      setOpenSections(new Set([sec]));
    } else {
      setOpenSections(prev => {
        const next = new Set(prev);
        if (next.has(sec)) next.delete(sec); else next.add(sec);
        return next;
      });
    }
  }

  const isWizardMode = activePage === 'campaign-wizard';
  const WIZARD_NAV: NavItem[] = [
    { id: 'campaign-wizard', label: 'Campaign Wizard', icon: Wand2 },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  function renderNavItem(item: NavItem) {
    const Icon = item.icon;
    const isActive = activePage === item.id;
    const isGenerating = generatingPage === item.id;
    // Lock all items that aren't the currently generating page
    const isLocked = !!generatingPage && item.id !== generatingPage;

    return (
      <div key={item.id + '-' + activeSection}>
        <button
          onClick={() => !isLocked && onNavigate(item.id)}
          disabled={isLocked}
          title={isLocked ? 'Generation in progress — please wait' : undefined}
          className={[
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150',
            isActive
              ? 'bg-brand-subtle text-brand-text'
              : isLocked
              ? 'text-text-tertiary opacity-40 cursor-not-allowed'
              : 'text-text-secondary hover:bg-surface-sidebar-hover hover:text-text-primary',
          ].join(' ')}
        >
          <Icon size={18} className="flex-shrink-0" />
          <span className="flex-1 text-left text-[13px]">{item.label}</span>
          {isGenerating && (
            <Loader2 size={12} className="animate-spin text-amber-400 flex-shrink-0" />
          )}
          {!isGenerating && item.id === 'notifications' && unreadCount > 0 && (
            <span className="flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold flex-shrink-0 min-w-[18px] h-[18px] px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        {isGenerating && generationProgress !== null && (
          <div className="mx-3 mb-1 h-[3px] bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${generationProgress}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  const initials =
    profile?.full_name
      ?.split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    'U';

  return (
    <aside
      className="fixed top-0 left-0 h-screen flex flex-col bg-surface-sidebar border-r border-border z-40"
      style={{ width: 220 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
          <span className="text-[11px] font-bold text-white leading-none">NH</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold text-text-primary leading-tight">NH Command</span>
          <span className="text-[10px] text-text-tertiary leading-tight">Marketing HQ</span>
        </div>
      </div>

      {/* Main Nav — collapsible sections */}
      <nav className="flex-1 overflow-y-auto py-2 px-3">
        {SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          const isOpen = openSections.has(sec.id);

          const rawItems =
            sec.id === 'lead_gen' ? LEAD_GEN_NAV :
            sec.id === 'smm'      ? SMM_NAV      : DASHBOARD_NAV;
          const items = (isWizardMode && sec.id === 'lead_gen' ? WIZARD_NAV : rawItems)
            .filter(item => hasModuleAccess(profile, item.id));

          return (
            <div key={sec.id} className="mb-1">
              {/* Section header */}
              <button
                onClick={() => !generatingPage && toggleSection(sec.id)}
                disabled={!!generatingPage && sec.id !== activeSection}
                title={generatingPage && sec.id !== activeSection ? 'Generation in progress — please wait' : undefined}
                className={[
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all duration-150',
                  isActive
                    ? 'text-brand-text bg-brand-subtle'
                    : generatingPage && sec.id !== activeSection
                    ? 'text-text-tertiary opacity-40 cursor-not-allowed'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-sidebar-hover',
                ].join(' ')}
              >
                <Icon size={14} className="flex-shrink-0" />
                <span className="flex-1 text-left">{sec.label}</span>
                <ChevronDown
                  size={13}
                  className={[
                    'flex-shrink-0 transition-transform duration-200',
                    isOpen ? 'rotate-0' : '-rotate-90',
                  ].join(' ')}
                />
              </button>

              {/* Section items */}
              {isOpen && (
                <div className="mt-0.5 ml-2 pl-2 border-l border-border space-y-0.5">
                  {isWizardMode && sec.id === 'lead_gen' && (
                    <div className="mb-2 px-2 py-2 rounded-lg bg-brand-subtle border border-brand-border">
                      <p className="text-[10px] font-semibold text-brand-text leading-snug">Wizard mode active</p>
                      <p className="text-[9px] text-text-tertiary leading-snug mt-0.5">Sidebar simplified while wizard is in progress.</p>
                      <button
                        onClick={() => document.dispatchEvent(new CustomEvent('wizard-exit-requested'))}
                        className="text-[10px] text-danger hover:text-danger/80 text-left transition-colors mt-1"
                      >
                        Exit Wizard
                      </button>
                    </div>
                  )}
                  {items.map(item => renderNavItem(item))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-border px-3 pt-2 pb-2 flex-shrink-0 space-y-0.5">
        <p className="px-1 pt-1 pb-1.5 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
          Settings
        </p>
        {BOTTOM_NAV.filter((item) => hasModuleAccess(profile, item.id)).map(renderNavItem)}

        {/* Learning Mode */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[12px] text-text-tertiary font-medium">Learning Mode</span>
          <button
            onClick={toggleLearningMode}
            className={[
              'relative inline-flex items-center rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0',
              learningMode ? 'bg-brand' : 'bg-border-strong',
            ].join(' ')}
            style={{ width: 32, height: 18 }}
            aria-label="Toggle learning mode"
          >
            <span
              className="inline-block bg-white rounded-full shadow transition-transform duration-200"
              style={{
                width: 12,
                height: 12,
                transform: learningMode ? 'translateX(16px)' : 'translateX(3px)',
              }}
            />
          </button>
        </div>

        {/* User Profile */}
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-text-primary truncate leading-tight">
              {profile?.full_name || 'User'}
            </p>
            <p className="text-[10px] text-text-tertiary truncate leading-tight capitalize">
              {profile?.role ?? 'member'}
            </p>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-danger-subtle hover:text-danger-text transition-colors duration-150"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

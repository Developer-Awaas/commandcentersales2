import { useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { Spinner } from './components/ui/Spinner';
import { NavigationContext, type AppSection } from './contexts/NavigationContext';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/ui/Toast';
import { ChatbotProvider } from './contexts/ChatbotContext';
import { AIChatbot } from './components/AIChatbot';
import { LoginPage } from './pages/LoginPage';
import { Dashboard } from './pages/Dashboard';
import { Projects } from './pages/Projects';
import { Strategy } from './pages/Strategy';
import { AdConfig } from './pages/AdConfig';
import { Creatives } from './pages/Creatives';
import { AdReview } from './pages/AdReview';
import { Analyzer } from './pages/Analyzer';
import { Organic } from './pages/Organic';
import { Notifications } from './pages/Notifications';
import { Reports } from './pages/Reports';
import { SettingsPage } from './pages/SettingsPage';
import { UserManagement } from './pages/UserManagement';
import { AiSessions } from './pages/AiSessions';
import SMMPlanner from './pages/SMMPlanner';
import SMMCalendar from './pages/SMMCalendar';
import SMMCreatives from './pages/SMMCreatives';
import SMMAnalyzer from './pages/SMMAnalyzer';
import ContentLibrary from './pages/ContentLibrary';
import { Campaigns } from './pages/Campaigns';
import { CampaignWizard } from './pages/CampaignWizard';
import BrandKit from './pages/BrandKit';
import AanyaMemory from './pages/AanyaMemory';
import LeadGenV2 from './pages/leadgen-v2';
import type { Profile } from './lib/supabase';
import { hasModuleAccess } from './lib/access';
import { LEADGEN_V2_ENABLED } from './lib/feature-flags';

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center px-6">
      <div className="w-12 h-12 rounded-xl bg-danger-subtle border border-danger-border flex items-center justify-center mb-2">
        <span className="text-danger text-xl">&#9888;</span>
      </div>
      <p className="text-base font-medium text-text-primary">Access Restricted</p>
      <p className="text-sm text-text-secondary max-w-xs">You don&apos;t have access to this module. Contact your admin to request access.</p>
    </div>
  );
}

function PageContent({ page, profile, wizardActive, onWizardEnd, onWizardStart }: { page: string; profile: Profile | null; wizardActive: boolean; onWizardEnd: () => void; onWizardStart: () => void }) {
  if (!hasModuleAccess(profile, page)) return <AccessDenied />;

  switch (page) {
    case 'dashboard': return <Dashboard />;
    case 'projects': return <Projects />;
    case 'strategy': return <Strategy />;
    case 'ad-config': return <AdConfig />;
    case 'creatives': return <Creatives />;
    case 'ad-review': return <AdReview />;
    case 'analyzer': return <Analyzer />;
    case 'organic': return <Organic />;
    case 'notifications': return <Notifications />;
    case 'reports': return <Reports />;
    case 'ai-sessions': return <AiSessions />;
    case 'users': return <UserManagement />;
    case 'settings': return <SettingsPage />;
    case 'brand-kit': return <BrandKit />;
    case 'aanya-memory': return <AanyaMemory />;
    case 'campaigns': return <Campaigns />;
    case 'leadgen-v2': return LEADGEN_V2_ENABLED ? <LeadGenV2 /> : <Dashboard />;
    case 'campaign-wizard': return <CampaignWizard onWizardEnd={onWizardEnd} onWizardStart={onWizardStart} wizardActive={wizardActive} />;
    case 'smm-planner': return <SMMPlanner />;
    case 'smm-calendar': return <SMMCalendar />;
    case 'smm-creatives': return <SMMCreatives />;
    case 'smm-analyzer': return <SMMAnalyzer />;
    case 'content-library': return <ContentLibrary />;
    default: return <Dashboard />;
  }
}

function getSectionFromPage(page: string): AppSection {
  const smmPages = ['smm-planner', 'smm-calendar', 'smm-creatives', 'smm-analyzer', 'content-library'];
  const leadGenPages = ['strategy', 'campaign-wizard', 'ad-config', 'creatives', 'aanya-memory', 'ad-review', 'analyzer', 'organic', 'campaigns', 'leadgen-v2'];
  if (smmPages.includes(page)) return 'smm';
  if (leadGenPages.includes(page)) return 'lead_gen';
  return 'dashboard';
}

const SECTION_DEFAULT_PAGE: Record<AppSection, string> = {
  dashboard: 'dashboard',
  // When LEADGEN_V2_ENABLED, clicking the Lead Gen section tab lands on the
  // Aarav Agent page. Old pages (Strategy, CampaignWizard, etc.) remain
  // accessible via the sidebar — they are NOT deleted for this release.
  lead_gen: LEADGEN_V2_ENABLED ? 'leadgen-v2' : 'strategy',
  smm: 'smm-planner',
};

export default function App() {
  const { session, profile, loading, signOut } = useAuth();
  const [wizardActive, setWizardActive] = useState(false);
  const [generatingPage, setGeneratingPage] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<number | null>(null);
  const [hasUnsavedCreatives, setHasUnsavedCreatives] = useState(false);

  const [activePage, setActivePage] = useState<string>(() => {
    return localStorage.getItem('active_page') ?? 'dashboard';
  });

  const [activeSection, setActiveSection] = useState<AppSection>(() => {
    const saved = localStorage.getItem('active_section') as AppSection | null;
    if (saved && ['dashboard', 'lead_gen', 'smm'].includes(saved)) return saved;
    return getSectionFromPage(localStorage.getItem('active_page') ?? 'dashboard');
  });

  function navigate(page: string) {
    if (hasUnsavedCreatives && page !== activePage) {
      const ok = window.confirm('You have unsaved creatives. Leave without saving?');
      if (!ok) return;
      setHasUnsavedCreatives(false);
    }
    setActivePage(page);
    localStorage.setItem('active_page', page);
  }

  function setSection(section: AppSection) {
    setActiveSection(section);
    localStorage.setItem('active_section', section);
    if (section === 'dashboard') {
      navigate('dashboard');
    } else {
      const currentPageSection = getSectionFromPage(activePage);
      if (currentPageSection !== section) {
        navigate(SECTION_DEFAULT_PAGE[section]);
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!session) {
    return (
      <ToastProvider>
        <LoginPage />
        <ToastContainer />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ChatbotProvider>
        <NavigationContext.Provider value={{ navigate, activePage, activeSection, setSection, generatingPage, setGeneratingPage, generationProgress, setGenerationProgress, hasUnsavedCreatives, setHasUnsavedCreatives }}>
          <Layout activePage={activePage} onNavigate={navigate} profile={profile} onSignOut={signOut} activeSection={activeSection} onSectionChange={setSection} wizardActive={wizardActive}>
            <ErrorBoundary key={activePage}>
              <PageContent page={activePage} profile={profile} wizardActive={wizardActive} onWizardEnd={() => { setWizardActive(false); navigate('strategy'); }} onWizardStart={() => setWizardActive(true)} />
            </ErrorBoundary>
          </Layout>
          <AIChatbot />
          <ToastContainer />
        </NavigationContext.Provider>
      </ChatbotProvider>
    </ToastProvider>
  );
}

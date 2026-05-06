import React from 'react';
import { Sidebar } from './Sidebar';
import type { Profile } from '../../lib/supabase';
import type { AppSection } from '../../contexts/NavigationContext';

interface LayoutProps {
  activePage: string;
  onNavigate: (page: string) => void;
  profile: Profile | null;
  onSignOut?: () => void;
  activeSection: AppSection;
  onSectionChange: (section: AppSection) => void;
  wizardActive?: boolean;
  children: React.ReactNode;
}

export function Layout({
  activePage,
  onNavigate,
  profile,
  onSignOut,
  activeSection,
  onSectionChange,
  wizardActive,
  children,
}: LayoutProps) {
  return (
    <div className="min-h-screen bg-surface font-sans">
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        profile={profile}
        onSignOut={onSignOut}
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        wizardActive={wizardActive}
      />
      <main className="min-h-screen overflow-y-auto" style={{ marginLeft: 220 }}>
        {children}
      </main>
    </div>
  );
}

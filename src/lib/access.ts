import type { Profile } from './supabase';

// Canonical page-id → module_access key mapping. Used by both:
//   - Sidebar.tsx to filter nav items
//   - App.tsx to gate route rendering
export const PAGE_TO_MODULE: Record<string, string> = {
  dashboard: 'dashboard',
  projects: 'projects',
  'ai-sessions': 'ai_sessions',
  notifications: 'notifications',
  reports: 'reports',
  strategy: 'strategy_quick',
  'campaign-wizard': 'campaign_wizard',
  'ad-config': 'ad_config',
  creatives: 'creatives',
  // Aanya Brain (training-creatives + DNA) rides the creatives module so any
  // reviewer with creatives access can open it — no separate module_access key.
  'aanya-memory': 'creatives',
  'ad-review': 'ad_review',
  analyzer: 'analyzer',
  campaigns: 'campaigns',
  organic: 'organic',
  'smm-planner': 'smm_planner',
  'smm-calendar': 'smm_calendar',
  'smm-creatives': 'smm_creatives',
  'smm-analyzer': 'smm_analyzer',
  'content-library': 'content_library',
  'brand-kit': 'brand_kit',
  settings: 'settings',
  users: 'user_management',
  'leadgen-v2': 'strategy_quick',
  'history-ads': 'history_ads',
  'history-social': 'history_social',
};

export function hasModuleAccess(profile: Profile | null, pageId: string): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  const key = PAGE_TO_MODULE[pageId];
  if (!key) return false;
  const ma = profile.module_access;
  if (Array.isArray(ma)) return ma.includes(key);
  if (ma && typeof ma === 'object') return (ma as Record<string, unknown>)[key] === true;
  return false;
}

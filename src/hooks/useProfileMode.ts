import { useState } from 'react';

export type ProfileTier = 'profile_1' | 'profile_2' | 'profile_3';

export interface ProfileMode {
  tier: ProfileTier;
  label: string;
  description: string;
}

const TIER_META: Record<ProfileTier, { label: string; description: string }> = {
  profile_1: { label: 'Starter', description: 'Single project, text-only strategy' },
  profile_2: { label: 'Growth', description: 'Multi-project, AI creatives, brand DNA' },
  profile_3: { label: 'Enterprise', description: 'Full Aarav agent, live campaign sync' },
};

export function useProfileMode(): ProfileMode {
  const [tier] = useState<ProfileTier>(() => {
    const stored = localStorage.getItem('profile_tier') as ProfileTier | null;
    if (stored && stored in TIER_META) return stored;
    return 'profile_2';
  });

  return { tier, ...TIER_META[tier] };
}

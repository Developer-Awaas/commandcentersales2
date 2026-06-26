-- Add account tier column to profiles.
-- Defaults to 'profile_2' (Growth) so existing rows stay at their current
-- behaviour. The server-side aarav-orchestrate reads this to enforce the
-- per-interaction cost ceiling (see _shared/tier-config.ts).
-- The client-side useProfileMode hook still reads localStorage for display;
-- profiles.tier is the authoritative server-side value for cost caps.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'profile_2'
    CHECK (tier IN ('profile_1', 'profile_2', 'profile_3'));

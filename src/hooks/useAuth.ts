// FIRST TIME SETUP:
// 1. Go to Supabase Dashboard → Authentication → Users → "Add user"
// 2. Enter email and password, click "Create user"
// 3. Copy the user's UUID
// 4. Go to SQL Editor and run:
//    INSERT INTO organizations (id, name, slug) VALUES ('ORG_UUID', 'Neelachala Homes', 'neelachala-homes') ON CONFLICT DO NOTHING;
//    INSERT INTO profiles (id, org_id, full_name, email, role, module_access)
//    VALUES ('USER_UUID', 'ORG_UUID', 'Rahul Dev', 'your@email.com', 'admin',
//    '{"dashboard":true,"projects":true,"projects_edit":true,"strategy_quick":true,"strategy_full":true,"ad_config":true,"creatives":true,"ad_review":true,"analyzer":true,"organic":true,"notifications":true,"settings":true,"user_management":true,"reports":true,"data_export":true,"api_config":true}');

import { useState, useEffect, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type Profile } from '../lib/supabase';
import { setStoredOrgId, clearStoredOrgId } from '../lib/constants';
import { setUserEmail } from '../lib/ai-service';

function storeUserId(id: string) { localStorage.setItem('user_id', id); }
function clearUserId() { localStorage.removeItem('user_id'); }

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOrCreateProfile = useCallback(async (authUser: User) => {
    try {
      const { data: existing } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (existing) {
        setProfile(existing as Profile);
        if (existing.org_id) setStoredOrgId(existing.org_id);
        storeUserId(authUser.id);
        if (authUser.email) setUserEmail(authUser.email);
        return;
      }

      const { data: created } = await supabase
        .from('profiles')
        .insert({
          id: authUser.id,
          email: authUser.email ?? '',
          full_name: authUser.user_metadata?.full_name ?? '',
          role: 'marketer',
          module_access: { dashboard: true },
        })
        .select()
        .maybeSingle();

      if (created) {
        setProfile(created as Profile);
        if ((created as Profile).org_id) setStoredOrgId((created as Profile).org_id!);
        storeUserId(authUser.id);
      }
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchOrCreateProfile(session.user).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        (async () => {
          await fetchOrCreateProfile(session.user!);
        })();
      } else {
        setProfile(null);
        clearStoredOrgId();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchOrCreateProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Sign in failed. Please try again.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      clearStoredOrgId();
      clearUserId();
    } catch {
      // ignore
    }
    setSession(null);
    setUser(null);
    setProfile(null);
  }, []);

  return { session, user, profile, loading, signIn, signOut };
}

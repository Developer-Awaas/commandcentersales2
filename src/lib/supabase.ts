import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  org_id: string | null;
  module_access: Record<string, boolean> | string[];
  role: string;
  avatar_url?: string | null;
  learning_mode?: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}


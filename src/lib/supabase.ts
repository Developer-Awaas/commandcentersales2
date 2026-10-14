import { createClient } from '@supabase/supabase-js';
import { viteEnv } from './env';
import { readFunctionError } from './function-error';
export { readFunctionError };

const supabaseUrl = viteEnv.VITE_SUPABASE_URL as string;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// supabase.functions.invoke()'s error on a non-2xx response is always the
// generic FunctionsHttpError("Edge Function returned a non-2xx status
// code") — the actual JSON body our function sent (the readable message)
// lives on error.context (the raw Response), not error.message. Reading
// only .message silently discards it, which is exactly why detailed
// server-side error text was showing up as a bare, unhelpful status code
// on the client. Use this wherever a functions.invoke() error needs to be
// shown to a user.
export async function extractFunctionErrorMessage(error: unknown, fallback = 'Request failed'): Promise<string> {
  return (await readFunctionError(error, fallback)).message;
}

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


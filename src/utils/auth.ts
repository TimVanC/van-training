import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session ?? null;
}

import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export async function getCurrentUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session ?? null;
}

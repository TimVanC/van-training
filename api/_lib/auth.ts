import type { VercelRequest } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AuthResult =
  | { ok: true; supabase: SupabaseClient; userId: string }
  | { ok: false; status: number; message: string };

/** Service-role client plus the caller's user id, taken from the Bearer token. */
export async function authenticate(req: VercelRequest): Promise<AuthResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: 'Missing Authorization token' };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, message: 'Invalid or expired token' };
  return { ok: true, supabase, userId: data.user.id };
}

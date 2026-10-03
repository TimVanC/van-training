import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../_lib/auth.js';

/**
 * Permanently delete the caller's account and everything attached to it.
 * The body must repeat the account's own email, so a stray request (or a
 * mis-tap) can't do it. Only ever touches rows owned by the signed-in user.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const auth = await authenticate(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    const { supabase, userId } = auth;

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    const email = userData?.user?.email?.trim().toLowerCase();
    if (userError || !email) throw userError ?? new Error('User not found');

    const confirmEmail = (req.body ?? {}).confirmEmail;
    if (typeof confirmEmail !== 'string' || confirmEmail.trim().toLowerCase() !== email) {
      res.status(400).json({ error: 'Type your account email exactly to confirm.' });
      return;
    }

    // Sessions point at workouts with ON DELETE RESTRICT, so they have to go
    // before the user row's cascade removes the splits (sets cascade with them).
    const { error: sessionsError } = await supabase.from('sessions').delete().eq('user_id', userId);
    if (sessionsError) throw sessionsError;

    // Everything else that belongs to the user cascades from auth.users.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    res.status(200).json({ deleted: true });
  } catch (error) {
    console.error('Error in deleteAccount:', error);
    res.status(500).json({ error: "Couldn't delete your account. Try again." });
  }
}

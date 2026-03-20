import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const VALID_CODES = ['VAN2026'];

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { email, password, invite_code } = (req.body ?? {}) as {
    email?: string;
    password?: string;
    invite_code?: string;
  };

  if (!email || !password || !invite_code) {
    res.status(400).json({ error: 'Missing email, password, or invite_code' });
    return;
  }

  if (!VALID_CODES.includes(invite_code)) {
    res.status(400).json({ error: 'Invalid invite code' });
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in signup:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

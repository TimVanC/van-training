import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { setId } = (req.body ?? {}) as { setId?: string };
  console.log('deleteLastSet stub received setId:', setId);
  res.status(200).json({ success: true });
}

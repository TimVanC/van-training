import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;

    console.log('Received rows:', body);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in appendWorkout:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

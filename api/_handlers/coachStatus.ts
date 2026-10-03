import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Whether Coach Van can answer at all, so the app can hide its entry points when no API key is configured. */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY) });
}

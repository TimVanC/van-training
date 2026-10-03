import type { VercelRequest, VercelResponse } from '@vercel/node';
import coachChat from './_handlers/coachChat.js';
import coachStatus from './_handlers/coachStatus.js';
import deleteAccount from './_handlers/deleteAccount.js';
import exportData from './_handlers/exportData.js';
import onboardingChat from './_handlers/onboardingChat.js';
import saveSplit from './_handlers/saveSplit.js';

// The coach turns can take most of a minute.
export const config = { maxDuration: 60 };

type Handler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>;

const ROUTES: Record<string, Handler> = {
  coachChat,
  coachStatus,
  deleteAccount,
  exportData,
  onboardingChat,
  saveSplit,
};

/**
 * One function for the coach and account endpoints. Vercel's Hobby plan caps
 * a deployment at 12 serverless functions, so these share an entry point;
 * vercel.json rewrites /api/<name> to /api/app?route=<name>, which keeps the
 * public paths unchanged. Add new endpoints here rather than as new files in api/.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const route = Array.isArray(req.query.route) ? req.query.route[0] : req.query.route;
  const target = typeof route === 'string' && Object.hasOwn(ROUTES, route) ? ROUTES[route] : null;
  if (!target) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await target(req, res);
}

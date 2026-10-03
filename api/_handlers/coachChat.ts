import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate } from '../_lib/auth.js';
import { checkAiRateLimit } from '../_lib/aiRateLimit.js';
import { answerCoachQuestion } from '../_lib/coachChat.js';
import type { CoachChatResponse, CoachChatTurn } from '../../src/types/onboarding.js';

const RATE_CAPS = { perMinute: 6, perDay: 60, perMonth: 400 };
const MAX_TURNS = 30;
const MAX_MESSAGE_CHARS = 2000;

/**
 * In-app coach: answer a question about the caller's own training log. The
 * model can only read (through the lookups in _lib/coachChat) and only the
 * signed-in user's rows; nothing is written.
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
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: "Coach Van isn't set up yet. Try again later." });
      return;
    }

    const turns = Array.isArray((req.body ?? {}).messages) ? ((req.body as { messages: CoachChatTurn[] }).messages) : [];
    // Keep the most recent turns; older ones fall off rather than blocking the chat.
    const recent = turns.slice(-MAX_TURNS);
    while (recent.length > 0 && recent[0]?.role !== 'user') recent.shift();
    if (recent.length === 0 || recent[recent.length - 1]?.role !== 'user') {
      res.status(400).json({ error: 'Invalid conversation.' });
      return;
    }

    const history: Anthropic.Beta.BetaMessageParam[] = [];
    for (const turn of recent) {
      const text = typeof turn?.content === 'string' ? turn.content.trim() : '';
      if ((turn?.role !== 'user' && turn?.role !== 'assistant') || !text) {
        res.status(400).json({ error: 'Invalid conversation.' });
        return;
      }
      if (turn.role === 'user' && text.length > MAX_MESSAGE_CHARS) {
        res.status(400).json({ error: 'That message is too long. Ask one thing at a time.' });
        return;
      }
      history.push({ role: turn.role, content: text.slice(0, MAX_MESSAGE_CHARS * 2) });
    }

    const limited = await checkAiRateLimit(auth.supabase, auth.userId, 'coach', RATE_CAPS);
    if (limited) {
      res.status(429).json({ error: limited });
      return;
    }

    const answer = await answerCoachQuestion(auth.supabase, auth.userId, history);
    if (!answer) {
      res.status(502).json({ error: "Coach Van couldn't answer that. Try asking it another way." });
      return;
    }
    const payload: CoachChatResponse = answer;
    res.status(200).json(payload);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      res.status(503).json({ error: 'Coach Van is busy right now. Try again in a minute.' });
    } else if (error instanceof Anthropic.APIConnectionError) {
      res.status(504).json({ error: 'Coach Van took too long. Try again.' });
    } else {
      console.error('Error in coachChat:', error);
      res.status(500).json({ error: 'Something went wrong. Try again.' });
    }
  }
}

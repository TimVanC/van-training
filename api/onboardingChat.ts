import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate } from './_lib/auth.js';
import { checkAiRateLimit } from './_lib/aiRateLimit.js';
import { INTAKE_TOPICS, runCoachTurn } from './_lib/coach.js';
import { sanitizeSplitDraft, type SplitDraft } from '../src/lib/splitDraft.js';
import type { ChatAttachment, ChatTurn, OnboardingChatResponse } from '../src/types/onboarding.js';

export const config = { maxDuration: 60 };

const RATE_CAPS = { perMinute: 8, perDay: 40, perMonth: 150 };

const MAX_TURNS = 40;
const MAX_MESSAGE_CHARS = 4000;
const MAX_ATTACHMENTS_PER_TURN = 4;
const MAX_TEXT_ATTACHMENT_CHARS = 150_000;
const MAX_BINARY_BASE64_CHARS = 4_200_000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

function isImageType(value: string): value is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(value);
}

/** Validate one client turn and convert it into API content blocks. */
function toContentBlocks(turn: ChatTurn): Anthropic.ContentBlockParam[] | string {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const attachments = Array.isArray(turn.attachments) ? turn.attachments : [];
  if (attachments.length > MAX_ATTACHMENTS_PER_TURN) return `Up to ${MAX_ATTACHMENTS_PER_TURN} files per message.`;

  for (const a of attachments as ChatAttachment[]) {
    const name = typeof a?.name === 'string' ? a.name.slice(0, 120) : 'file';
    if (a?.kind === 'image') {
      if (!isImageType(a.mediaType) || typeof a.data !== 'string' || a.data.length > MAX_BINARY_BASE64_CHARS) {
        return `Couldn't read ${name}. Try a screenshot instead.`;
      }
      blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
    } else if (a?.kind === 'pdf') {
      if (typeof a.data !== 'string' || a.data.length > MAX_BINARY_BASE64_CHARS) {
        return `${name} is too large. Try a smaller PDF or a screenshot.`;
      }
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
    } else if (a?.kind === 'text') {
      if (typeof a.text !== 'string' || a.text.length > MAX_TEXT_ATTACHMENT_CHARS) {
        return `${name} is too long to read in one go. Send just the part with your program.`;
      }
      blocks.push({ type: 'text', text: `<file name="${name.replace(/"/g, "'")}">\n${a.text}\n</file>` });
    } else {
      return 'Unsupported attachment.';
    }
  }

  const text = typeof turn.content === 'string' ? turn.content.trim() : '';
  if (text.length > MAX_MESSAGE_CHARS) return 'That message is too long. Attach it as a file instead.';
  if (text) blocks.push({ type: 'text', text });
  if (blocks.length === 0) return 'Empty message.';
  return blocks;
}

/**
 * Onboarding coach: one conversational turn. Reads whatever the user uploaded,
 * returns a short reply and (once it has one) a full draft split. Pure proxy:
 * nothing is written to the database here; saving is api/saveSplit.
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

    const body = (req.body ?? {}) as { messages?: unknown; draft?: unknown };
    const turns = Array.isArray(body.messages) ? (body.messages as ChatTurn[]) : [];
    if (turns.length === 0 || turns.length > MAX_TURNS || turns[turns.length - 1]?.role !== 'user') {
      res.status(400).json({
        error: turns.length > MAX_TURNS ? 'This conversation is getting long. Save your split or start over.' : 'Invalid conversation.',
      });
      return;
    }

    const messages: Anthropic.MessageParam[] = [];
    for (const turn of turns) {
      if (turn?.role === 'assistant') {
        const text = typeof turn.content === 'string' ? turn.content.slice(0, MAX_MESSAGE_CHARS) : '';
        messages.push({ role: 'assistant', content: text || '(shared a draft split)' });
        continue;
      }
      if (turn?.role !== 'user') {
        res.status(400).json({ error: 'Invalid conversation.' });
        return;
      }
      const blocks = toContentBlocks(turn);
      if (typeof blocks === 'string') {
        res.status(400).json({ error: blocks });
        return;
      }
      messages.push({ role: 'user', content: blocks });
    }

    // The draft on screen (with the user's hand edits) rides along with the
    // latest message, so the coach always revises what the user actually sees.
    const current = body.draft ? sanitizeSplitDraft(body.draft) : null;
    if (current && 'draft' in current) {
      const last = messages[messages.length - 1];
      (last.content as Anthropic.ContentBlockParam[]).push({
        type: 'text',
        text: `<current_draft note="what the lifter sees now, including their own edits">\n${JSON.stringify(current.draft)}\n</current_draft>`,
      });
    }

    const limited = await checkAiRateLimit(auth.supabase, auth.userId, 'onboarding', RATE_CAPS);
    if (limited) {
      res.status(429).json({ error: limited });
      return;
    }

    const { data: catalogRows, error: catalogError } = await auth.supabase
      .from('exercises')
      .select('name')
      .eq('is_archived', false)
      .order('name', { ascending: true })
      .limit(400);
    if (catalogError) throw catalogError;
    const catalog = ((catalogRows ?? []) as Array<{ name: string }>)
      .map((r) => r.name)
      .filter((n) => !/^test\b/i.test(n));

    const output = await runCoachTurn(messages, catalog);
    if (!output) {
      res.status(502).json({ error: "Coach Van couldn't answer that. Try rephrasing or sending a different file." });
      return;
    }

    let split: SplitDraft | null = null;
    if (output.split) {
      const cleaned = sanitizeSplitDraft(output.split);
      if ('draft' in cleaned) split = cleaned.draft;
    }
    // The counter runs over the intake topics plus one final step: a split to review.
    const known = Math.min(Math.max(Math.round(Number(output.topicsKnown)) || 0, 0), INTAKE_TOPICS);
    const payload: OnboardingChatResponse = {
      reply: output.reply.trim(),
      split,
      progress: { current: split ? INTAKE_TOPICS + 1 : known, total: INTAKE_TOPICS + 1 },
    };
    res.status(200).json(payload);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      res.status(503).json({ error: 'Coach Van is busy right now. Try again in a minute.' });
    } else if (error instanceof Anthropic.BadRequestError) {
      console.error('onboardingChat bad request:', error.message);
      res.status(400).json({ error: "Coach Van couldn't read that. Try a different file or a screenshot." });
    } else if (error instanceof Anthropic.APIConnectionError) {
      res.status(504).json({ error: 'Coach Van took too long. Try again.' });
    } else {
      console.error('Error in onboardingChat:', error);
      res.status(500).json({ error: 'Something went wrong. Try again.' });
    }
  }
}

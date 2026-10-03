import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_MODEL, createCoachClient } from './coach.js';
import { APP_KNOWLEDGE, COACH_NAME, COACH_VOICE, TRAINING_KNOWLEDGE } from './coachKnowledge.js';
import {
  exerciseHistory,
  listExercises,
  muscleSummary,
  personalRecords,
  recentSessions,
  weeklySummary,
  type CoachSetRow,
} from '../../src/lib/coachData.js';
import { sanitizeChart, type CoachChart } from '../../src/lib/coachChart.js';

const MAX_STEPS = 6;
const MAX_CHARTS = 2;
/** Leave headroom under the function's 60 s limit. */
const TIME_BUDGET_MS = 50_000;


const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_exercises',
    description:
      "Every exercise the lifter has logged, with session count, first and last date, and best set. Call this first when you need the exact name of an exercise or an overview of what they train.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_exercise_history',
    description:
      'Session-by-session history for one exercise (oldest first): every set, the top set, estimated 1RM and volume. The name is matched loosely, so "bench" finds the closest logged exercise.',
    input_schema: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Exercise name, as the lifter or the exercise list calls it.' },
        sessions: { type: 'integer', description: 'How many of the latest sessions to return (default 12, max 40).' },
      },
      required: ['exercise'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_recent_sessions',
    description: 'The latest workouts, newest first, with the split, day and every set logged.',
    input_schema: {
      type: 'object',
      properties: { count: { type: 'integer', description: 'How many sessions (default 5, max 15).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_weekly_summary',
    description: 'Sessions, total sets and total volume (lb) for each of the last N weeks, oldest first. Weeks with no training are included as zeros.',
    input_schema: {
      type: 'object',
      properties: { weeks: { type: 'integer', description: 'How many weeks back (default 8, max 26).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_muscle_summary',
    description: 'Hard sets per muscle group over the last N weeks (each set counted for its primary muscle), with sets per week and the exercises contributing most.',
    input_schema: {
      type: 'object',
      properties: { weeks: { type: 'integer', description: 'How many weeks back (default 4, max 26).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_personal_records',
    description: 'Best set by estimated 1RM for every exercise, strongest first, with the date it was set.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_splits',
    description: "The lifter's programs: each split, its days in order, and each day's exercises with sets and rep range.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'show_chart',
    description:
      'Draw a chart under your answer. Use it when a trend over time or a comparison is clearer as a picture. Fetch the data with the other tools first; only chart numbers you actually have.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['line', 'bar'], description: 'line for a trend over time, bar for comparing categories or weeks.' },
        title: { type: 'string', description: 'Short title, e.g. "Leg Press: estimated 1RM".' },
        yLabel: { type: 'string', description: 'Unit or measure for the vertical axis, e.g. "lb" or "sets".' },
        labels: { type: 'array', items: { type: 'string' }, description: 'One label per point along the bottom, e.g. dates like "Sep 12". At most 60.' },
        series: {
          type: 'array',
          description: 'One to four lines or bar groups.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              values: { type: 'array', items: { type: ['number', 'null'] }, description: 'One value per label; null for a gap.' },
            },
            required: ['name', 'values'],
            additionalProperties: false,
          },
        },
      },
      required: ['type', 'title', 'labels', 'series'],
      additionalProperties: false,
    },
  },
];

function buildSystemPrompt(today: string): string {
  return `${COACH_VOICE}

The lifter is asking you questions from inside the app. You can look up their real training log with the tools; you cannot change anything in it.

${APP_KNOWLEDGE}

${TRAINING_KNOWLEDGE}

How to answer:
- For anything about their training, look it up before you answer. Never guess a number, a date or an exercise they do; if the log doesn't have it, say so.
- Answer the question first, then the one thing most worth acting on. Two to five short sentences is usually right. Give real numbers from their log.
- When a trend or comparison is easier to see than to read, call show_chart with the data you fetched, then say what the chart shows in a sentence instead of listing every point. At most two charts per answer. Format dates on charts like "Sep 12".
- General training questions (programming, technique, recovery, nutrition basics) need no lookup: answer from what you know, tied to their situation where it helps.
- A new lifter may have little or no data. Say what you can and what a few more sessions would let you tell them.
- To change a split they should use Settings, then "Add a split with ${COACH_NAME}", or edit it there; you can suggest exactly what to change.
- Stay on training, this app and closely related health basics. For anything else, say it's outside what you do here.

Today is ${today}. Weights are in pounds.`;
}

interface SessionQueryRow {
  id: string;
  date: string;
  workouts:
    | { name: string; splits: { name: string } | { name: string }[] | null }
    | Array<{ name: string; splits: { name: string } | { name: string }[] | null }>
    | null;
}

function unwrap<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function fetchAllPages<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/** Every set the user has logged in the app, flattened for the coach's lookups. */
export async function loadCoachRows(supabase: SupabaseClient, userId: string): Promise<CoachSetRow[]> {
  const sessions = await fetchAllPages<SessionQueryRow>((from, to) =>
    supabase
      .from('sessions')
      .select('id, date, workouts(name, splits(name))')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .range(from, to),
  );
  if (sessions.length === 0) return [];
  const meta = new Map<string, { date: string; dayName: string; splitName: string }>();
  for (const s of sessions) {
    const workout = unwrap(s.workouts);
    meta.set(s.id, { date: s.date, dayName: workout?.name ?? '', splitName: (workout ? unwrap(workout.splits) : null)?.name ?? '' });
  }
  const sets = await fetchAllPages<{ session_id: string; exercise_name: string | null; weight: unknown; reps: unknown; set_number: number | null }>(
    (from, to) =>
      supabase
        .from('lift_sets')
        .select('session_id, exercise_name, weight, reps, set_number')
        .in('session_id', sessions.map((s) => s.id))
        .range(from, to),
  );
  const rows: CoachSetRow[] = [];
  for (const set of sets) {
    const m = meta.get(set.session_id);
    const exercise = (set.exercise_name ?? '').trim();
    const weight = Number(set.weight);
    const reps = Number(set.reps);
    if (!m || !exercise || !Number.isFinite(weight) || !Number.isFinite(reps)) continue;
    rows.push({ sessionId: set.session_id, ...m, exercise, weight, reps, setNumber: set.set_number });
  }
  return rows;
}

async function loadSplits(supabase: SupabaseClient, userId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('splits')
    .select('name, workouts ( name, order_index, workout_exercises ( sets, rep_range, order_index, exercises ( name, is_archived ) ) )')
    .eq('user_id', userId);
  if (error) throw error;
  type Row = {
    name: string;
    workouts: Array<{
      name: string;
      order_index: number;
      workout_exercises: Array<{
        sets: number;
        rep_range: string;
        order_index: number;
        exercises: { name: string; is_archived: boolean | null } | Array<{ name: string; is_archived: boolean | null }> | null;
      }>;
    }>;
  };
  return ((data ?? []) as Row[])
    .filter((s) => s.name.trim().toLowerCase() !== 'import split')
    .map((s) => ({
      split: s.name,
      days: [...(s.workouts ?? [])]
        .sort((a, b) => a.order_index - b.order_index)
        .map((w) => ({
          day: w.name,
          exercises: [...(w.workout_exercises ?? [])]
            .sort((a, b) => a.order_index - b.order_index)
            .map((we) => ({ exercise: unwrap(we.exercises), sets: we.sets, reps: we.rep_range }))
            .filter((e) => e.exercise && !e.exercise.is_archived)
            .map((e) => `${e.exercise!.name} ${e.sets}x${e.reps}`),
        })),
    }));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

export interface CoachToolContext {
  rows: () => Promise<CoachSetRow[]>;
  splits: () => Promise<unknown>;
  now: Date;
  charts: CoachChart[];
}

/** Run one tool call. Returns the JSON-able result and whether it was an error. */
export async function runCoachTool(
  name: string,
  input: unknown,
  ctx: CoachToolContext,
): Promise<{ result: unknown; isError?: boolean }> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  switch (name) {
    case 'list_exercises': {
      const list = listExercises(await ctx.rows());
      return { result: list.length > 0 ? list : 'No sets logged yet.' };
    }
    case 'get_exercise_history': {
      if (typeof args.exercise !== 'string' || !args.exercise.trim()) {
        return { result: 'exercise is required.', isError: true };
      }
      const history = exerciseHistory(await ctx.rows(), args.exercise, clampInt(args.sessions, 12, 1, 40));
      if (!history.exercise) return { result: `No logged exercise matches "${args.exercise}". Call list_exercises for the exact names.` };
      return { result: history };
    }
    case 'get_recent_sessions': {
      const sessions = recentSessions(await ctx.rows(), clampInt(args.count, 5, 1, 15));
      return { result: sessions.length > 0 ? sessions : 'No sessions logged yet.' };
    }
    case 'get_weekly_summary':
      return { result: weeklySummary(await ctx.rows(), clampInt(args.weeks, 8, 1, 26), ctx.now) };
    case 'get_muscle_summary':
      return { result: muscleSummary(await ctx.rows(), clampInt(args.weeks, 4, 1, 26), ctx.now) };
    case 'get_personal_records': {
      const records = personalRecords(await ctx.rows());
      return { result: records.length > 0 ? records : 'No sets logged yet.' };
    }
    case 'get_splits':
      return { result: await ctx.splits() };
    case 'show_chart': {
      if (ctx.charts.length >= MAX_CHARTS) return { result: `Only ${MAX_CHARTS} charts per answer.`, isError: true };
      const cleaned = sanitizeChart(args);
      if ('error' in cleaned) return { result: cleaned.error, isError: true };
      ctx.charts.push(cleaned.chart);
      return { result: 'Chart will be shown under your answer.' };
    }
    default:
      return { result: `Unknown tool: ${name}`, isError: true };
  }
}

export interface CoachAnswer {
  reply: string;
  charts: CoachChart[];
}

/**
 * Answer one question: let the model look things up (and draw charts) until
 * it has a reply. Returns null if the model declined. API errors propagate.
 */
export async function answerCoachQuestion(
  supabase: SupabaseClient,
  userId: string,
  history: Anthropic.Beta.BetaMessageParam[],
): Promise<CoachAnswer | null> {
  const started = Date.now();
  const client = createCoachClient();
  const now = new Date();

  let rowsPromise: Promise<CoachSetRow[]> | null = null;
  let splitsPromise: Promise<unknown> | null = null;
  const ctx: CoachToolContext = {
    rows: () => (rowsPromise ??= loadCoachRows(supabase, userId)),
    splits: () => (splitsPromise ??= loadSplits(supabase, userId)),
    now,
    charts: [],
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [...history];
  const system = buildSystemPrompt(now.toISOString().slice(0, 10));

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const remaining = TIME_BUDGET_MS - (Date.now() - started);
    if (remaining < 5_000) break;

    const response = await client.beta.messages.create(
      {
        model: COACH_MODEL,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system,
        tools: TOOLS,
        messages,
      },
      { timeout: remaining },
    );

    if (response.stop_reason === 'refusal') return null;

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    const toolUses = response.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use');

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return text ? { reply: text, charts: ctx.charts } : null;
    }

    // Echo the whole turn back (thinking blocks included) and answer every call in one message.
    messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of toolUses) {
      let outcome: { result: unknown; isError?: boolean };
      try {
        outcome = await runCoachTool(call.name, call.input, ctx);
      } catch (error) {
        console.error(`coach tool ${call.name} failed:`, error);
        outcome = { result: 'That lookup failed. Answer with what you have.', isError: true };
      }
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result),
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    reply: "That one took me too long to work out. Try asking about one thing at a time.",
    charts: ctx.charts,
  };
}

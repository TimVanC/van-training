// End-to-end checks against the local dev server and the real database, as the coach test account.
import { createClient } from '@supabase/supabase-js';


const { runCoachTool, loadCoachRows } = await import("../api/_lib/coachChat.ts");
const { checkAiRateLimit } = await import("../api/_lib/aiRateLimit.ts");

const BASE = 'http://localhost:3000';
const env = process.env as Record<string, string>;
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
  email: env.TEST_COACH_EMAIL,
  password: env.TEST_COACH_PASSWORD,
});
if (signInError || !signIn.session) throw new Error(`sign-in failed: ${signInError?.message}`);
const token = signIn.session.access_token;
const userId = signIn.user.id;

async function call(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token === null ? {} : { Authorization: `Bearer ${init.token ?? token}` }),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

// --- auth and method guards on every new endpoint ---
for (const path of ['/api/saveSplit', '/api/onboardingChat', '/api/coachChat']) {
  check(`${path} GET → 405`, (await call(path, { method: 'GET' })).status === 405);
  check(`${path} no token → 401`, (await call(path, { token: null, body: {} })).status === 401);
  check(`${path} bad token → 401`, (await call(path, { token: 'not-a-token', body: {} })).status === 401);
}

// --- saveSplit validation ---
const day = (name: string, ...ex: string[]) => ({ name, exercises: ex.map((n) => ({ name: n, sets: 3, repRange: '8-12' })) });
check('saveSplit no draft → 400', (await call('/api/saveSplit', { body: {} })).status === 400);
check('saveSplit reserved name → 400', (await call('/api/saveSplit', { body: { draft: { name: 'Import Split', days: [day('A', 'Leg Press')] } } })).status === 400);
check('saveSplit empty days → 400', (await call('/api/saveSplit', { body: { draft: { name: 'X', days: [{ name: 'A', exercises: [] }] } } })).status === 400);

// --- saveSplit: duplicate name gets a suffix, catalog rows are reused case-insensitively ---
const before = await admin.from('exercises').select('id', { count: 'exact', head: true });
const saved = await call('/api/saveSplit', {
  body: { draft: { name: 'Coach Test UL', days: [day('Day One', 'lat pulldown', 'LEG PRESS'), day('Core Extra', 'Cable Crunches')] } },
});
check('saveSplit duplicate name → 200 with suffix', saved.status === 200 && saved.json?.splitName === 'Coach Test UL 2', saved.json);
const after = await admin.from('exercises').select('id', { count: 'exact', head: true });
check('saveSplit reused catalog rows (no new exercises)', before.count === after.count, { before: before.count, after: after.count });
const { data: split2 } = await admin
  .from('splits')
  .select('id, name, workouts ( id, name, order_index, workout_exercises ( order_index, sets, rep_range, exercises ( name ) ) )')
  .eq('user_id', userId)
  .eq('name', 'Coach Test UL 2')
  .single();
const w2 = [...((split2 as any)?.workouts ?? [])].sort((a: any, b: any) => a.order_index - b.order_index);
check('saved days in order', w2.map((w: any) => w.name).join('|') === 'Day One|Core Extra', w2.map((w: any) => w.name));
check('saved exercises use catalog spelling', w2[0]?.workout_exercises.map((e: any) => e.exercises.name).sort().join('|') === 'Lat Pulldown|Leg Press');

// --- RLS: the test user sees only their own rows; AI usage is not readable or callable ---
const asUser = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
});
const own = await asUser.from('workouts').select('id, splits!inner(user_id)');
check('RLS: only own workouts visible', !own.error && (own.data ?? []).every((w: any) => w.splits.user_id === userId) && (own.data ?? []).length === 5, own.data?.length);
const usage = await asUser.from('ai_usage').select('*');
check('RLS: ai_usage not readable by users', (usage.data ?? []).length === 0);
const rpc = await asUser.rpc('increment_ai_usage', { p_user_id: userId, p_buckets: ['x'] });
check('increment_ai_usage not callable by users', rpc.error !== null, rpc.error?.message);

// --- log three sessions on the coach-built split through the real submit endpoint ---
const { data: upper } = await admin
  .from('workouts')
  .select('id, splits!inner(user_id, name)')
  .eq('splits.user_id', userId)
  .eq('splits.name', 'Coach Test UL')
  .eq('name', 'Upper A')
  .single();
const workoutId = (upper as any).id;
const sessionsToLog = [
  { date: '2026-09-15T22:00:00.000Z', press: [[70, 8], [70, 7], [65, 8], [65, 8]], pull: [[120, 10], [120, 9], [110, 10], [110, 10]], curl: [[25, 12], [25, 11], [25, 10]] },
  { date: '2026-09-22T22:00:00.000Z', press: [[75, 7], [70, 8], [70, 8], [65, 9]], pull: [[130, 8], [120, 10], [120, 10], [110, 12]], curl: [[30, 10], [25, 12], [25, 12]] },
  { date: '2026-09-29T22:00:00.000Z', press: [[75, 8], [75, 7], [70, 8], [70, 8]], pull: [[130, 9], [130, 8], [120, 10], [120, 10]], curl: [[30, 11], [30, 10], [25, 13]] },
];
for (const s of sessionsToLog) {
  const rows = [
    ...s.press.map(([weight, reps], i) => ({ date: s.date, split: 'Coach Test UL', day: 'Upper A', exercise: 'Flat Dumbbell Press', setNumber: i + 1, weight, reps, rir: 1 })),
    ...s.pull.map(([weight, reps], i) => ({ date: s.date, split: 'Coach Test UL', day: 'Upper A', exercise: 'Lat Pulldown', setNumber: i + 1, weight, reps, rir: 1 })),
    ...s.curl.map(([weight, reps], i) => ({ date: s.date, split: 'Coach Test UL', day: 'Upper A', exercise: 'Zz Coach Test Curl', setNumber: i + 1, weight, reps, rir: 1 })),
  ];
  const res = await call('/api/appendWorkout', { body: { rows, workout_id: workoutId } });
  check(`appendWorkout ${s.date.slice(0, 10)} → 200`, res.status === 200, res.text.slice(0, 200));
}

// --- existing read endpoints work for a brand-new user on a coach-built split ---
const dash = await call('/api/getDashboard', { method: 'GET' });
check('getDashboard → 200', dash.status === 200, dash.text.slice(0, 200));
const peak = await call('/api/getPeak', { method: 'GET' });
const peakLabels = (peak.json?.groups ?? []).flatMap((g: any) => g.lifts.map((l: any) => l.label));
check('getPeak → 200 and scores every logged exercise', peak.status === 200 && peakLabels.length === 3, peakLabels);
const recent = await call(`/api/getRecentLifts?exercise=${encodeURIComponent('Zz Coach Test Curl')}&targetSets=3&targetRepRange=10-15`, { method: 'GET' });
check('getRecentLifts for a custom exercise → 200', recent.status === 200, recent.text.slice(0, 200));
console.log('   recommended plan for custom exercise:', JSON.stringify(recent.json?.recommendedPlan), recent.json?.planPhase);

// --- coach lookups against real rows ---
const rows = await loadCoachRows(admin, userId);
check('loadCoachRows returns the logged sets', rows.length === 33, rows.length);
let rowsCalls = 0;
const ctx = { rows: async () => { rowsCalls += 1; return rows; }, splits: async () => 'splits-stub', now: new Date('2026-10-03T12:00:00Z'), charts: [] as any[] };
const tool = async (name: string, input: unknown = {}) => runCoachTool(name, input, ctx);

const list = await tool('list_exercises');
check('list_exercises', Array.isArray(list.result) && (list.result as any[]).length === 3);
const hist = await tool('get_exercise_history', { exercise: 'dumbbell press', sessions: 2 });
check('get_exercise_history loose match + limit', (hist.result as any).exercise === 'Flat Dumbbell Press' && (hist.result as any).sessions.length === 2 && (hist.result as any).totalSessions === 3, hist.result);
check('get_exercise_history unknown → guidance, not an error', typeof (await tool('get_exercise_history', { exercise: 'deadlift' })).result === 'string');
check('get_exercise_history missing arg → error', (await tool('get_exercise_history', {})).isError === true);
const sessions = await tool('get_recent_sessions', { count: 99 });
check('get_recent_sessions clamps count', (sessions.result as any[]).length === 3 && (sessions.result as any[])[0].date === '2026-09-29');
const weeks = await tool('get_weekly_summary', { weeks: 4 });
check('get_weekly_summary', (weeks.result as any[]).length === 4 && (weeks.result as any[]).map((w: any) => w.sessions).join(',') === '0,1,1,1', weeks.result);
const muscles = await tool('get_muscle_summary', { weeks: 4 });
const chest = (muscles.result as any[]).find((m: any) => m.group === 'Chest');
const biceps = (muscles.result as any[]).find((m: any) => m.group === 'Biceps');
check('get_muscle_summary classifies catalog and custom exercises', chest?.sets === 12 && biceps?.sets === 9, { chest, biceps });
const records = await tool('get_personal_records');
check('get_personal_records', (records.result as any[])[0].exercise === 'Lat Pulldown');
check('unknown tool → error', (await tool('drop_tables')).isError === true);
check('show_chart valid', (await tool('show_chart', { type: 'line', title: 'Press', labels: ['Sep 15', 'Sep 22', 'Sep 29'], series: [{ name: 'e1RM', values: [88.7, 93.3, 95] }] })).isError !== true && ctx.charts.length === 1);
check('show_chart invalid → error fed back to the model', (await tool('show_chart', { type: 'pie', labels: [], series: [] })).isError === true && ctx.charts.length === 1);
await tool('show_chart', { type: 'bar', title: 'Sets', labels: ['a'], series: [{ name: 's', values: [1] }] });
check('show_chart capped at two per answer', (await tool('show_chart', { type: 'bar', title: 'x', labels: ['a'], series: [{ name: 's', values: [1] }] })).isError === true && ctx.charts.length === 2);

// --- the same lookups on the largest real log, for shape and speed ---
const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
const owner = users.users.find((u) => u.email === 'timvancau@gmail.com');
if (owner) {
  const t0 = Date.now();
  const ownerRows = await loadCoachRows(admin, owner.id);
  const loadMs = Date.now() - t0;
  const octx = { rows: async () => ownerRows, splits: async () => null, now: new Date(), charts: [] as any[] };
  const sizes: Record<string, number> = {};
  for (const [name, input] of [['list_exercises', {}], ['get_recent_sessions', { count: 15 }], ['get_weekly_summary', { weeks: 26 }], ['get_muscle_summary', { weeks: 8 }], ['get_personal_records', {}], ['get_exercise_history', { exercise: 'incline press', sessions: 40 }]] as const) {
    sizes[name] = JSON.stringify((await runCoachTool(name, input, octx)).result).length;
  }
  check('largest log loads and every lookup stays small', ownerRows.length > 500 && loadMs < 8000 && Object.values(sizes).every((n) => n > 2 && n < 20000), { rows: ownerRows.length, loadMs, sizes });
  console.log('   owner log:', ownerRows.length, 'sets, loaded in', loadMs, 'ms; result sizes (chars):', JSON.stringify(sizes));
}

// --- rate limiter ---
const scope = `test-${Date.now()}`;
const caps = { perMinute: 2, perDay: 100, perMonth: 100 };
const r1 = await checkAiRateLimit(admin, userId, scope, caps);
const r2 = await checkAiRateLimit(admin, userId, scope, caps);
const r3 = await checkAiRateLimit(admin, userId, scope, caps);
check('rate limit allows up to the cap then blocks', r1 === null && r2 === null && typeof r3 === 'string', { r1, r2, r3 });
await admin.from('ai_usage').delete().eq('user_id', userId).like('bucket', `${scope}:%`);

// --- coach endpoints with a token (the dev server has no API key configured) ---
const chat = await call('/api/coachChat', { body: { messages: [{ role: 'user', content: 'How is my press going?' }] } });
console.log('   coachChat with token →', chat.status, chat.json?.error ?? '');
const ob = await call('/api/onboardingChat', { body: { messages: [{ role: 'user', content: 'hi' }] } });
console.log('   onboardingChat with token →', ob.status, ob.json?.error ?? '');

// --- cleanup: remove the extra split made by this script ---
if (split2) await admin.from('splits').delete().eq('id', (split2 as any).id);

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED:', f);

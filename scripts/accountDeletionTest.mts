// End-to-end check of data export and account deletion, using a throwaway account.
// Run against the local dev server:  npx tsx --env-file=.env.local scripts/accountDeletionTest.mts
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

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

async function totals(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ['splits', 'workouts', 'workout_exercises', 'sessions', 'lift_sets', 'historical_lift_sets', 'exercises']) {
    const { count } = await admin.from(table).select('*', { count: 'exact', head: true });
    out[table] = count ?? -1;
  }
  const { data } = await admin.auth.admin.listUsers({ perPage: 500 });
  out.users = data.users.length;
  return out;
}

const before = await totals();

const email = `delete-test-${randomBytes(4).toString('hex')}@example.com`;
const password = randomBytes(12).toString('base64url');
const signup = await fetch(`${BASE}/api/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, invite_code: 'VAN2026' }),
});
check('throwaway signup → 200', signup.status === 200);
const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
const token = signIn.session!.access_token;
const userId = signIn.user!.id;

async function call(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

// Give the account a split and a logged session, using only exercises already in the catalog.
const save = await call('/api/saveSplit', {
  body: { draft: { name: 'Delete Me', days: [{ name: 'Day A', exercises: [{ name: 'Leg Press', sets: 3, repRange: '8-12' }, { name: 'Lat Pulldown', sets: 3, repRange: '8-12' }] }] } },
});
check('saveSplit → 200', save.status === 200, save.text);
const { data: workout } = await admin.from('workouts').select('id, splits!inner(user_id)').eq('splits.user_id', userId).single();
const date = '2026-10-01T22:00:00.000Z';
const append = await call('/api/appendWorkout', {
  body: {
    workout_id: (workout as any).id,
    rows: [1, 2, 3].map((n) => ({ date, split: 'Delete Me', day: 'Day A', exercise: 'Leg Press', setNumber: n, weight: 200, reps: 10, rir: 1 })),
  },
});
check('appendWorkout → 200', append.status === 200, append.text.slice(0, 200));

// --- export ---
check('exportData POST → 405', (await call('/api/exportData', { body: {} })).status === 405);
const exported = await call('/api/exportData', { method: 'GET' });
const ex = exported.json ?? {};
check('exportData → 200 with the split and the session', exported.status === 200 && ex.splits?.length === 1 && ex.splits[0].name === 'Delete Me' && ex.sessions?.length === 1 && ex.sessions[0].lift_sets?.length === 3, {
  splits: ex.splits?.length, sessions: ex.sessions?.length,
});
check('export holds only this account', !exported.text.includes('timvancau') && !exported.text.includes('PPLs'));

// --- the catalog is no longer editable by ordinary users ---
const asUser = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
const rename = await asUser.from('exercises').update({ name: 'Hacked' }).eq('name', 'Leg Press').select('id');
check('RLS: user cannot rename a catalog exercise', (rename.data ?? []).length === 0);
const remove = await asUser.from('exercises').delete().eq('name', 'Standing Calf Raise').select('id');
check('RLS: user cannot delete a catalog exercise', (remove.data ?? []).length === 0);
const stillThere = await admin.from('exercises').select('name').in('name', ['Leg Press', 'Standing Calf Raise']);
check('catalog rows untouched', (stillThere.data ?? []).length === 2);

// --- delete: needs the right confirmation ---
check('deleteAccount GET → 405', (await call('/api/deleteAccount', { method: 'GET' })).status === 405);
check('deleteAccount without confirmation → 400', (await call('/api/deleteAccount', { body: {} })).status === 400);
check('deleteAccount with another email → 400', (await call('/api/deleteAccount', { body: { confirmEmail: 'timvancau@gmail.com' } })).status === 400);
const { data: stillUser } = await admin.auth.admin.getUserById(userId);
check('account still exists after rejected attempts', stillUser.user?.id === userId);

const del = await call('/api/deleteAccount', { body: { confirmEmail: ` ${email.toUpperCase()} ` } });
check('deleteAccount with own email → 200', del.status === 200, del.text);
const { data: goneUser } = await admin.auth.admin.getUserById(userId);
check('user is gone', !goneUser.user);
const leftovers = await Promise.all([
  admin.from('splits').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  admin.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
]);
check('no splits or sessions left behind', leftovers.every((r) => r.count === 0), leftovers.map((r) => r.count));
check('old token no longer works', (await call('/api/exportData', { method: 'GET' })).status === 401);

const after = await totals();
check('every other user\'s data is exactly as it was', JSON.stringify(before) === JSON.stringify(after), { before, after });

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED:', f);

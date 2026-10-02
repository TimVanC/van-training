/**
 * Load the JSON produced by scripts/parseHistoricalSplits.py into
 * `historical_lift_sets` for one user. Re-runnable: rows are upserted on
 * (user_id, session_key, exercise_name, set_number), and any existing rows
 * for the same split abbreviations that are no longer in the file are deleted
 * so a re-parse fully replaces a split.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/importHistoricalLifts.ts <user-email> <path/to/historical_lifts.json>
 */

import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

interface ParsedSet {
  split_name: string;
  split_abbr: string;
  day_name: string;
  session_key: string;
  session_index: number;
  date: string;
  date_estimated: boolean;
  exercise_name: string;
  set_number: number;
  weight: number;
  reps: number;
  target_reps: number | null;
  is_drop_set: boolean;
  raw_cell: string | null;
  notes: string | null;
  excluded_reason: string | null;
}

const BATCH = 500;

async function main(): Promise<void> {
  const [email, jsonPath] = process.argv.slice(2);
  if (!email || !jsonPath) {
    throw new Error('usage: importHistoricalLifts.ts <user-email> <historical_lifts.json>');
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, key);

  const users = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (users.error) throw users.error;
  const user = users.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No auth user with email ${email}`);

  const rows = JSON.parse(await readFile(jsonPath, 'utf8')) as ParsedSet[];
  const abbrs = [...new Set(rows.map((r) => r.split_abbr))];
  console.log(`importing ${rows.length} sets for ${email} (${abbrs.join(', ')})`);

  const payload = rows.map((r) => ({ ...r, user_id: user.id }));
  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    const { error } = await supabase
      .from('historical_lift_sets')
      .upsert(chunk, { onConflict: 'user_id,session_key,exercise_name,set_number' });
    if (error) throw error;
    console.log(`  upserted ${Math.min(i + BATCH, payload.length)}/${payload.length}`);
  }

  // Remove rows from these splits that the new parse no longer produces.
  const keep = new Set(rows.map((r) => `${r.session_key}|${r.exercise_name}|${r.set_number}`));
  const existing = await supabase
    .from('historical_lift_sets')
    .select('id, session_key, exercise_name, set_number')
    .eq('user_id', user.id)
    .in('split_abbr', abbrs)
    .limit(10000);
  if (existing.error) throw existing.error;
  const stale = (existing.data ?? [])
    .filter((r) => !keep.has(`${r.session_key}|${r.exercise_name}|${r.set_number}`))
    .map((r) => r.id);
  if (stale.length > 0) {
    const { error } = await supabase.from('historical_lift_sets').delete().in('id', stale);
    if (error) throw error;
    console.log(`  deleted ${stale.length} stale rows`);
  }
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

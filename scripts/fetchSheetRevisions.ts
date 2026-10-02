/**
 * Download every revision of one or more Google Sheets as .xlsx so their edit
 * history can be diffed (scripts/deriveSessionDates.py uses the result to
 * date the spreadsheet-era training sessions).
 *
 * Auth: the service account in GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY; the
 * sheets must be shared with it (view access is enough).
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/fetchSheetRevisions.ts <out-dir> "<name match>" ["<name match>" ...]
 *
 * Each sheet lands in <out-dir>/<sanitised name>/<modifiedTime>__<revisionId>.xlsx
 * plus a revisions.json manifest.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function main(): Promise<void> {
  const [outDir, ...patterns] = process.argv.slice(2);
  if (!outDir || patterns.length === 0) {
    throw new Error('usage: fetchSheetRevisions.ts <out-dir> "<name match>" [...]');
  }
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) throw new Error('Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY');

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const listed = await drive.files.list({
    q: "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
    fields: 'files(id, name, modifiedTime, owners(emailAddress))',
    pageSize: 200,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  const files = listed.data.files ?? [];
  console.log(`visible spreadsheets: ${files.map((f) => f.name).join(' | ')}`);

  for (const pattern of patterns) {
    const needle = pattern.toLowerCase();
    const matches = files.filter((f) => (f.name ?? '').toLowerCase().includes(needle));
    if (matches.length !== 1) {
      console.warn(`pattern "${pattern}" matched ${matches.length} sheets, skipping: ${matches.map((m) => m.name).join(', ')}`);
      continue;
    }
    const file = matches[0];
    const folder = path.join(outDir, (file.name ?? file.id ?? 'sheet').replace(/[^\w.-]+/g, '_'));
    mkdirSync(folder, { recursive: true });

    const revisions: Array<{ id: string; modifiedTime: string; exportLinks?: Record<string, string> }> = [];
    let pageToken: string | undefined;
    do {
      const page = await drive.revisions.list({
        fileId: file.id!,
        fields: 'nextPageToken, revisions(id, modifiedTime, exportLinks, lastModifyingUser(emailAddress))',
        pageSize: 1000,
        pageToken,
      });
      for (const r of page.data.revisions ?? []) {
        if (r.id && r.modifiedTime) revisions.push({ id: r.id, modifiedTime: r.modifiedTime, exportLinks: r.exportLinks ?? undefined });
      }
      pageToken = page.data.nextPageToken ?? undefined;
    } while (pageToken);
    revisions.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
    console.log(`${file.name}: ${revisions.length} revisions (${revisions[0]?.modifiedTime} .. ${revisions.at(-1)?.modifiedTime})`);
    writeFileSync(path.join(folder, 'revisions.json'), JSON.stringify({ file, revisions }, null, 1));

    const token = (await auth.getAccessToken()).token;
    let done = 0;
    for (const rev of revisions) {
      const target = path.join(folder, `${rev.modifiedTime.replace(/[:]/g, '-')}__${rev.id}.xlsx`);
      if (existsSync(target)) {
        done += 1;
        continue;
      }
      const url = rev.exportLinks?.[XLSX];
      if (!url) {
        console.warn(`  revision ${rev.id} has no xlsx export link`);
        continue;
      }
      let attempt = 0;
      for (;;) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          writeFileSync(target, Buffer.from(await res.arrayBuffer()));
          break;
        }
        attempt += 1;
        if (attempt > 4) throw new Error(`export failed for ${rev.id}: ${res.status} ${await res.text()}`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
      done += 1;
      if (done % 25 === 0) console.log(`  ${done}/${revisions.length}`);
    }
    console.log(`  saved ${done} revisions to ${folder}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/* Import the Douyin learning ledger into Supabase learning_sessions.
 *
 * Run:  node tools/import-douyin.mjs [--dry]
 *
 * Reads ~/douyin-learning/index.json, maps it with learning/douyin-import.js,
 * and INSERTS only the entries that are not in the table yet. Rows already
 * there are left untouched — see splitForImport for why that matters more than
 * refreshing their captions.
 *
 * Dependency-free: Node's built-in fetch against PostgREST, not supabase-js
 * (which only loads from esm.sh in a browser).
 *
 * Credentials: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from life-os/.env. The
 * previous version required SUPABASE_USER_EMAIL / SUPABASE_USER_PASSWORD, which
 * have never been in that file — this tool has been unrunnable since it was
 * written, and it also imported a module (learning/douyin-import.js) that was
 * never committed. Both are fixed here. The service role bypasses RLS, so the
 * owning user is resolved from the admin API and set explicitly on every row.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toLearningRows, splitForImport, summarise } from '../learning/douyin-import.js';

const LEDGER_PATH = join(homedir(), 'douyin-learning', 'index.json');
const ENV_PATH = new URL('../.env', import.meta.url).pathname;
const DRY = process.argv.includes('--dry');
const CHUNK = 200; // PostgREST handles this comfortably; keeps one bad row's blast radius small

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

async function main() {
  const env = loadEnv(ENV_PATH);
  const URL_ = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const usersRes = await fetch(`${URL_}/auth/v1/admin/users?per_page=1`, { headers: H });
  if (!usersRes.ok) throw new Error(`Could not resolve the user (${usersRes.status})`);
  const users = (await usersRes.json()).users || [];
  if (!users.length) throw new Error('No user in this project — sign in to life-os once first.');
  const userId = users[0].id;

  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  const videos = ledger.videos || ledger.items || (Array.isArray(ledger) ? ledger : []);
  /* An empty ledger is a failure, not a no-op: the file has had a `videos` key
   * for its whole life, and silently importing nothing because a key was
   * renamed is exactly how a broken pipeline reports success. */
  if (!videos.length) throw new Error(`No videos found in ${LEDGER_PATH} — check its shape before trusting this run`);

  const rows = toLearningRows(videos, userId);

  const existRes = await fetch(
    `${URL_}/rest/v1/learning_sessions?user_id=eq.${userId}&source=eq.douyin&select=external_id`,
    { headers: { ...H, Prefer: 'count=exact' } },
  );
  if (!existRes.ok) throw new Error(`Could not read existing rows (${existRes.status})`);
  const existing = new Set((await existRes.json()).map((r) => r.external_id).filter(Boolean));

  const { toInsert, skipped } = splitForImport(rows, existing);

  console.log(`ledger:      ${videos.length} entr(ies) → ${rows.length} mappable row(s)`);
  console.log(`already in:  ${skipped.length} (left untouched — a hand-made verdict must survive a re-run)`);
  console.log(`to insert:   ${toInsert.length}`);
  console.log(`verdicts of the new rows: ${JSON.stringify(summarise(toInsert))}`);
  if (!toInsert.length) { console.log('\nNothing to do.'); return; }
  if (DRY) { console.log('\n--dry: nothing written.'); return; }

  let written = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const batch = toInsert.slice(i, i + CHUNK);
    const res = await fetch(
      `${URL_}/rest/v1/learning_sessions?on_conflict=user_id,source,external_id`,
      { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(batch) },
    );
    if (!res.ok) throw new Error(`Insert failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    written += (await res.json()).length;
  }

  /* Count what is actually in the table afterwards rather than trusting the
   * loop's own tally — the difference between "I sent 315 rows" and "315 rows
   * are there" is the whole reason the backup rewrite exists. */
  const afterRes = await fetch(
    `${URL_}/rest/v1/learning_sessions?user_id=eq.${userId}&source=eq.douyin&select=external_id`,
    { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } },
  );
  const total = Number(String(afterRes.headers.get('content-range') || '').split('/')[1]);
  console.log(`\ninserted ${written} row(s); the table now holds ${total} douyin row(s).`);
  if (Number.isFinite(total) && total !== existing.size + written) {
    console.log(`WARNING: expected ${existing.size + written} — something else wrote to this table during the run.`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

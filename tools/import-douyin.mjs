#!/usr/bin/env node
/* Import the Douyin learning ledger into Supabase learning_sessions.
 *
 * Reads ~/douyin-learning/index.json, signs in as the app user (anon key +
 * email/password → RLS applies, user_id = auth.uid()), maps the ledger via
 * toLearningRows, then upserts on (user_id, source, external_id) via PostgREST.
 *
 * Dependency-free: uses Node's built-in fetch (Node 18+) against the REST API —
 * NOT supabase-js, which can only be loaded from esm.sh in a browser, not Node.
 *
 * Requires in life-os/.env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD
 * Does NOT use service_role for the write.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toLearningRows } from '../learning/douyin-import.js';

const LEDGER_PATH = join(homedir(), 'douyin-learning', 'index.json');
const ENV_PATH = new URL('../.env', import.meta.url).pathname;

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
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD } = env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in .env');
  if (!SUPABASE_USER_EMAIL || !SUPABASE_USER_PASSWORD) {
    throw new Error('Missing SUPABASE_USER_EMAIL / SUPABASE_USER_PASSWORD in .env — add them before running.');
  }

  // 1) sign in (password grant) → access token + user id
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SUPABASE_USER_EMAIL, password: SUPABASE_USER_PASSWORD }),
  });
  if (!authRes.ok) throw new Error(`Sign-in failed (${authRes.status})`);
  const auth = await authRes.json();
  const userId = auth.user.id;

  // 2) map ledger → rows
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  const now = new Date().toISOString();
  const rows = toLearningRows(ledger.videos || [], userId).map((r) => ({ ...r, synced_at: now }));
  if (!rows.length) { console.log('No videos in ledger — nothing to import.'); return; }

  // 3) upsert on the (user_id, source, external_id) unique index
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/learning_sessions?on_conflict=user_id,source,external_id`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw new Error(`Upsert failed (${res.status}): ${await res.text()}`);
  console.log(`Upserted ${rows.length} row(s) into learning_sessions (source=douyin).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

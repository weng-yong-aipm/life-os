#!/usr/bin/env node
/* Import the curated Books library into Supabase learning_sessions (source='book').
 *
 * Uses the same service-role + auto-user-resolve path as scripts/ingest-feed.mjs
 * (no email/password needed). Upserts on (user_id, source, external_id) so re-runs
 * are idempotent and never clobber a book you've already triaged.
 *
 * Requires in life-os/.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: LIFE_OS_USER_ID (else the first auth user is used).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKS, toLearningRows } from '../learning/books.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* rely on process.env */ }
  return env;
}
const ENV = loadEnv();
const SB = ENV.SUPABASE_URL;
const SVC = ENV.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = (extra = {}) => ({ apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...extra });

async function getUserId() {
  if (ENV.LIFE_OS_USER_ID) return ENV.LIFE_OS_USER_ID;
  const res = await fetch(`${SB}/auth/v1/admin/users?per_page=1`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`admin/users ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const users = Array.isArray(body) ? body : body.users;
  if (!users || !users.length) throw new Error('No auth users found — sign in to life-os once, or set LIFE_OS_USER_ID.');
  return users[0].id;
}

async function main() {
  if (!SB || !SVC) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
  const userId = await getUserId();
  const now = new Date().toISOString();
  const rows = toLearningRows(BOOKS, userId).map((r) => ({ ...r, learned_on: now.slice(0, 10), synced_at: now }));

  const res = await fetch(`${SB}/rest/v1/learning_sessions?on_conflict=user_id,source,external_id`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Upsert failed (${res.status}): ${await res.text()}`);
  console.log(`Upserted ${rows.length} book(s) into learning_sessions (source=book).`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });

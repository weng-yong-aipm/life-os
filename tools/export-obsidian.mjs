#!/usr/bin/env node
/* Export life-os knowledge rows to an Obsidian vault as markdown notes.
 *
 * The "knowledge = Obsidian" half of the authority split: learning_sessions
 * become linkable .md notes (frontmatter carries the join keys). Filenames are
 * stable per row, so re-running overwrites in place (idempotent).
 *
 * Dependency-free: Node built-in fetch + fs. Signs in with the app user
 * (anon + email/password → RLS) — NOT service_role.
 *
 * Requires in life-os/.env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD
 * Vault: ~/life-os-vault/learning/  (created if missing; DevNotes is never touched).
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toNote } from '../learning/obsidian-export.js';

const VAULT_DIR = join(homedir(), 'life-os-vault', 'learning');
const ENV_PATH = new URL('../.env', import.meta.url).pathname;

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim()] = v;
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

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SUPABASE_USER_EMAIL, password: SUPABASE_USER_PASSWORD }),
  });
  if (!authRes.ok) throw new Error(`Sign-in failed (${authRes.status})`);
  const { access_token } = await authRes.json();

  const rowsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/learning_sessions?select=id,source,external_id,learned_on,title,summary,link,tags,synced_at&order=learned_on.desc`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}` } },
  );
  if (!rowsRes.ok) throw new Error(`Fetch failed (${rowsRes.status}): ${await rowsRes.text()}`);
  const rows = await rowsRes.json();

  mkdirSync(VAULT_DIR, { recursive: true });
  for (const row of rows) {
    const { filename, content } = toNote(row);
    writeFileSync(join(VAULT_DIR, filename), content);
  }
  console.log(`Wrote ${rows.length} note(s) to ${VAULT_DIR}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

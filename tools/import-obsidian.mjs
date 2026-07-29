#!/usr/bin/env node
/* Reverse sync: push Obsidian note edits back to Supabase learning_sessions.
 *
 * The other half of the two-way loop. Obsidian is authoritative for prose, so
 * this updates ONLY title + summary, matched by the lifeos_id frontmatter key.
 * Structured fields (source, dates, external_id) are never touched. Idempotent:
 * re-running writes the same prose. Run-by-hand v1 (no file watcher yet).
 *
 * Dependency-free: Node built-in fetch + fs. Password-grant (RLS), not service_role.
 * Requires in life-os/.env: SUPABASE_URL, SUPABASE_ANON_KEY,
 *   SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseNote } from '../learning/obsidian-parse.js';

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
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${access_token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  const files = readdirSync(VAULT_DIR).filter((f) => f.endsWith('.md'));
  let updated = 0;
  for (const f of files) {
    const note = parseNote(readFileSync(join(VAULT_DIR, f), 'utf8'));
    if (!note.lifeos_id) continue; // not a life-os note
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/learning_sessions?id=eq.${encodeURIComponent(note.lifeos_id)}`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: note.title, summary: note.summary }) },
    );
    if (!res.ok) throw new Error(`Update failed for ${f} (${res.status}): ${await res.text()}`);
    updated += 1;
  }
  console.log(`Synced ${updated} note(s) back to learning_sessions (title + summary).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

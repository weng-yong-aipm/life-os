#!/usr/bin/env node
/* Prepare an upload-ready NotebookLM source bundle from life-os learning items.
 *
 * HONEST REALITY: NotebookLM has NO public API — there is no way to "push"
 * programmatically. So this tool does the reliable half: it assembles ONE
 * well-structured markdown document (every learning item's study guide,
 * flashcards, and quiz) and writes it to the vault. You then open NotebookLM
 * and add that file as a source (one drag/upload). That's the correct,
 * non-fake deliverable.
 *
 * (Future option, deliberately OUT of scope: a Playwright/browser-automation
 * step could log into Google and upload the file, but it's fragile — 2FA,
 * consent screens, DOM churn — and needs an interactive Google login, so it is
 * not built here.)
 *
 * Dependency-free: Node built-in fetch + fs. Signs in as the app user
 * (anon key + email/password → RLS), NOT service_role.
 *
 * Requires in life-os/.env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD
 * Usage: node tools/push-notebooklm.mjs <date>   e.g. node tools/push-notebooklm.mjs 2026-07-29
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildBundle } from '../learning/notebooklm-bundle.js';

const OUT_DIR = join(homedir(), 'life-os-vault', 'notebooklm');
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
  // Optional filename label (a version stamp). The bundle always includes ALL
  // learning_materials — this arg does NOT filter by date, it just names the file.
  const label = process.argv[2] || 'all';

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
  if (!access_token) throw new Error('Sign-in returned no access token');

  const rowsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/learning_materials?select=content,learning_sessions(title,learned_on)&order=created_at.desc`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}` } },
  );
  if (!rowsRes.ok) throw new Error(`Fetch failed (${rowsRes.status}): ${await rowsRes.text()}`);
  const rows = await rowsRes.json();
  if (!rows.length) throw new Error('No learning_materials found — run tools/gen-materials.mjs first.');

  const markdown = buildBundle(rows, new Date().toISOString());
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `learnings-${label}.md`);
  writeFileSync(outPath, markdown);

  console.log(`Wrote ${rows.length} learning item(s) to ${outPath}`);
  console.log('Next: open https://notebooklm.google.com and add this file as a source (New note → Add source → Upload).');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

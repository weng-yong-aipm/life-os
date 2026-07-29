#!/usr/bin/env node
/* Generate AI study materials for learning_sessions rows via Claude, and store
 * them in learning_materials (upsert → idempotent per learning item).
 *
 * Dependency-free: Node built-in fetch against the Anthropic + PostgREST APIs.
 * BILLABLE — each row is one Claude call. Pass a row limit (default 1) so a demo
 * run costs ~1 call; pass a big number to do the batch.
 *
 * Requires in life-os/.env: SUPABASE_URL, SUPABASE_ANON_KEY,
 *   SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD, ANTHROPIC_API_KEY.
 *   Usage: node tools/gen-materials.mjs [limit]
 */

import { readFileSync } from 'node:fs';
import { buildRequest, parseMaterial, MODEL } from '../learning/study-material.js';

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

async function generate(row, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(buildRequest(row)),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  return parseMaterial(await res.json());
}

async function main() {
  const limit = Number(process.argv[2] || 1);
  const env = loadEnv(ENV_PATH);
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD, ANTHROPIC_API_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in .env');
  if (!SUPABASE_USER_EMAIL || !SUPABASE_USER_PASSWORD) throw new Error('Missing SUPABASE_USER_EMAIL / SUPABASE_USER_PASSWORD in .env');
  if (!ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY in .env');

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SUPABASE_USER_EMAIL, password: SUPABASE_USER_PASSWORD }),
  });
  if (!authRes.ok) throw new Error(`Sign-in failed (${authRes.status})`);
  const { access_token, user } = await authRes.json();
  const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

  // rows without materials yet (left join anti-pattern via not-in is overkill; just take newest N)
  const rowsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/learning_sessions?select=id,title,summary&order=learned_on.desc&limit=${limit}`,
    { headers: H },
  );
  if (!rowsRes.ok) throw new Error(`Fetch failed (${rowsRes.status}): ${await rowsRes.text()}`);
  const rows = await rowsRes.json();

  let done = 0;
  for (const row of rows) {
    const content = await generate(row, ANTHROPIC_API_KEY);
    const up = await fetch(`${SUPABASE_URL}/rest/v1/learning_materials?on_conflict=user_id,learning_session_id`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: user.id, learning_session_id: row.id, model: MODEL, content }),
    });
    if (!up.ok) throw new Error(`Store failed for ${row.id} (${up.status}): ${await up.text()}`);
    done += 1;
    console.log(`✓ ${row.title.slice(0, 40)}`);
  }
  console.log(`Generated + stored materials for ${done} learning item(s) using ${MODEL}.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

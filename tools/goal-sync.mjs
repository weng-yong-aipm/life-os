#!/usr/bin/env node
/* Master plan -> milestones. Runs on the Mac (launchd, 07:00 + on file change).
 *
 *   node tools/goal-sync.mjs
 *
 * Reads ONE section of the private master plan (GOAL_PLAN_PATH in .env — the
 * file never enters this public repo): a table under `## Milestones (machine)`.
 * Strict on purpose: a malformed row fails the whole run with its line number
 * and writes nothing but the failure into goal_sync_status, which the morning
 * push reads. A half-synced plan would push the wrong "today's focus" silently.
 * docs/superpowers/specs/2026-10-15-unified-hub-design.md §2.1 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HEADING = /^##\s+Milestones \(machine\)\s*$/;
const COLUMNS = ['id', 'title', 'due', 'status', 'next_step'];
const STATUSES = new Set(['todo', 'doing', 'done', 'dropped']);
const ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

function isRealDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseMilestones(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => HEADING.test(l));
  if (start === -1) throw new Error('section "## Milestones (machine)" not found');
  const rows = [];
  const seen = new Set();
  let header = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.trim().startsWith('|')) continue;
    const c = cells(line);
    if (!header) {
      if (c.join('|') !== COLUMNS.join('|')) throw new Error(`line ${lineNo}: header must be | ${COLUMNS.join(' | ')} |`);
      header = true;
      continue;
    }
    if (c.every((x) => /^:?-+:?$/.test(x))) continue; // separator row
    if (c.length !== 5) throw new Error(`line ${lineNo}: expected 5 columns, got ${c.length}`);
    const [id, title, due, status, next_step] = c;
    if (!ID.test(id)) throw new Error(`line ${lineNo}: id "${id}" must be letters, digits, dashes`);
    if (!title) throw new Error(`line ${lineNo}: title is empty`);
    if (!isRealDay(due)) throw new Error(`line ${lineNo}: due "${due}" is not a real YYYY-MM-DD date`);
    if (!STATUSES.has(status)) throw new Error(`line ${lineNo}: status "${status}" must be todo|doing|done|dropped`);
    if ((status === 'todo' || status === 'doing') && !next_step) throw new Error(`line ${lineNo}: next_step is required while ${status}`);
    if (seen.has(id)) throw new Error(`line ${lineNo}: duplicate id ${id}`);
    seen.add(id);
    rows.push({ id, title, due, status, next_step });
  }
  if (!header) throw new Error('section "## Milestones (machine)" has no table');
  if (!rows.length) throw new Error('no milestone rows — refusing to drop every milestone');
  return rows;
}

export function planSync(existing, rows) {
  const keep = new Set(rows.map((r) => r.id));
  const dropIds = existing.filter((e) => !keep.has(e.id) && e.status !== 'dropped').map((e) => e.id);
  return { upserts: rows, dropIds };
}

/* ------------------------------------------------------------------- the I/O */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* Same loader as tools/gate.mjs: process.env wins over .env. */
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

async function rest(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]} -> HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };

async function main() {
  const env = loadEnv();
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOAL_PLAN_PATH', 'OWNER_USER_ID']) {
    if (!env[k]) { console.error(`goal-sync: ${k} not set`); process.exit(2); }
  }
  const user_id = env.OWNER_USER_ID;
  const now = new Date().toISOString();
  let rows;
  try {
    rows = parseMilestones(readFileSync(env.GOAL_PLAN_PATH, 'utf8'));
  } catch (err) {
    await rest(env, 'goal_sync_status', { method: 'POST', headers: upsert, body: JSON.stringify({ user_id, ok: false, error: err.message.slice(0, 300) }) });
    console.error(`goal-sync FAILED: ${err.message}`);
    process.exit(1);
  }
  const existing = await rest(env, `milestones?select=id,status&user_id=eq.${user_id}`);
  const { upserts, dropIds } = planSync(existing, rows);
  await rest(env, 'milestones', { method: 'POST', headers: upsert, body: JSON.stringify(upserts.map((r) => ({ ...r, user_id, updated_at: now }))) });
  if (dropIds.length) {
    await rest(env, `milestones?id=in.(${dropIds.join(',')})`, { method: 'PATCH', body: JSON.stringify({ status: 'dropped', updated_at: now }) });
  }
  await rest(env, 'goal_sync_status', { method: 'POST', headers: upsert, body: JSON.stringify({ user_id, synced_at: now, ok: true, error: null }) });
  console.log(`goal-sync ok: ${upserts.length} milestones, ${dropIds.length} dropped`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => { console.error(`goal-sync ERROR: ${err.message}`); process.exit(2); });
}

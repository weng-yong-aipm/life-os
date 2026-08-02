#!/usr/bin/env node
/* NotebookLM content watchdog + auto-refresh.
 *
 * HONEST SCOPE: NotebookLM has no public API. The notebooklm-mcp add_source
 * path is unreliable — it lands pasted text in a fresh "Untitled notebook"
 * instead of the intended one — so pushing INTO a specific notebook stays a
 * manual UI step. What this DOES automate reliably, with no Google login:
 *   1. Regenerate ~/life-os-vault/notebooklm/learnings-all.md from Supabase so
 *      the upload-ready source is always current.
 *   2. Watch for NEW learning items since the last run and surface a status
 *      note (UPLOAD-STATUS.md) in the Obsidian vault so you know exactly when
 *      there's fresh material to add.
 *
 * Auth: SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) so it needs no user login.
 * Reuses the committed learning/notebooklm-bundle.js formatter. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildBundle } from '../learning/notebooklm-bundle.js';

const OUT_DIR = join(homedir(), 'life-os-vault', 'notebooklm');
const BUNDLE = join(OUT_DIR, 'learnings-all.md');
const STATE = join(OUT_DIR, '.nblm-sync-state.json');
const STATUS = join(OUT_DIR, 'UPLOAD-STATUS.md');
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

function readState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); }
  catch { return { totalCount: 0, latestCreatedAt: null, lastSyncISO: null }; }
}

async function main() {
  const now = new Date().toISOString();
  const env = loadEnv(ENV_PATH);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in life-os/.env');
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/learning_materials?select=id,created_at,content,learning_sessions(title,learned_on)&order=created_at.desc`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error('No learning_materials found — run tools/gen-materials.mjs first.');

  // 1. Regenerate the upload-ready bundle.
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(BUNDLE, buildBundle(rows, now));

  // 2. Watchdog: count new items since the last sync.
  const prev = readState();
  const latestCreatedAt = rows[0].created_at || null;
  const newItems = prev.latestCreatedAt
    ? rows.filter((r) => r.created_at && r.created_at > prev.latestCreatedAt)
    : [];
  const newCount = newItems.length;

  const lines = [
    '# NotebookLM — Upload Status', '',
    `_Last synced ${now}_`, '',
    `- **Total learning items:** ${rows.length}`,
    `- **New since last sync:** ${newCount}${prev.lastSyncISO ? ` (last sync ${prev.lastSyncISO})` : ' (first sync)'}`,
    `- **Source file:** \`learnings-all.md\` (regenerated just now)`,
    '',
  ];
  if (newCount > 0) {
    lines.push(
      `## 🆕 ${newCount} new item(s) ready to add`, '',
      'Open your NotebookLM notebook → **Add source** → **Upload** (or Paste text) →',
      'pick `learnings-all.md`. Then regenerate the Audio Overview if you want it refreshed.',
      '',
      '### What\'s new', '',
      ...newItems.slice(0, 20).map((r) => `- ${r.learning_sessions?.title || 'Untitled'}${r.learning_sessions?.learned_on ? ` _(learned ${r.learning_sessions.learned_on})_` : ''}`),
    );
    if (newCount > 20) lines.push(`- …and ${newCount - 20} more`);
  } else {
    lines.push('✅ No new items since last sync — NotebookLM source is up to date.');
  }
  lines.push('');
  writeFileSync(STATUS, lines.join('\n'));

  writeFileSync(STATE, JSON.stringify({ totalCount: rows.length, latestCreatedAt, lastSyncISO: now }, null, 2));
  console.log(`[nblm-sync ${now}] ${rows.length} items, ${newCount} new → bundle + UPLOAD-STATUS.md written`);
}

main().catch((err) => { console.error(`[nblm-sync] ${err.message || err}`); process.exit(1); });

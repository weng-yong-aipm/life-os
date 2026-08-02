#!/usr/bin/env node
/* NotebookLM content watchdog + auto-refresh + auto-push.
 *
 * Each run, with no interactive login (uses the persisted notebooklm-mcp auth
 * session — browser_state/state.json):
 *   1. Regenerate ~/life-os-vault/notebooklm/learnings-all.md from Supabase so
 *      the upload-ready source is always current.
 *   2. Watchdog: write UPLOAD-STATUS.md flagging NEW items since last sync.
 *   3. Auto-push: if there are items new since the last SUCCESSFUL push, add
 *      them to the NotebookLM notebook as one text source (headless, via the
 *      notebooklm-mcp server). Guarded — a push failure never breaks 1 & 2.
 *
 * Auth: SUPABASE_SERVICE_ROLE_KEY (Supabase) + the notebooklm-mcp session.
 * Reuses the committed learning/notebooklm-bundle.js formatter. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { buildBundle } from '../learning/notebooklm-bundle.js';

const OUT_DIR = join(homedir(), 'life-os-vault', 'notebooklm');
const BUNDLE = join(OUT_DIR, 'learnings-all.md');
const STATE = join(OUT_DIR, '.nblm-sync-state.json');
const STATUS = join(OUT_DIR, 'UPLOAD-STATUS.md');
const ENV_PATH = new URL('../.env', import.meta.url).pathname;
const NOTEBOOK_ID = process.env.NBLM_NOTEBOOK_ID || 'life-os-learnings-1';

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
  catch { return { totalCount: 0, latestCreatedAt: null, lastSyncISO: null, lastPushedCreatedAt: null }; }
}

/* Call one notebooklm-mcp tool over stdio JSON-RPC. Resolves the parsed result
 * (or {success:false,error} on timeout/crash). Never calls setup_auth. */
function callTool(name, args, timeoutMs = 240000) {
  return new Promise((resolve) => {
    const env = { ...process.env, HEADLESS: 'true', BROWSER_CHANNEL: 'chrome' };
    const srv = spawn('npx', ['-y', 'notebooklm-mcp@latest'], { stdio: ['pipe', 'pipe', 'ignore'], env });
    let buf = '';
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { srv.kill(); } catch {} resolve(v); };
    srv.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2) {
            const txt = msg.result?.content?.[0]?.text;
            try { finish(JSON.parse(txt)); } catch { finish(msg.result ?? msg.error ?? { success: false, error: 'no result' }); }
          }
        } catch { /* server log */ }
      }
    });
    srv.on('error', (e) => finish({ success: false, error: String(e) }));
    const send = (o) => { try { srv.stdin.write(JSON.stringify(o) + '\n'); } catch {} };
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'nblm-sync', version: '1.0' } } });
    setTimeout(() => {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    }, 4000);
    setTimeout(() => finish({ success: false, error: 'timeout' }), timeoutMs);
  });
}

async function pushNewItems(newRows, now) {
  // Guard: check auth first so we don't paste into an unauthenticated session.
  const health = await callTool('get_health', {}, 60000);
  const authed = health?.data?.authenticated === true;
  if (!authed) return { pushed: false, reason: 'not authenticated (session lapsed — re-run visible login)' };

  const content = buildBundle(newRows, now);
  const title = `Life-OS Learnings — new ${now.slice(0, 10)}`;
  const res = await callTool('add_source', { type: 'text', content, title, notebook_id: NOTEBOOK_ID }, 240000);
  const ok = res?.success === true && (res?.data?.result?.success !== false);
  return ok ? { pushed: true } : { pushed: false, reason: res?.error || JSON.stringify(res).slice(0, 200) };
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

  // 1. Regenerate the upload-ready bundle (full set).
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(BUNDLE, buildBundle(rows, now));

  const prev = readState();
  const latestCreatedAt = rows[0].created_at || null;
  const newSinceSync = prev.latestCreatedAt ? rows.filter((r) => r.created_at > prev.latestCreatedAt) : [];

  // 3. Auto-push items new since the last successful push into NotebookLM.
  const newSincePush = prev.lastPushedCreatedAt
    ? rows.filter((r) => r.created_at && r.created_at > prev.lastPushedCreatedAt)
    : [];
  let pushResult = { pushed: false, reason: 'nothing new to push' };
  let lastPushedCreatedAt = prev.lastPushedCreatedAt || latestCreatedAt; // baseline: don't push pre-existing
  if (newSincePush.length) {
    try {
      pushResult = await pushNewItems(newSincePush, now);
      if (pushResult.pushed) lastPushedCreatedAt = newSincePush[0].created_at; // rows desc → [0] is newest
    } catch (e) {
      pushResult = { pushed: false, reason: String(e.message || e) };
    }
  }

  // 2. Status note in the Obsidian vault.
  const lines = [
    '# NotebookLM — Upload Status', '',
    `_Last synced ${now}_`, '',
    `- **Total learning items:** ${rows.length}`,
    `- **New since last sync:** ${newSinceSync.length}${prev.lastSyncISO ? ` (last sync ${prev.lastSyncISO})` : ' (first sync)'}`,
    `- **Auto-push to NotebookLM:** ${pushResult.pushed ? `✅ pushed ${newSincePush.length} new item(s)` : (newSincePush.length ? `⚠️ ${newSincePush.length} pending — ${pushResult.reason}` : '✅ up to date')}`,
    `- **Source file:** \`learnings-all.md\` (regenerated just now)`,
    `- **Notebook:** \`${NOTEBOOK_ID}\``, '',
  ];
  if (!pushResult.pushed && newSincePush.length) {
    lines.push(
      `## ⚠️ ${newSincePush.length} new item(s) not auto-pushed`, '',
      'Auto-push didn\'t complete this run (reason above). Fallback: drag `learnings-all.md`',
      'into your NotebookLM notebook manually, or it retries automatically next run.', '',
    );
  } else if (pushResult.pushed) {
    lines.push('✅ New learnings were pushed into NotebookLM automatically — nothing to do.', '');
  } else {
    lines.push('✅ NotebookLM is up to date — no new learnings since last push.', '');
  }
  writeFileSync(STATUS, lines.join('\n'));

  writeFileSync(STATE, JSON.stringify({ totalCount: rows.length, latestCreatedAt, lastSyncISO: now, lastPushedCreatedAt }, null, 2));
  console.log(`[nblm-sync ${now}] ${rows.length} items · ${newSinceSync.length} new · push=${pushResult.pushed ? 'ok' : pushResult.reason}`);
}

main().catch((err) => { console.error(`[nblm-sync] ${err.message || err}`); process.exit(1); });

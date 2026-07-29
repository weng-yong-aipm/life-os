#!/usr/bin/env node
/* Obsidian bridge daemon — the always-on two-way sync between Supabase
 * learning_sessions and the ~/life-os-vault/learning vault.
 *
 * Run by hand:  node tools/lifeos-bridge.mjs   (Ctrl-C to stop)
 *
 * It stitches together the existing pure/one-shot pieces into a live loop:
 *   - toNote / noteFilename  (learning/obsidian-export.js)  DB row  -> note
 *   - parseNote              (learning/obsidian-parse.js)   note    -> prose
 *   - the password-grant auth + PostgREST calls that export-obsidian.mjs and
 *     import-obsidian.mjs already use.
 *
 * What it does:
 *   1. On start: full DB->vault export once (all rows -> *.md).
 *   2. fs.watch (built-in, no chokidar) the vault; a .md change, debounced
 *      ~500ms, reverse-syncs THAT file (parseNote -> PATCH title+summary).
 *   3. Every 30s: re-poll Supabase and re-export (cheap for ~80 rows).
 *   4. Loop prevention: every note the daemon writes is recorded (path -> hash
 *      + timestamp). The fs.watch event that write triggers is matched against
 *      the record by the PURE shouldIgnore() and skipped, so the daemon never
 *      pushes its own writes back to the DB. See loop-guard.js.
 *
 * Dependency-free: Node built-in fetch + fs. Password-grant (RLS), not
 * service_role. Requires in life-os/.env: SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toNote } from '../learning/obsidian-export.js';
import { parseNote } from '../learning/obsidian-parse.js';
import { shouldIgnore, writeRecord, hashContent } from './loop-guard.js';

const VAULT_DIR = join(homedir(), 'life-os-vault', 'learning');
const ENV_PATH = new URL('../.env', import.meta.url).pathname;
const POLL_MS = 30_000;
const DEBOUNCE_MS = 500;
const GUARD_TTL_MS = 5_000; // must comfortably exceed DEBOUNCE_MS + fs latency

/* path -> { hash, at } of the daemon's own last write (loop-guard input). */
const lastWrites = new Map();
/* path -> pending debounce timer for reverse-sync. */
const debounceTimers = new Map();

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

const env = loadEnv(ENV_PATH);
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_USER_EMAIL, SUPABASE_USER_PASSWORD } = env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in .env');
if (!SUPABASE_USER_EMAIL || !SUPABASE_USER_PASSWORD) {
  throw new Error('Missing SUPABASE_USER_EMAIL / SUPABASE_USER_PASSWORD in .env — add them before running.');
}

let accessToken = null;

/* Password-grant sign-in (RLS user, not service_role). Refreshed on demand and
 * on 401, since the daemon outlives a single token's lifetime. */
async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SUPABASE_USER_EMAIL, password: SUPABASE_USER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
  accessToken = (await res.json()).access_token;
}

/* fetch with the auth headers, re-signing once on a 401 (expired token). */
async function authFetch(url, opts = {}) {
  if (!accessToken) await signIn();
  const withAuth = () => ({
    ...opts,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...(opts.headers || {}),
    },
  });
  let res = await fetch(url, withAuth());
  if (res.status === 401) {
    await signIn();
    res = await fetch(url, withAuth());
  }
  return res;
}

let exporting = false;

/* DB -> vault. Writes every row's note, recording each write in the loop-guard
 * BEFORE the bytes hit disk so the fs.watch echo is recognized as our own. */
async function exportAll() {
  if (exporting) return; // don't overlap a poll with the previous run
  exporting = true;
  try {
    const res = await authFetch(
      `${SUPABASE_URL}/rest/v1/learning_sessions?select=id,source,external_id,learned_on,title,summary,link,tags,synced_at&order=learned_on.desc`,
    );
    if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${await res.text()}`);
    const rows = await res.json();

    mkdirSync(VAULT_DIR, { recursive: true });
    let wrote = 0;
    for (const row of rows) {
      const { filename, content } = toNote(row);
      const path = join(VAULT_DIR, filename);
      // Don't clobber a note with an unsynced local edit: a pending debounce
      // timer, or on-disk content that diverges from both the DB render and our
      // own last write (a user edit that hasn't PATCHed back yet).
      if (debounceTimers.has(path)) continue;
      let onDisk = null;
      try { onDisk = readFileSync(path, 'utf8'); } catch { /* new note */ }
      if (onDisk !== null && onDisk !== content) {
        const rec = lastWrites.get(path);
        const ours = rec && hashContent(onDisk) === rec.hash;
        if (!ours) continue; // user's unsynced edit — leave it for reverse-sync
      }
      lastWrites.set(path, writeRecord(content, Date.now())); // guard before write
      writeFileSync(path, content);
      wrote += 1;
    }
    console.log(`[export] wrote ${wrote} note(s) to ${VAULT_DIR}`);
  } catch (err) {
    console.error(`[export] ${err.message || err}`);
  } finally {
    exporting = false;
  }
}

/* vault -> DB for a single note. PATCHes only title + summary (Obsidian owns
 * prose); matched by the lifeos_id frontmatter key. */
async function syncFile(path) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return; // file vanished (rename/delete) — nothing to sync
  }

  // Loop guard: our own recent write echoing back? Skip it.
  if (shouldIgnore(lastWrites.get(path), content, Date.now(), GUARD_TTL_MS)) {
    return;
  }

  const note = parseNote(content);
  if (!note.lifeos_id) return; // not a life-os note

  const res = await authFetch(
    `${SUPABASE_URL}/rest/v1/learning_sessions?id=eq.${encodeURIComponent(note.lifeos_id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ title: note.title, summary: note.summary }),
    },
  );
  if (!res.ok) {
    console.error(`[sync] update failed for ${path} (${res.status}): ${await res.text()}`);
    return;
  }
  console.log(`[sync] pushed ${path} (id=${note.lifeos_id}) title+summary -> DB`);
}

/* Debounce per-path: Obsidian saves fire several change events in a burst. */
function onVaultEvent(_eventType, filename) {
  if (!filename || !filename.endsWith('.md')) return;
  const path = join(VAULT_DIR, filename);
  clearTimeout(debounceTimers.get(path));
  debounceTimers.set(path, setTimeout(() => {
    debounceTimers.delete(path);
    syncFile(path).catch((err) => console.error(`[sync] ${err.message || err}`));
  }, DEBOUNCE_MS));
}

async function main() {
  await signIn();
  await exportAll(); // full initial export (before watching, so it fires no events we react to)

  mkdirSync(VAULT_DIR, { recursive: true });
  const watcher = watch(VAULT_DIR, onVaultEvent);
  console.log(`[bridge] watching ${VAULT_DIR} (Ctrl-C to stop)`);

  const poll = setInterval(() => { exportAll(); }, POLL_MS);

  const shutdown = () => {
    console.log('\n[bridge] shutting down…');
    clearInterval(poll);
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

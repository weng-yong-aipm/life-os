#!/usr/bin/env node
/* Back up every life-os Supabase table (+ the receipts/meals storage buckets)
 * to a dated local directory, ready for tools/backup-db.sh to sync to Drive.
 *
 *   node tools/backup-db.mjs
 *
 * This is the one thing nothing else covers: ~/backup-gdrive.sh (second-brain)
 * backs up the Obsidian vault and the 抖音 ledger, never the actual life-os
 * database — years of finance/health/career/learning data had no recovery
 * path if the Supabase project were ever lost or corrupted. 2026-08-05.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY (the only credential present in .env today —
 * SUPABASE_USER_EMAIL/PASSWORD are unset). Never exposed to a client; this
 * runs locally only. Dependency-free: native fetch + fs, matching every
 * other tool in this directory.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
if (!SB || !SVC) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
const H = { apikey: SVC, authorization: `Bearer ${SVC}` };

// Every table across schema.sql + every migration, as of 2026-08-05. A table
// dropped or renamed later shows up as a loud 404 in the summary below rather
// than silently vanishing from the backup.
const TABLES = [
  'receipts', 'receipt_items', 'pay_settings', 'work_hours',
  'expenses', 'meals', 'workouts',
  'learning_sessions', 'learning_materials', 'career_goals',
  'feed_items', 'improvements', 'capture_queue',
];
const BUCKETS = ['receipts', 'meals'];

const today = new Date().toISOString().slice(0, 10);
const outDir = join(ROOT, '..', 'life-os-db-backups', today);
mkdirSync(outDir, { recursive: true });

async function backupTable(name) {
  const res = await fetch(`${SB}/rest/v1/${name}?select=*`, { headers: H });
  if (!res.ok) return { name, ok: false, detail: `${res.status} ${await res.text()}` };
  const rows = await res.json();
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows, null, 1));
  return { name, ok: true, rows: rows.length };
}

async function backupBucket(bucket) {
  const listRes = await fetch(`${SB}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!listRes.ok) return { name: `storage:${bucket}`, ok: false, detail: `${listRes.status} ${await listRes.text()}` };
  const objects = (await listRes.json()).filter((o) => o.id); // real objects, not the placeholder folder row
  if (!objects.length) return { name: `storage:${bucket}`, ok: true, files: 0 };

  const dir = join(outDir, 'storage', bucket);
  mkdirSync(dir, { recursive: true });
  let saved = 0;
  for (const obj of objects) {
    const fileRes = await fetch(`${SB}/storage/v1/object/${bucket}/${obj.name}`, { headers: H });
    if (!fileRes.ok) continue;
    writeFileSync(join(dir, obj.name.replace(/\//g, '_')), Buffer.from(await fileRes.arrayBuffer()));
    saved++;
  }
  return { name: `storage:${bucket}`, ok: true, files: saved };
}

async function main() {
  console.log(`life-os DB backup -> ${outDir}\n`);
  const results = [];
  for (const t of TABLES) results.push(await backupTable(t));
  for (const b of BUCKETS) results.push(await backupBucket(b));

  let anyFail = false;
  for (const r of results) {
    if (!r.ok) { anyFail = true; console.log(`  ✗ ${r.name}: ${r.detail}`); continue; }
    console.log(`  ✓ ${r.name}: ${'rows' in r ? `${r.rows} row(s)` : `${r.files} file(s)`}`);
  }
  writeFileSync(join(outDir, '_manifest.json'), JSON.stringify({ date: today, results }, null, 1));
  console.log(anyFail ? '\nCompleted with errors — see ✗ lines above.' : '\nAll tables + buckets backed up.');
  if (anyFail) process.exitCode = 1;
}

main().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });

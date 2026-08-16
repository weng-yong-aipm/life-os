#!/usr/bin/env node
/* Back up every life-os Supabase table (+ every storage bucket) to a dated
 * local directory, ready for scripts/backup-db-weekly.sh to sync to Drive.
 *
 *   node tools/backup-db.mjs
 *
 * This is the one thing nothing else covers: ~/backup-gdrive.sh (second-brain)
 * backs up the Obsidian vault and the 抖音 ledger, never the actual life-os
 * database — years of finance/health/career/learning data had no recovery
 * path if the Supabase project were ever lost or corrupted. 2026-08-05.
 *
 * Rewritten 2026-08-16 after the first scheduled run printed "All tables +
 * buckets backed up." while covering 13 of the 19 live tables and 2 of the 3
 * live buckets. The list of tables was a hardcoded array frozen on 2026-08-05;
 * the six tables and one bucket that migrations added over the following three
 * days were invisible to it, and an all-green summary was printed anyway. Three
 * structural rules follow from that, and every one of them can fail loudly:
 *
 *   1. NOTHING IS HARDCODED. Tables come from the PostgREST OpenAPI root and
 *      buckets from the storage bucket API, both read at runtime. A migration
 *      that adds a table adds it to the backup with no code change.
 *   2. COVERAGE IS A CHECK, NOT A CLAIM. After the writes, every discovered
 *      table is read back OFF DISK and its row count compared with what the API
 *      said. A table with no file, an unparseable file, or a count mismatch
 *      makes this process exit non-zero. An empty discovery set also fails —
 *      "zero tables, all of them covered" is the exact false green being fixed.
 *   3. NO PAGE IS ASSUMED TO BE THE WHOLE TABLE. Supabase caps PostgREST
 *      responses (db-max-rows, 1000 by default) and returns 200 for a truncated
 *      body. Rows are paged through Range headers and the total from
 *      Content-Range is asserted against what was actually collected, so a
 *      table crossing the cap can never be silently half-backed-up.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY (the only credential present in .env today —
 * SUPABASE_USER_EMAIL/PASSWORD are unset). Never exposed to a client; this
 * runs locally only. Dependency-free: native fetch + fs, matching every
 * other tool in this directory. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* PostgREST hands back at most db-max-rows per request. Page through with
 * Range instead of trusting one response to be the whole table. */
const PAGE = 1000;

/* The cockpit job ledger (job_runs) lives in second-brain and is owned by
 * backoffice/job-runs.js. life-os only calls it, never defines it. */
const JOB_RUNS_MODULE = join(homedir(), 'second-brain', 'backoffice', 'job-runs.js');

// ── Pure helpers (unit-tested in backup-db.test.js) ──────────────────────────

/* Table names from the PostgREST OpenAPI root.
 *
 * `paths` rather than `definitions`: paths is the set that is actually
 * queryable over REST, which is what a backup can reach. `/` is the root doc
 * and `/rpc/*` are stored procedures, not relations. Views show up here too and
 * that is fine — a view costs a little duplicate JSON and never a missing
 * table, which is the failure mode that actually hurt. */
export function tablesFromOpenApi(spec) {
  return Object.keys(spec?.paths ?? {})
    .filter((p) => p.startsWith('/') && p.length > 1 && !p.startsWith('/rpc/'))
    .map((p) => p.slice(1))
    .filter((name) => name && !name.includes('/'))
    .sort();
}

/* Bucket names from GET /storage/v1/bucket. Same reasoning as tables: the live
 * list, never a literal in this file. */
export function bucketsFromList(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((b) => b?.name ?? b?.id)
    .filter((name) => typeof name === 'string' && name.length > 0)
    .sort();
}

/* PostgREST reports the window it served, and the true total when asked for
 * count=exact: "0-999/4213", or "* /0" for an empty relation. Returns null for
 * anything unparseable so the caller can treat a missing total as a hard error
 * rather than as "no more rows". */
export function parseContentRange(header) {
  const m = /^\s*(?:(\d+)-(\d+)|\*)\/(\d+|\*)\s*$/.exec(String(header ?? ''));
  if (!m) return null;
  return {
    from: m[1] === undefined ? null : Number(m[1]),
    to: m[2] === undefined ? null : Number(m[2]),
    total: m[3] === '*' ? null : Number(m[3]),
  };
}

/* Is the backup complete? `discovered` is what the database says exists;
 * `readBack` maps a table name to what was found ON DISK afterwards —
 * {rows, expected} for a file that parsed, {error} for one that did not.
 *
 * A name in `discovered` with no entry in `readBack` is `missing`: that is the
 * 2026-08-05 defect (a new table nobody wrote code for) reduced to a diff.
 * An empty `discovered` is a failure on purpose: discovery returning nothing
 * would otherwise make every check below vacuously pass. */
export function coverageReport(discovered, readBack) {
  const names = Array.isArray(discovered) ? discovered : [];
  const got = readBack instanceof Map ? readBack : new Map(Object.entries(readBack ?? {}));
  const missing = [];
  const unreadable = [];
  const mismatched = [];

  for (const name of names) {
    const entry = got.get(name);
    if (!entry) { missing.push(name); continue; }
    if (entry.error) { unreadable.push({ name, error: entry.error }); continue; }
    if (entry.rows !== entry.expected) {
      mismatched.push({ name, onDisk: entry.rows, expected: entry.expected });
    }
  }

  const reasons = [];
  if (names.length === 0) reasons.push('discovered zero tables — discovery itself failed');
  if (missing.length) reasons.push(`no backup file for: ${missing.join(', ')}`);
  for (const u of unreadable) reasons.push(`${u.name}: unreadable on disk (${u.error})`);
  for (const m of mismatched) reasons.push(`${m.name}: ${m.onDisk} row(s) on disk, API reported ${m.expected}`);

  return { ok: reasons.length === 0, missing, unreadable, mismatched, reasons };
}

/* Storage object keys become paths under the output directory, so a key
 * containing a ".." segment (or an absolute path) would let a bucket write
 * outside the backup. Nothing in these buckets does that today; the check
 * exists so it stays true without anyone having to remember. */
export function isSafeObjectKey(key) {
  if (typeof key !== 'string' || key.length === 0) return false;
  if (key.startsWith('/')) return false;
  return key.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// ── Live backup ──────────────────────────────────────────────────────────────

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

/* Best-effort load of the cockpit job ledger. Absence is reported in the
 * summary and never faked: this script says "recorded" only when it was. The
 * module is written by second-brain and may not exist yet, and second-brain's
 * backoffice is a bun codebase — if job-runs.js imports bun:sqlite it will not
 * load under node either. Both cases surface as the same visible warning. */
async function loadJobRuns() {
  try {
    return { mod: await import(pathToFileURL(JOB_RUNS_MODULE).href), error: null };
  } catch (e) {
    return { mod: null, error: e.message };
  }
}

async function main() {
  const ENV = loadEnv();
  const SB = ENV.SUPABASE_URL;
  const SVC = ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB || !SVC) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
  const H = { apikey: SVC, authorization: `Bearer ${SVC}` };

  const today = new Date().toISOString().slice(0, 10);
  const outDir = join(ROOT, '..', 'life-os-db-backups', today);

  const jobRuns = await loadJobRuns();
  const startedAt = new Date().toISOString();
  let runId = null;
  if (jobRuns.mod) runId = await jobRuns.mod.startRun({ job: 'backup-db', step: null });
  else console.log(`  ! job_runs not recorded — ${JOB_RUNS_MODULE}: ${jobRuns.error}`);

  const finish = async (status, counts, error) => {
    if (!jobRuns.mod || runId == null) return false;
    await jobRuns.mod.finishRun(runId, { status, counts, error });
    return true;
  };

  try {
    const summary = await runBackup({ SB, H, outDir, today });
    const recorded = await finish(summary.ok ? 'ok' : 'failed', summary.counts,
      summary.ok ? null : summary.coverage.reasons.join('; '));
    report(summary, { recorded, startedAt });
    if (!summary.ok) process.exitCode = 1;
  } catch (e) {
    await finish('failed', null, e.message);
    throw e;
  }
}

async function runBackup({ SB, H, outDir, today }) {
  console.log(`life-os DB backup -> ${outDir}\n`);
  mkdirSync(outDir, { recursive: true });

  /* Discovery is fatal on failure. A caught-and-ignored discovery error would
   * leave an empty table list, and an empty list backs up nothing perfectly. */
  const tables = tablesFromOpenApi(await getJson(`${SB}/rest/v1/`, { headers: H }, 'OpenAPI root'));
  const buckets = bucketsFromList(await getJson(`${SB}/storage/v1/bucket`, { headers: H }, 'bucket list'));
  console.log(`  discovered ${tables.length} table(s), ${buckets.length} bucket(s)\n`);

  const tableResults = [];
  for (const name of tables) tableResults.push(await backupTable(name, { SB, H, outDir }));

  const bucketResults = [];
  for (const name of buckets) bucketResults.push(await backupBucket(name, { SB, H, outDir }));

  /* The coverage check deliberately does NOT consult tableResults. It reads the
   * directory that was just written, so it catches a table the loop above never
   * even attempted — which is precisely what went wrong on 2026-08-05. */
  const readBack = new Map();
  for (const r of tableResults) {
    if (r.expected == null) continue; // the fetch itself failed; reported separately
    readBack.set(r.name, readBackTable(outDir, r.name, r.expected));
  }
  const coverage = coverageReport(tables, readBack);

  const bucketFailures = bucketResults.filter((b) => !b.ok);
  const tableFetchFailures = tableResults.filter((r) => !r.ok);
  const ok = coverage.ok && bucketFailures.length === 0 && tableFetchFailures.length === 0;

  const counts = {
    tables: tables.length,
    rows: tableResults.reduce((n, r) => n + (r.rows ?? 0), 0),
    buckets: buckets.length,
    files: bucketResults.reduce((n, b) => n + (b.files ?? 0), 0),
    failed: tableFetchFailures.length + bucketFailures.length + coverage.reasons.length,
  };

  writeFileSync(join(outDir, '_manifest.json'), JSON.stringify({
    date: today, ok, counts, tables: tableResults, buckets: bucketResults, coverage,
  }, null, 1));

  return { ok, outDir, tables, buckets, tableResults, bucketResults, coverage, counts };
}

async function getJson(url, init, what) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/* Page through a table and assert we collected every row the server counted. */
async function backupTable(name, { SB, H, outDir }) {
  const rows = [];
  let total = null;
  try {
    for (let from = 0; ; from += PAGE) {
      const res = await fetch(`${SB}/rest/v1/${name}?select=*`, {
        headers: { ...H, 'range-unit': 'items', range: `${from}-${from + PAGE - 1}`, prefer: 'count=exact' },
      });
      if (res.status === 416) break; // asked past the end; the count check below is the real judge
      if (!res.ok) return { name, ok: false, detail: `${res.status} ${await res.text()}` };
      const range = parseContentRange(res.headers.get('content-range'));
      if (range?.total != null) total = range.total;
      const page = await res.json();
      rows.push(...page);
      if (page.length < PAGE) break;
      if (total != null && rows.length >= total) break;
    }
  } catch (e) {
    return { name, ok: false, detail: e.message };
  }

  if (total == null) return { name, ok: false, detail: 'server returned no exact count — cannot prove the table was read whole' };
  if (rows.length !== total) return { name, ok: false, detail: `truncated: collected ${rows.length} of ${total} row(s)` };

  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows, null, 1));
  return { name, ok: true, rows: rows.length, expected: total };
}

/* Read the file back the way a restore would, so the coverage check is grounded
 * in what is on disk rather than in what this process believes it wrote. */
function readBackTable(outDir, name, expected) {
  try {
    const parsed = JSON.parse(readFileSync(join(outDir, `${name}.json`), 'utf8'));
    if (!Array.isArray(parsed)) return { error: 'file is not a JSON array' };
    return { rows: parsed.length, expected };
  } catch (e) {
    return { error: e.message };
  }
}

/* List a bucket recursively. The storage list API is one level deep and marks
 * folder prefixes with id: null — the old code filtered those away and reported
 * "0 file(s), ok" for any bucket whose objects live under a prefix, which is
 * the standard <user_id>/<file> Supabase layout and exactly how exercise-media
 * is arranged. Paged by offset for the same reason tables are. */
async function listBucket(bucket, prefix, { SB, H }) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${SB}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    for (const row of page) {
      const key = prefix ? `${prefix}/${row.name}` : row.name;
      if (row.id) out.push(key);
      else out.push(...await listBucket(bucket, key, { SB, H }));
    }
    if (page.length < PAGE) break;
  }
  return out;
}

async function backupBucket(bucket, { SB, H, outDir }) {
  let keys;
  try {
    keys = await listBucket(bucket, '', { SB, H });
  } catch (e) {
    return { name: `storage:${bucket}`, ok: false, detail: e.message };
  }

  const dir = join(outDir, 'storage', bucket);
  const failed = [];
  let saved = 0;
  for (const key of keys) {
    if (!isSafeObjectKey(key)) { failed.push(`${key} (unsafe object key)`); continue; }
    const res = await fetch(`${SB}/storage/v1/object/${bucket}/${key}`, { headers: H });
    if (!res.ok) { failed.push(`${key} (${res.status})`); continue; }
    const dest = join(dir, ...key.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    saved++;
  }

  /* A download that 404s used to be skipped silently and the bucket still
   * reported ok. Every listed object must land on disk or the bucket fails. */
  if (failed.length) {
    return { name: `storage:${bucket}`, ok: false, files: saved, listed: keys.length,
      detail: `${failed.length} of ${keys.length} object(s) not saved: ${failed.slice(0, 5).join(', ')}` };
  }
  return { name: `storage:${bucket}`, ok: true, files: saved, listed: keys.length };
}

function report(summary, { recorded, startedAt }) {
  for (const r of summary.tableResults) {
    if (r.ok) console.log(`  ✓ ${r.name}: ${r.rows} row(s)`);
    else console.log(`  ✗ ${r.name}: ${r.detail}`);
  }
  for (const b of summary.bucketResults) {
    if (b.ok) console.log(`  ✓ ${b.name}: ${b.files} file(s)`);
    else console.log(`  ✗ ${b.name}: ${b.detail}`);
  }

  console.log(`\n  coverage: ${summary.tables.length} table(s) discovered, ` +
    `${summary.tables.length - summary.coverage.missing.length - summary.coverage.unreadable.length - summary.coverage.mismatched.length} verified on disk`);
  for (const reason of summary.coverage.reasons) console.log(`  ✗ coverage: ${reason}`);

  console.log(`  job_runs: ${recorded ? `recorded (started ${startedAt})` : 'NOT recorded'}`);
  console.log(summary.ok
    ? `\nEvery discovered table and bucket backed up and verified on disk.`
    : `\nBACKUP INCOMPLETE — see ✗ lines above. Exiting non-zero.`);
}

/* Importable by the test file without running a live backup. */
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
}

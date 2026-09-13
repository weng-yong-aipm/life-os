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
 *   4. ONE NETWORK BLIP IS NOT A VERDICT. Every request goes through
 *      fetchRetry(): a bounded timeout per attempt and exponential backoff
 *      around it. Added 2026-09-13 — see the comment on fetchRetry for the run
 *      that four bare `await fetch` calls turned into a snapshot missing three
 *      tables and all 42 media files.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY (the only credential present in .env today —
 * SUPABASE_USER_EMAIL/PASSWORD are unset). Never exposed to a client; this
 * runs locally only. Dependency-free: native fetch + fs, matching every
 * other tool in this directory. */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* PostgREST hands back at most db-max-rows per request. Page through with
 * Range instead of trusting one response to be the whole table. */
const PAGE = 1000;

/* The cockpit job ledger (job_runs) lives in second-brain and is owned by
 * backoffice/job-runs.js. life-os only calls it, never defines it. */
const JOB_RUNS_MODULE = process.env.LIFEOS_JOB_RUNS_MODULE
  || join(homedir(), 'second-brain', 'backoffice', 'job-runs.js');

/* Where the dated snapshot directories live. The env name is the seam the
 * tests write through and the one scripts/backup-db-weekly.sh reads, so the
 * script and this file can never end up syncing a different directory from the
 * one that was written. */
export const backupRoot = (env = process.env) =>
  env.LIFEOS_BACKUP_ROOT || join(ROOT, '..', 'life-os-db-backups');

/* Retry budget for every request in this file. Roughly four minutes per call:
 * long enough that a laptop waking up, a DNS hiccup, or a single 504 costs
 * nothing, deliberately too short to paper over a real outage. The env
 * overrides exist so the tests can walk the retry path without sleeping. */
export const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 180_000];
const RETRY_DELAYS_MS = process.env.BACKUP_RETRY_DELAYS_MS
  ? process.env.BACKUP_RETRY_DELAYS_MS.split(',').map(Number).filter(Number.isFinite)
  : DEFAULT_RETRY_DELAYS_MS;
const REQUEST_TIMEOUT_MS = Number(process.env.BACKUP_REQUEST_TIMEOUT_MS) || 60_000;

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

/* PURE: is this outcome worth another attempt?
 *
 * A thrown fetch is always transient — DNS, a dropped socket, a wake from
 * sleep, the per-attempt timeout below. So are 408/425/429 and every 5xx: a
 * 504 from PostgREST is a statement that timed out, not a statement that is
 * wrong. Measured 2026-09-13 18:16 against the live project: `career_goals`
 * answered 504 once and then 200 in 411ms on the very next request.
 *
 * Everything else — 401, 403, 404, 416 — is the server's considered answer and
 * retrying it just spends the budget before reporting the same thing. */
export function isTransient({ status = null, error = null } = {}) {
  if (error) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  return typeof status === 'number' && status >= 500;
}

/* Every network call in this file goes through here.
 *
 * 2026-09-12 is why. capture_queue finished at 03:15:04, career_goals threw
 * "fetch failed", expenses threw, feed_items succeeded at 04:11:49; later sets
 * succeeded, sleep threw, user_settings succeeded. EVERY table that failed was
 * followed by one that worked, so nothing was wrong with the data — the
 * machine's network went away and came back while four bare `await fetch`
 * calls were in flight, and one throw was the entire backup of that table. The
 * off-site snapshot for that week holds 17 objects instead of 62.
 *
 * Two things go wrong in that story and both are fixed here. The retries are
 * the obvious half. The timeout is the half that made it expensive: the run
 * took 91 minutes for 19 tables and 0 files, because an unbounded fetch on a
 * dead socket stalls until the OS gives up. A bounded attempt turns a stall
 * into a fast, retryable failure, which is the only reason a retry budget can
 * be small enough to be honest.
 *
 * It is NOT honest about long outages, on purpose: ~4 minutes per call would
 * not have covered the 57-minute hole on 2026-09-12. A run that still fails
 * still exits non-zero and still names what failed. */
async function fetchRetry(url, init = {}, { delays = RETRY_DELAYS_MS, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res = null;
    let error = null;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      error = e;
    }
    if (res && !isTransient({ status: res.status })) return res;
    if (attempt >= delays.length) {
      if (error) throw error;
      return res; // out of budget: hand the caller the status it actually got
    }
    const why = error ? error.message : `HTTP ${res.status}`;
    let where = url;
    try { where = new URL(url).pathname; } catch { /* keep the raw string */ }
    console.log(`    … ${where}: ${why} — retry ${attempt + 1}/${delays.length} in ${Math.round(delays[attempt] / 1000)}s`);
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
  }
}

/* Is the backup complete? `discovered` is what the database says exists;
 * `readBack` maps a table name to what was found ON DISK afterwards —
 * {rows, expected} for a file that parsed, {error} for one that did not.
 *
 * A name in `discovered` with no entry in `readBack` is `missing`: that is the
 * 2026-08-05 defect (a new table nobody wrote code for) reduced to a diff.
 * An empty `discovered` is a failure on purpose: discovery returning nothing
 * would otherwise make every check below vacuously pass.
 *
 * `checked` and `verified` are returned rather than recomputed by the caller,
 * because recomputing them is exactly how the bucket half of this check became
 * a constant. report() printed `buckets.length` as the denominator while
 * run() had built the checked set from `bucketResults.filter(b => b.files !=
 * null)` — a bucket that died in the LIST phase has no `files`, so it was
 * filtered out of the numerator's input and still counted in the denominator.
 * The line could only ever read "3 bucket(s) discovered, 3 verified on disk".
 * Grepping every run this job has ever logged returns that one string five
 * times out of five, including 2026-08-22 and 2026-09-12, when exercise-media
 * failed outright and no `storage/` directory was written at all. Both numbers
 * now come from the same object, so the two can no longer be about different
 * sets of things. */
export function coverageReport(discovered, readBack, { noun = 'table', missingReason = null } = {}) {
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
  if (names.length === 0) reasons.push(`discovered zero ${noun}s — discovery itself failed`);
  if (missing.length) {
    if (missingReason) for (const name of missing) reasons.push(missingReason(name));
    else reasons.push(`no backup file for: ${missing.join(', ')}`);
  }
  for (const u of unreadable) reasons.push(`${u.name}: unreadable on disk (${u.error})`);
  for (const m of mismatched) reasons.push(`${m.name}: ${m.onDisk} row(s) on disk, API reported ${m.expected}`);

  return {
    ok: reasons.length === 0,
    missing,
    unreadable,
    mismatched,
    reasons,
    checked: names.length,
    verified: names.length - missing.length - unreadable.length - mismatched.length,
  };
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

// PURE: why did this run go red? `ok` is decided by FOUR sources (see run()'s
// `coverage.ok && bucketCoverage.ok && bucketFailures && tableFetchFailures`), and the ledger used
// to record only `coverage.reasons`. So a run that failed on a bucket or a table fetch wrote
// status='failed' with an EMPTY error — which is what the 2026-08-22 and 2026-08-17 rows in
// job_runs look like: a failure that cannot say what failed. A verdict and its explanation must
// come from the same set of facts, or they drift apart exactly when someone needs them.
//
// The last clause is the guard against this recurring: if `ok` is false and not one of the four
// sources produced a line, say THAT, loudly, rather than writing an empty string. A new failure
// source added to `ok` without being added here can then be spotted from the ledger.
export function failureReason(summary) {
  if (!summary || summary.ok) return null;
  const parts = [
    ...(summary.coverage?.reasons || []),
    ...(summary.bucketCoverage?.reasons || []).map((r) => `bucket coverage: ${r}`),
    ...(summary.tableResults || []).filter((r) => !r.ok).map((r) => `table ${r.name}: ${r.detail || 'failed with no detail'}`),
    ...(summary.bucketResults || []).filter((b) => !b.ok).map((b) => `${b.name}: ${b.detail || 'failed with no detail'}`),
  ];
  return parts.length
    ? parts.join('; ')
    : 'run reported not-ok but no source explained why — a failure condition was added to `ok` without a matching reason line';
}

async function main() {
  const ENV = loadEnv();
  const SB = ENV.SUPABASE_URL;
  const SVC = ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB || !SVC) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
  const H = { apikey: SVC, authorization: `Bearer ${SVC}` };

  const today = new Date().toISOString().slice(0, 10);
  const outDir = join(backupRoot(ENV), today);

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
    /* DEFERRED VERDICT (2026-09-13). Closing the wrapper row here means the
     * ledger's verdict for `backup-db` is a verdict on a directory on this
     * laptop — rclone has not even been looked for yet. healthLine() reads the
     * wrapper row and NOTHING else (deliberately: inferring a run's outcome
     * from its step rows is how a later success washes out an earlier failure),
     * so an off-site step that fails leaves the job GREEN. That is the whole
     * blind spot restated one level up.
     *
     * The fix is not to teach healthLine about step rows. It is that this row
     * must not be decided until the off-site copy has been decided too. Under
     * LIFEOS_BACKUP_DEFER_VERDICT the row is left open and its id handed to the
     * wrapper script, which closes it with `local AND off-site`. A crash in
     * between leaves a `running` row for the next run to reap — visibly an
     * orphan, which is the honest answer, not a green one.
     *
     * Unset (a human running this by hand) the behaviour is unchanged. */
    const localStatus = summary.ok ? 'ok' : 'failed';
    const deferred = String(ENV.LIFEOS_BACKUP_DEFER_VERDICT ?? '') === 'true' && runId != null;
    const recorded = deferred
      ? false
      : await finish(localStatus, summary.counts, failureReason(summary));
    report(summary, { recorded, startedAt, deferred });
    if (deferred) {
      /* Machine-readable and on its own line: the script greps for it. The
       * counts ride along so the script can close the row without re-deriving
       * them — and so a row closed by the script is indistinguishable, in the
       * ledger, from one closed here. */
      console.log(`JOB_RUN_DEFERRED id=${runId} local=${localStatus} counts=${JSON.stringify(summary.counts)}`);
    }
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

  /* Same read-the-disk check for buckets, with two corrections made 2026-09-13.
   *
   * `expected` is `listed` — what the bucket LISTING said the bucket holds —
   * not `files`, which is what this process believes it saved. Comparing saved
   * against saved is a tautology: the one thing this read-back could never
   * report is "listed 42, saved 40", which is the whole reason it exists.
   *
   * And the checked set is EVERY discovered bucket, not the ones that got far
   * enough to have a file count. A bucket whose listing failed has nothing on
   * disk and nothing to compare, which is the most complete failure available —
   * it must not be the one case that drops out of the coverage check. */
  const bucketReadBack = new Map();
  for (const b of bucketResults) {
    if (b.listed == null) continue; // never listed — coverage reports it as never fetched
    const bare = b.name.replace(/^storage:/, '');
    bucketReadBack.set(b.name, readBackBucket(outDir, bare, b.listed));
  }
  const bucketCoverage = coverageReport(bucketResults.map((b) => b.name), bucketReadBack, {
    noun: 'bucket',
    missingReason: (name) => `${name}: never fetched — the listing failed, so not one file was attempted`,
  });

  const bucketFailures = bucketResults.filter((b) => !b.ok);
  const tableFetchFailures = tableResults.filter((r) => !r.ok);
  const ok = coverage.ok && bucketCoverage.ok && bucketFailures.length === 0 && tableFetchFailures.length === 0;

  const counts = {
    tables: tables.length,
    rows: tableResults.reduce((n, r) => n + (r.rows ?? 0), 0),
    buckets: buckets.length,
    files: bucketResults.reduce((n, b) => n + (b.files ?? 0), 0),
    /* What the LISTINGS said the buckets hold, which is not the same number as
     * what got saved — and it is the one the off-site check has to size itself
     * against. With `files` alone, a run that listed 42 objects and saved 40
     * expects 60 objects off-site, finds 60, and calls the snapshot complete. */
    filesListed: bucketResults.reduce((n, b) => n + (b.listed ?? b.files ?? 0), 0),
    failed: tableFetchFailures.length + bucketFailures.length + coverage.reasons.length + bucketCoverage.reasons.length,
  };

  writeFileSync(join(outDir, '_manifest.json'), JSON.stringify({
    date: today, ok, counts, tables: tableResults, buckets: bucketResults, coverage, bucketCoverage,
  }, null, 1));

  return { ok, outDir, tables, buckets, tableResults, bucketResults, coverage, bucketCoverage, counts };
}

async function getJson(url, init, what) {
  const res = await fetchRetry(url, init);
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/* Page through a table and assert we collected every row the server counted. */
async function backupTable(name, { SB, H, outDir }) {
  const rows = [];
  let total = null;
  try {
    for (let from = 0; ; from += PAGE) {
      const res = await fetchRetry(`${SB}/rest/v1/${name}?select=*`, {
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

/* The bucket half of the coverage check.
 *
 * Until 2026-08-17 there wasn't one: coverageReport was called with tables
 * only, yet the closing line claimed "Every discovered table AND BUCKET backed
 * up and verified on disk". A run that discovered zero buckets — or wrote none
 * of their files — printed that sentence and exited 0. Counting what actually
 * landed under storage/<bucket>/ is the same trick the tables use: read the
 * directory that was just written, not the loop's own opinion of itself. */
function readBackBucket(outDir, bucket, expected) {
  const dir = join(outDir, 'storage', bucket);
  try {
    if (!existsSync(dir)) return expected === 0 ? { rows: 0, expected } : { error: 'no directory written' };
    let n = 0;
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else n++;
      }
    };
    walk(dir);
    return { rows: n, expected };
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
    const res = await fetchRetry(`${SB}/storage/v1/object/list/${bucket}`, {
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
    const res = await fetchRetry(`${SB}/storage/v1/object/${bucket}/${key}`, { headers: H });
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

function report(summary, { recorded, startedAt, deferred = false }) {
  for (const r of summary.tableResults) {
    if (r.ok) console.log(`  ✓ ${r.name}: ${r.rows} row(s)`);
    else console.log(`  ✗ ${r.name}: ${r.detail}`);
  }
  for (const b of summary.bucketResults) {
    if (b.ok) console.log(`  ✓ ${b.name}: ${b.files} file(s)`);
    else console.log(`  ✗ ${b.name}: ${b.detail}`);
  }

  /* Both numbers on each line come out of the same report object. Printing a
   * denominator this function computed for itself is what kept the bucket line
   * at "3 discovered, 3 verified" on the two runs where a bucket was a total
   * loss — see the comment on coverageReport. */
  const tc = summary.coverage;
  console.log(`\n  coverage: ${tc.checked} table(s) discovered, ${tc.verified} verified on disk`);
  for (const reason of tc.reasons) console.log(`  ✗ coverage: ${reason}`);
  const bc = summary.bucketCoverage;
  console.log(`  coverage: ${bc.checked} bucket(s) discovered, ${bc.verified} verified on disk`);
  for (const reason of bc.reasons) console.log(`  ✗ bucket ${reason}`);

  /* "NOT recorded" and "not decided yet" are opposite situations — the first is
   * the ledger failing, the second is it working as designed — and printing the
   * same words for both would make a healthy deferred run read like a broken one. */
  console.log(`  job_runs: ${
    deferred ? `open, verdict deferred to the off-site step (started ${startedAt})`
      : recorded ? `recorded (started ${startedAt})`
        : 'NOT recorded'}`);
  /* The sentence is built from the counts rather than fixed, because the fixed
   * version claimed buckets were "verified on disk" on a run that discovered
   * none and read none back. A success line has to describe what happened. */
  const what = [
    `${summary.tables.length} table(s)`,
    summary.buckets.length ? `${summary.buckets.length} bucket(s)` : null,
  ].filter(Boolean).join(' and ');
  console.log(summary.ok
    ? `\n${what} backed up and verified on disk.`
    : `\nBACKUP INCOMPLETE — see ✗ lines above. Exiting non-zero.`);
}

// ── The off-site half ────────────────────────────────────────────────────────
//
// Everything above this line is about a directory on this laptop, and a backup
// that never leaves the laptop is not a backup. scripts/backup-db-weekly.sh
// runs rclone; this is what decides whether the rclone actually landed a whole
// snapshot, and the script writes the answer to job_runs as step='offsite'.
//
// It lives here rather than in the script for two reasons: the expected count
// comes out of _manifest.json (arithmetic on JSON, in /bin/sh), and a rule with
// no test is a rule that drifts. Both halves below are pure and tested.

/* PURE: how many objects does a COMPLETE snapshot of this run hold?
 *
 * Derived from the manifest, never from a remembered constant: 62 happens to be
 * today's number (19 tables + 42 media files + the manifest), and hardcoding it
 * would go red on the day a migration adds the twentieth table — an alarm that
 * fires for a healthy change teaches the reader to silence it.
 *
 * `counts.tables` is what DISCOVERY found, not what got written, and that is
 * deliberate. On a run where three tables failed, this number stays 20 and the
 * off-site step says the snapshot is incomplete, because it is. */
export function expectedObjectCount(manifest) {
  const c = manifest?.counts;
  if (!c || !Number.isFinite(c.tables)) return null;
  /* `filesListed` is what the buckets SAID they hold; `files` is what this
   * process managed to save. Sizing the off-site check against the second one
   * would make it agree with any shortfall it was handed. The fallback exists
   * only for manifests written before 2026-09-13, which have no filesListed. */
  const files = Number.isFinite(c.filesListed) ? c.filesListed : c.files;
  if (!Number.isFinite(files)) return null;
  return c.tables + files + 1; // + _manifest.json itself
}

/* PURE: is the off-site copy of one dated snapshot complete and byte-identical?
 *
 * Two independent conditions, and both must hold. A count on its own cannot see
 * a truncated upload; `rclone check` on its own is happy to compare two equally
 * incomplete directories and report "0 differences found", which is the same
 * shape of vacuous pass this whole file exists to remove. The local count is
 * here to say WHICH of the two failed: a snapshot that was already short on
 * disk is a table/bucket failure, not a copy failure. */
export function offsiteReport({ date, expected, localObjects, remoteObjects, checkOutput }) {
  const reasons = [];
  if (!Number.isFinite(expected) || expected < 1) {
    reasons.push(`${date}: no usable counts in _manifest.json — nothing says how big a complete snapshot is`);
  } else {
    if (localObjects !== expected) {
      reasons.push(`${date}: the LOCAL snapshot is already short — ${localObjects} of ${expected} object(s); `
        + 'the off-site copy cannot be more complete than what it copies');
    }
    if (remoteObjects !== expected) {
      reasons.push(`${date}: off-site holds ${remoteObjects} of ${expected} object(s)`);
    }
  }
  const check = String(checkOutput ?? '').trim();
  if (!/\b0 differences found\b/.test(check)) {
    const tail = check.split('\n').filter(Boolean).slice(-1)[0] || '(no output at all)';
    reasons.push(`${date}: rclone check --checksum did not say "0 differences found" — ${tail}`);
  }
  return { ok: reasons.length === 0, reasons, date, expected, localObjects, remoteObjects };
}

function countFilesUnder(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name)); else n++;
    }
  };
  walk(dir);
  return n;
}

const rclone = (bin, args) => spawnSync(bin, args, { encoding: 'utf8' });

/* `node tools/backup-db.mjs --verify-offsite <rclone> <remote> [date]`
 * Prints one machine-readable summary line and exits 0/1. */
function verifyOffsite(bin, remote, date) {
  const local = join(backupRoot(), date);
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(join(local, '_manifest.json'), 'utf8')); } catch { /* stays null */ }

  const lsf = rclone(bin, ['lsf', '-R', '--files-only', `${remote}/${date}`]);
  const remoteObjects = lsf.status === 0
    ? String(lsf.stdout || '').split('\n').filter(Boolean).length
    : -1;
  const check = rclone(bin, ['check', '--checksum', local, `${remote}/${date}`]);
  /* rclone writes its NOTICE lines to stderr; reading only stdout would leave
   * the regex below matching an empty string on every run, in both directions. */
  const checkOutput = `${check.stdout || ''}\n${check.stderr || ''}`;

  const r = offsiteReport({
    date,
    expected: expectedObjectCount(manifest),
    localObjects: countFilesUnder(local),
    remoteObjects,
    checkOutput,
  });

  if (lsf.status !== 0) r.reasons.unshift(`${date}: rclone lsf failed — ${String(lsf.stderr || '').trim().split('\n').slice(-1)[0]}`);
  for (const reason of r.reasons) console.log(`  ✗ offsite: ${reason}`);
  const line = r.ok
    ? `offsite: ${date} verified — ${r.remoteObjects} of ${r.expected} object(s) off-site, checksums match`
    : `offsite: FAILED — ${r.reasons.join('; ')}`;
  console.log(line);
  return r.ok && lsf.status === 0 ? 0 : 1;
}

/* Importable by the test file without running a live backup. */
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '--verify-offsite') {
    const [bin, remote, date = new Date().toISOString().slice(0, 10)] = rest;
    if (!bin || !remote) {
      console.error('usage: backup-db.mjs --verify-offsite <rclone> <remote> [date]');
      process.exit(2);
    }
    process.exit(verifyOffsite(bin, remote, date));
  } else if (cmd) {
    console.error(`unknown argument ${cmd} — usage: backup-db.mjs [--verify-offsite <rclone> <remote> [date]]`);
    process.exit(2);
  } else {
    main().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
  }
}

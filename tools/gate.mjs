#!/usr/bin/env node
/* The stop-gate from docs/superpowers/specs/2026-08-05-daily-logging-design.md,
 * given teeth.
 *
 *   node tools/gate.mjs        (or: npm run gate)
 *
 * The rule was written on 2026-08-05 and then ~3,400 lines were shipped past
 * it, because the rule only ever existed as a sentence in a markdown file. A
 * sentence cannot fail a build. This script can: it reads live row counts from
 * Supabase over PostgREST and exits non-zero while any already-built module
 * holds zero production rows.
 *
 * The rule it enforces: NO NEW MODULE WHILE AN EXISTING MODULE HAS ZERO
 * PRODUCTION ROWS. Modules are shipped code; rows are evidence the code is
 * used. Four modules are built and none of them has ever been used.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY, read from .env, never printed. Read-only —
 * this script issues GETs and nothing else. Dependency-free: native fetch,
 * matching every other tool in this directory.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ---------------------------------------------------------------- pure logic
 * Everything below the divider does I/O. Everything above it is pure and
 * unit-tested in gate.test.js — the verdict mapping and the streak count are
 * exactly the two places a gate like this quietly turns green when it should
 * not, so they are testable without a database. */

/* Local calendar date, not UTC. Three sites in this repo use
 * `toISOString().slice(0,10)`, which in MYT (UTC+8) files anything logged
 * before 08:00 under yesterday — the breakfast and wake-time window this
 * whole spec is about. A gate that measured a daily habit in UTC would
 * miscount the streak in the same direction as the bug it is policing. */
export function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Days back from `today`, inclusive, where all three of meal/sleep/learning
 * have at least one row. `mealDates` is expected to hold only meals with a
 * non-null image_path — the spec's done-check says "≥1 meal row where
 * image_path is not null", so a text-only meal must not extend the streak.
 *
 * Today counts. A day that is only half over therefore reads as a break, and
 * the streak reads 0 until dinner is logged. That is the honest reading of
 * "seven consecutive days" and it costs nothing while the streak is 0/7; if it
 * ever becomes annoying at 10am, that is a signal the habit exists, which is
 * the whole point of the gate. */
export function countStreak(today, mealDates, sleepDates, learningDates) {
  const meals = new Set(mealDates);
  const sleeps = new Set(sleepDates);
  const learns = new Set(learningDates);
  const cursor = new Date(`${today}T12:00:00`); // midday: immune to DST shifts
  let streak = 0;
  for (;;) {
    const day = localDateStr(cursor);
    if (!meals.has(day) || !sleeps.has(day) || !learns.has(day)) return streak;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
}

/* One probed table -> one verdict. The `missing` / `unreachable` split is the
 * point of this function. A gate that cannot see the data has NOT observed
 * zero rows; it has observed nothing, and reporting that as a pass is the
 * exact silent-pass defect this repo keeps shipping. Both non-ok states fail,
 * and they fail with different words so the reader knows whether to run a
 * migration or fix the network. */
export function tableVerdict(probe) {
  if (probe.state === 'unreachable') return 'UNREACHABLE';
  if (probe.state === 'missing') return 'MISSING';
  if (probe.state !== 'ok' || typeof probe.rows !== 'number') return 'UNREACHABLE';
  return probe.rows > 0 ? 'OK' : 'EMPTY';
}

/* Worst verdict wins, and "worst" means loudest-to-fix first: a module with an
 * unreachable table is not an empty module, it is an unknown one. An empty
 * table list is UNREACHABLE, not OK — a module we forgot to probe must never
 * read as passing. */
const SEVERITY = ['OK', 'EMPTY', 'MISSING', 'UNREACHABLE'];
export function moduleVerdict(verdicts) {
  if (!verdicts.length) return 'UNREACHABLE';
  return verdicts.reduce((worst, v) =>
    (SEVERITY.indexOf(v) > SEVERITY.indexOf(worst) ? v : worst), 'OK');
}

export function gatePasses(moduleVerdicts) {
  return moduleVerdicts.length > 0 && moduleVerdicts.every((v) => v === 'OK');
}

/* ------------------------------------------------------------------- the I/O
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* Same loader as tools/backup-db.mjs: process.env wins over .env, which is how
 * this gate can be pointed at a dead host to prove it fails without editing
 * .env. */
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

/* Modules as the human built them, not as the database groups them. The gate
 * speaks in the names he uses when he decides what to build next. */
const MODULES = [
  { name: 'Training', tables: ['mesocycles', 'sessions', 'session_exercises', 'sets'] },
  { name: 'Finance', tables: ['receipts', 'expenses', 'work_hours'] },
  { name: 'Health', tables: ['meals', 'workouts', 'sleep'] },
  { name: 'Capture', tables: ['capture_queue'] },
];

const DONE_CHECK = `"Done-check: seven consecutive days with >=1 meal row where image_path is not
 null and a rendered thumbnail, >=1 sleep row, >=1 learning row - all entered
 from the phone. If the streak does not happen, stop and fix the friction
 before building anything else."`;

/* Exact row count via PostgREST's count=exact + a zero-width range, so the
 * body stays empty however many rows there are. content-range is `*​/0` for an
 * empty table and `0-0/113` otherwise; the count is always after the slash. */
async function probeTable(sb, headers, table) {
  let res;
  try {
    res = await fetch(`${sb}/rest/v1/${table}?select=id`, {
      headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
    });
  } catch (err) {
    return { table, state: 'unreachable', rows: null, detail: err.message };
  }
  if (res.status === 404) {
    // PGRST205 (schema cache) and 42P01 (undefined_table) both mean "no such
    // table" — the module was never migrated, which is not the same fact as
    // "the module has no rows".
    return { table, state: 'missing', rows: null, detail: `HTTP 404 ${await res.text()}`.slice(0, 200) };
  }
  if (!res.ok && res.status !== 206) {
    return { table, state: 'unreachable', rows: null, detail: `HTTP ${res.status} ${await res.text()}`.slice(0, 200) };
  }
  const range = res.headers.get('content-range');
  const count = range && range.includes('/') ? Number(range.split('/')[1]) : NaN;
  if (!Number.isFinite(count)) {
    return { table, state: 'unreachable', rows: null, detail: `no usable content-range: ${range}` };
  }
  return { table, state: 'ok', rows: count, detail: '' };
}

/* Pull the date column for a streak input. Throws rather than returning [] —
 * an empty array and a failed request would otherwise be indistinguishable,
 * and "the streak query broke" must never render as "the streak is 0". */
async function fetchDates(sb, headers, path, column) {
  const res = await fetch(`${sb}/rest/v1/${path}`, { headers });
  if (!res.ok && res.status !== 206) {
    throw new Error(`${path} -> HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  return (await res.json()).map((r) => r[column]).filter(Boolean);
}

async function main() {
  const env = loadEnv();
  const sb = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const today = localDateStr(new Date());

  console.log('life-os stop-gate  ·  ' + today);
  console.log('='.repeat(72));

  if (!sb || !key) {
    // Absent credentials are an unreachable database, not an empty one.
    console.log('\nUNREACHABLE: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
    console.log('The gate cannot observe the data, so it cannot pass. Failing loudly.');
    process.exit(2);
  }
  const headers = { apikey: key, authorization: `Bearer ${key}` };

  const results = [];
  for (const mod of MODULES) {
    const probes = await Promise.all(mod.tables.map((t) => probeTable(sb, headers, t)));
    const verdicts = probes.map(tableVerdict);
    results.push({ ...mod, probes, verdict: moduleVerdict(verdicts) });
  }

  let streak = null;
  let streakError = null;
  try {
    const [meals, sleeps, learns] = await Promise.all([
      // image_path=not.is.null is the spec's wording, enforced server-side.
      fetchDates(sb, headers, 'meals?select=eaten_at&image_path=not.is.null&order=eaten_at.desc&limit=2000', 'eaten_at'),
      fetchDates(sb, headers, 'sleep?select=slept_on&order=slept_on.desc&limit=2000', 'slept_on'),
      fetchDates(sb, headers, 'learning_sessions?select=learned_on&order=learned_on.desc&limit=2000', 'learned_on'),
    ]);
    streak = countStreak(today, meals, sleeps, learns);
  } catch (err) {
    streakError = err.message;
  }

  console.log('\nMODULES  (rule: no new module while an existing module has zero production rows)\n');
  for (const r of results) {
    const mark = r.verdict === 'OK' ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${r.name.padEnd(9)} ${r.verdict}`);
    for (const p of r.probes) {
      const v = tableVerdict(p);
      const shown = v === 'OK' || v === 'EMPTY' ? `${p.rows} rows` : v.toLowerCase();
      console.log(`           - ${p.table.padEnd(19)} ${shown}${p.detail ? '  :: ' + p.detail : ''}`);
    }
  }

  console.log('\nLOGGING STREAK');
  if (streakError) {
    console.log(`  UNKNOWN - the streak query failed: ${streakError}`);
    console.log('  An unmeasured streak is not a passing streak.');
  } else {
    console.log(`  ${streak} / 7 consecutive days with a photo meal + sleep + learning row.`);
  }

  const offenders = results.filter((r) => r.verdict !== 'OK');
  const pass = gatePasses(results.map((r) => r.verdict)) && streakError === null && streak >= 7;

  console.log('\nWHY THIS GATE EXISTS - his own words, 2026-08-05:\n');
  console.log(DONE_CHECK);

  console.log('\n' + '='.repeat(72));
  if (pass) {
    console.log('GATE PASSES. Every built module has production rows and the streak is >= 7.');
    process.exit(0);
  }
  if (offenders.length) {
    console.log('GATE FAILS. Offending modules: ' + offenders.map((o) => `${o.name} (${o.verdict})`).join(', '));
  } else {
    console.log('GATE FAILS.');
  }
  if (streakError) console.log(`Streak: UNKNOWN (query failed) - required 7.`);
  else console.log(`Streak: ${streak} - required 7.`);
  console.log('Build nothing new until the streak happens. Fix the friction instead.');
  console.log('\nNot checked here, and not claimed: whether a thumbnail actually RENDERS,');
  console.log('and whether the rows were entered FROM THE PHONE. The database cannot');
  console.log('answer either. Passing this gate is necessary, not sufficient.');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    // An unhandled error is an unobserved database. Exit code 2, never 0.
    console.error('\nGATE ERROR (not a pass): ' + err.message);
    process.exit(2);
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tablesFromOpenApi,
  bucketsFromList,
  parseContentRange,
  coverageReport,
  isSafeObjectKey,
} from './backup-db.mjs';

/* Shaped like the real PostgREST root: the doc path, two RPCs, and the
 * relations. `sets` and `sleep` are the tables that migrations added after the
 * old hardcoded array was frozen — the ones the 2026-08-05 run silently skipped. */
const OPENAPI = {
  swagger: '2.0',
  paths: {
    '/': {},
    '/receipts': {},
    '/feed_items': {},
    '/sleep': {},
    '/sets': {},
    '/rpc/rls_auto_enable': {},
    '/rpc/requires_aal2': {},
  },
};

test('table discovery reads the live schema, so a new table needs no code change', () => {
  assert.deepEqual(tablesFromOpenApi(OPENAPI), ['feed_items', 'receipts', 'sets', 'sleep']);
});

test('discovery drops the root doc and stored procedures, which are not relations', () => {
  const names = tablesFromOpenApi(OPENAPI);
  assert.ok(!names.includes(''));
  assert.ok(!names.some((n) => n.startsWith('rpc/')));
});

test('a spec with no paths yields no tables (and coverage turns that into a failure)', () => {
  assert.deepEqual(tablesFromOpenApi({}), []);
  assert.deepEqual(tablesFromOpenApi(null), []);
  assert.equal(coverageReport([], new Map()).ok, false);
});

test('bucket discovery covers every live bucket, including public ones', () => {
  const live = [
    { id: 'receipts', name: 'receipts', public: false },
    { id: 'meals', name: 'meals', public: false },
    { id: 'exercise-media', name: 'exercise-media', public: true },
  ];
  assert.deepEqual(bucketsFromList(live), ['exercise-media', 'meals', 'receipts']);
  assert.deepEqual(bucketsFromList(null), []);
});

test('Content-Range gives the true total, including the empty-relation form', () => {
  assert.deepEqual(parseContentRange('0-999/4213'), { from: 0, to: 999, total: 4213 });
  assert.deepEqual(parseContentRange('*/0'), { from: null, to: null, total: 0 });
  assert.deepEqual(parseContentRange('0-9/*'), { from: 0, to: 9, total: null });
});

test('an unparseable Content-Range is null, never mistaken for "no more rows"', () => {
  assert.equal(parseContentRange(undefined), null);
  assert.equal(parseContentRange(''), null);
  assert.equal(parseContentRange('rows 0-9'), null);
});

test('coverage passes only when every discovered table is on disk with the right count', () => {
  const r = coverageReport(['receipts', 'sleep'], {
    receipts: { rows: 3, expected: 3 },
    sleep: { rows: 0, expected: 0 },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reasons, []);
});

test('the 2026-08-05 defect: a discovered table with no backup file FAILS', () => {
  const r = coverageReport(['receipts', 'sets'], { receipts: { rows: 3, expected: 3 } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['sets']);
  assert.match(r.reasons.join(' '), /sets/);
});

test('a half-written table fails: fewer rows on disk than the API counted', () => {
  const r = coverageReport(['feed_items'], { feed_items: { rows: 1000, expected: 4213 } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.mismatched, [{ name: 'feed_items', onDisk: 1000, expected: 4213 }]);
});

test('a corrupt backup file fails rather than counting as covered', () => {
  const r = coverageReport(['meals'], { meals: { error: 'Unexpected end of JSON input' } });
  assert.equal(r.ok, false);
  assert.equal(r.unreadable.length, 1);
});

test('extra files on disk do not mask a missing table', () => {
  const r = coverageReport(['sets'], { receipts: { rows: 9, expected: 9 } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['sets']);
});

test('storage keys that would escape the backup directory are rejected', () => {
  assert.equal(isSafeObjectKey('barbell-curl/674.png'), true);
  assert.equal(isSafeObjectKey('674.png'), true);
  assert.equal(isSafeObjectKey('../../.env'), false);
  assert.equal(isSafeObjectKey('a/../../b'), false);
  assert.equal(isSafeObjectKey('/etc/passwd'), false);
  assert.equal(isSafeObjectKey(''), false);
});

// ── failureReason: a failure that cannot say what failed ─────────────────────────────────────
// `ok` is decided by FOUR sources — coverage, bucketCoverage, bucketFailures, tableFetchFailures
// — and the ledger call used to record only `coverage.reasons`. A run that failed on a bucket or
// a table fetch therefore wrote status='failed' with an EMPTY error, which is exactly what the
// 2026-08-17 and 2026-08-22 job_runs rows look like. The verdict and its explanation have to come
// from the same set of facts or they drift apart precisely when someone needs them.
test('failureReason covers every source that can set ok=false', async () => {
  const { failureReason } = await import('./backup-db.mjs');

  assert.equal(failureReason({ ok: true }), null, 'a good run has no reason to give');

  assert.equal(failureReason({ ok: false, coverage: { reasons: ['no backup file for: x'] } }),
    'no backup file for: x');

  // The regression: these three used to produce an empty error string.
  assert.match(failureReason({
    ok: false, coverage: { reasons: [] },
    bucketResults: [{ name: 'storage:media', ok: false, detail: '403 forbidden' }],
  }), /storage:media: 403 forbidden/);

  assert.match(failureReason({
    ok: false, coverage: { reasons: [] },
    tableResults: [{ name: 'notes', ok: false, detail: 'truncated: collected 10 of 99 row(s)' }],
  }), /table notes: truncated/);

  assert.match(failureReason({
    ok: false, coverage: { reasons: [] }, bucketCoverage: { reasons: ['no file for: avatars'] },
  }), /bucket coverage: no file for: avatars/);
});

test('failureReason says so LOUDLY when nothing explained the failure', async () => {
  // The guard against this recurring: someone adds a fifth condition to `ok` and forgets to add a
  // matching reason line. Writing '' there is how the original defect looked from the ledger.
  const { failureReason } = await import('./backup-db.mjs');
  const r = failureReason({ ok: false });
  assert.ok(r && r.length > 0, 'an empty reason is the defect, not an acceptable answer');
  assert.match(r, /no source explained why/);
});

test('a source that failed without a detail still names itself', async () => {
  const { failureReason } = await import('./backup-db.mjs');
  assert.match(failureReason({ ok: false, coverage: { reasons: [] }, tableResults: [{ name: 't', ok: false }] }),
    /table t: failed with no detail/);
});

// ── The 2026-09-12 defects ───────────────────────────────────────────────────
// Off-site snapshot for that week: 17 objects where 62 belong. career_goals,
// expenses and sleep threw "fetch failed"; so did the exercise-media listing,
// taking all 42 media files with it. Every table that failed was followed by
// one that succeeded, so the cause was the network, not the data — and the
// run's own coverage line still printed "3 bucket(s) discovered, 3 verified on
// disk", which is the string every run this job has ever logged.

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  isTransient,
  expectedObjectCount,
  offsiteReport,
} from './backup-db.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP = join(HERE, 'backup-db.mjs');
const WEEKLY = join(HERE, '..', 'scripts', 'backup-db-weekly.sh');

test('a thrown fetch and every 5xx are worth retrying; a considered 4xx is not', () => {
  // The shapes actually seen: "fetch failed" (2026-09-12) and a 504 from
  // PostgREST on career_goals (measured 2026-09-13, 200 on the next attempt).
  assert.equal(isTransient({ error: new Error('fetch failed') }), true);
  assert.equal(isTransient({ status: 504 }), true);
  assert.equal(isTransient({ status: 500 }), true);
  assert.equal(isTransient({ status: 429 }), true);

  // The other direction, which is the half that keeps the budget honest: a 403
  // retried five times is five minutes spent to print the same 403.
  assert.equal(isTransient({ status: 200 }), false);
  assert.equal(isTransient({ status: 401 }), false);
  assert.equal(isTransient({ status: 404 }), false);
  assert.equal(isTransient({ status: 416 }), false);
});

test('a bucket that never got listed is a coverage FAILURE, not a row that drops out', () => {
  // The defect: run() built the checked set from `bucketResults.filter(b => b.files != null)`.
  // A bucket whose listing threw has no `files`, so the most complete failure available was the
  // one case excluded from the check — while the printed denominator still came from
  // `buckets.length`. Both numbers now come from this one object.
  const r = coverageReport(
    ['storage:exercise-media', 'storage:meals', 'storage:receipts'],
    { 'storage:meals': { rows: 0, expected: 0 }, 'storage:receipts': { rows: 0, expected: 0 } },
    { noun: 'bucket', missingReason: (n) => `${n}: never fetched — the listing failed, so not one file was attempted` },
  );
  assert.equal(r.ok, false);
  assert.equal(r.checked, 3, 'the bucket that failed is still one of the three that must be verified');
  assert.equal(r.verified, 2, 'a line that says 3 of 3 on this input is the bug');
  assert.match(r.reasons.join(' '), /storage:exercise-media: never fetched/);
});

test('coverage checked/verified stay in step with the discovered list', () => {
  const good = coverageReport(['a', 'b'], { a: { rows: 1, expected: 1 }, b: { rows: 2, expected: 2 } });
  assert.equal(good.checked, 2);
  assert.equal(good.verified, 2);
  const short = coverageReport(['a', 'b'], { a: { rows: 1, expected: 2 } });
  assert.equal(short.checked, 2);
  assert.equal(short.verified, 0, 'one mismatched, one missing — neither is verified');
});

test('the expected off-site object count is derived, never a remembered 62', () => {
  // 62 is today's number: 19 tables + 42 media files + _manifest.json. Writing it down
  // would turn the twentieth table into a red alarm for a healthy migration.
  assert.equal(expectedObjectCount({ counts: { tables: 19, files: 42, filesListed: 42 } }), 62);
  assert.equal(expectedObjectCount({ counts: { tables: 20, files: 42, filesListed: 42 } }), 63);
  assert.equal(expectedObjectCount({ counts: { tables: 19, files: 0, filesListed: 0 } }), 20);

  // Listed 42, saved 40: sizing the off-site check against what was SAVED makes it
  // agree with the shortfall it was handed — 60 objects up there, 60 expected, green.
  assert.equal(expectedObjectCount({ counts: { tables: 19, files: 40, filesListed: 42 } }), 62);
  // Manifests written before 2026-09-13 have no filesListed and must still parse.
  assert.equal(expectedObjectCount({ counts: { tables: 19, files: 42 } }), 62);
  assert.equal(expectedObjectCount({}), null);
  assert.equal(expectedObjectCount(null), null);
});

test('off-site verification needs the count AND the checksums, and says which one failed', () => {
  const green = offsiteReport({
    date: '2026-09-05', expected: 62, localObjects: 62, remoteObjects: 62,
    checkOutput: "NOTICE: Google drive root 'life-os-backups/db/2026-09-05': 0 differences found",
  });
  assert.equal(green.ok, true);
  assert.deepEqual(green.reasons, []);

  // 2026-09-12 exactly: rclone exited 0 over a directory that was already short.
  const short = offsiteReport({
    date: '2026-09-12', expected: 62, localObjects: 17, remoteObjects: 17,
    checkOutput: 'NOTICE: 0 differences found',
  });
  assert.equal(short.ok, false, 'a faithful copy of an incomplete snapshot is still an incomplete snapshot');
  assert.match(short.reasons.join(' '), /LOCAL snapshot is already short — 17 of 62/);
  assert.match(short.reasons.join(' '), /off-site holds 17 of 62/);

  // A count that matches while the bytes do not.
  const corrupt = offsiteReport({
    date: '2026-09-05', expected: 62, localObjects: 62, remoteObjects: 62,
    checkOutput: 'NOTICE: 3 differences found',
  });
  assert.equal(corrupt.ok, false, 'matching object counts cannot vouch for the bytes');
  assert.match(corrupt.reasons.join(' '), /did not say "0 differences found"/);

  // And the one that would make this whole check vacuous: no output at all
  // (rclone missing, or its NOTICE lines read from the wrong stream).
  assert.equal(offsiteReport({
    date: '2026-09-05', expected: 62, localObjects: 62, remoteObjects: 62, checkOutput: '',
  }).ok, false, 'silence is not "0 differences found"');
});

// ── End to end, over a fake Supabase ─────────────────────────────────────────
//
// NOT by pointing SUPABASE_URL at an unroutable host. That kills DISCOVERY —
// tablesFromOpenApi(await getJson(...)) has no try around it, the throw reaches
// main().catch, and report() never prints a character. The line under test does
// not appear at all, so a loose assertion passes on broken and fixed code alike
// and a strict one fails on both. The injection has to be selective: everything
// green except the one call that failed on 2026-08-22 and 2026-09-12.

const TABLES = [
  'capture_queue', 'career_goals', 'expenses', 'feed_items', 'improvements',
  'learning_materials', 'learning_sessions', 'meals', 'mesocycles', 'pay_settings',
  'receipt_items', 'receipts', 'session_exercises', 'sessions', 'sets', 'sleep',
  'user_settings', 'work_hours', 'workouts',
];
const CAREER_GOAL_ROWS = 36; // what the fake server serves; the assertions read it from here
const ROWS = Object.fromEntries(TABLES.map((t) => [t, []]));
ROWS.career_goals = Array.from({ length: CAREER_GOAL_ROWS }, (_, i) => ({ id: i + 1, title: `goal ${i + 1}` }));
ROWS.feed_items = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }));

const BUCKETS = ['exercise-media', 'meals', 'receipts'];
/* 42 media files under three prefixes — the <folder>/<file> layout the storage
 * list API only walks one level at a time. */
const OBJECTS = {
  'exercise-media': ['squat', 'plank', 'row'].flatMap(
    (folder) => Array.from({ length: 14 }, (_, i) => `${folder}/${i + 1}.png`)),
  meals: [],
  receipts: [],
};
const MEDIA_FILES = OBJECTS['exercise-media'].length;

/* One level of the storage listing: children of `prefix`, folders marked id:null. */
function listLevel(bucket, prefix) {
  const head = prefix ? `${prefix}/` : '';
  const seen = new Map();
  for (const key of OBJECTS[bucket] || []) {
    if (!key.startsWith(head)) continue;
    const rest = key.slice(head.length);
    const seg = rest.split('/')[0];
    if (!seen.has(seg)) seen.set(seg, { name: seg, id: rest.includes('/') ? null : `id-${seg}` });
  }
  return [...seen.values()];
}

function fakeSupabase({ failListFor = null, flakyTables = {}, missingObjects = [] } = {}) {
  const attempts = new Map(); // table -> how many times it has been asked for
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/rest/v1/') {
      return send(200, { swagger: '2.0', paths: Object.fromEntries([['/', {}], ['/rpc/noop', {}], ...TABLES.map((t) => [`/${t}`, {}])]) });
    }
    if (req.method === 'GET' && url.pathname === '/storage/v1/bucket') {
      return send(200, BUCKETS.map((name) => ({ id: name, name })));
    }
    const table = url.pathname.startsWith('/rest/v1/') ? url.pathname.slice('/rest/v1/'.length) : null;
    if (req.method === 'GET' && table && ROWS[table]) {
      const n = (attempts.get(table) || 0) + 1;
      attempts.set(table, n);
      // The 2026-09-12 shape for a table: the socket goes away, and the very
      // next request to the same table succeeds.
      if (n <= (flakyTables[table] || 0)) { res.destroy(); return; }
      const all = ROWS[table];
      const [from, to] = String(req.headers.range || '0-999').split('-').map(Number);
      if (from >= all.length && all.length > 0) return send(416, []);
      const page = all.slice(from, to + 1);
      const cr = all.length === 0 ? `*/0` : `${from}-${from + page.length - 1}/${all.length}`;
      return send(200, page, { 'content-range': cr });
    }
    const listing = url.pathname.match(/^\/storage\/v1\/object\/list\/(.+)$/);
    if (req.method === 'POST' && listing) {
      const bucket = listing[1];
      if (bucket === failListFor) { res.destroy(); return; } // the 2026-09-12 shape: the socket goes away
      let body = '';
      req.on('data', (c) => { body += c; });
      return req.on('end', () => {
        const { prefix = '' } = JSON.parse(body || '{}');
        send(200, listLevel(bucket, prefix));
      });
    }
    const object = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (req.method === 'GET' && object) {
      if (missingObjects.includes(object[2])) return send(404, { message: 'Object not found' });
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(Buffer.from(`bytes of ${object[2]}`));
    }
    return send(404, { message: 'no route' });
  });
  return server;
}

const FAKE_JOB_RUNS = `import { appendFileSync, readFileSync, existsSync } from 'node:fs';
const L = process.env.FAKE_LEDGER;
const rows = () => (existsSync(L) ? readFileSync(L, 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export function startRun({ job, step = null } = {}) {
  const id = rows().length + 1;
  appendFileSync(L, JSON.stringify({ op: 'start', id, job, step }) + '\\n');
  return id;
}
export function finishRun(id, { status, counts = null, error = null } = {}) {
  appendFileSync(L, JSON.stringify({ op: 'finish', id, status, counts, error }) + '\\n');
}
if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'start') console.log(startRun({ job: rest[0], step: rest[1] || null }));
  else if (cmd === 'finish') finishRun(Number(rest[0]), { status: rest[1], error: rest[3] || null });
  else process.exit(2);
}
`;

/* Stands in for rclone over two local directories. Implements exactly the three
 * subcommands the script uses, including writing its NOTICE lines to stderr —
 * which is where the real one writes them, and reading the wrong stream would
 * make the "0 differences found" test恒真-green. */
const FAKE_RCLONE = `#!/bin/sh
cmd=$1; shift
case "$cmd" in
  copy)  mkdir -p "$2"; cp -R "$1"/. "$2"/ ;;
  lsf)   d=""; for a in "$@"; do case "$a" in -*) ;; *) d="$a";; esac; done
         [ -d "$d" ] || exit 0
         cd "$d" && find . -type f | sed 's|^\\./||' ;;
  check) a=$( cd "$1" 2>/dev/null && find . -type f -exec shasum {} \; | sort )
         b=$( cd "$2" 2>/dev/null && find . -type f -exec shasum {} \; | sort )
         if [ "$a" = "$b" ]; then echo "NOTICE: 0 differences found" >&2
         else echo "NOTICE: 1 differences found" >&2; exit 1; fi ;;
  *)     echo "fake rclone: unknown $cmd" >&2; exit 2 ;;
esac
`;

async function withFixture(opts, body) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-db-test-'));
  const server = fakeSupabase(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ledger = join(dir, 'ledger.jsonl');
  writeFileSync(ledger, '');
  writeFileSync(join(dir, 'job-runs.mjs'), FAKE_JOB_RUNS);
  writeFileSync(join(dir, 'rclone'), FAKE_RCLONE);
  chmodSync(join(dir, 'rclone'), 0o755);
  const remote = join(dir, 'remote');
  mkdirSync(remote, { recursive: true });

  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    LIFEOS_BACKUP_ROOT: join(dir, 'backups'),
    LIFEOS_JOB_RUNS_MODULE: join(dir, 'job-runs.mjs'),
    LIFEOS_BACKUP_JOB_RUNS: join(dir, 'job-runs.mjs'),
    LIFEOS_BACKUP_NODE: process.execPath,
    LIFEOS_BACKUP_RCLONE: join(dir, 'rclone'),
    LIFEOS_BACKUP_REMOTE: remote,
    FAKE_LEDGER: ledger,
    BACKUP_RETRY_DELAYS_MS: '0,0', // the retry DECISION is under test, not the sleeping
    BACKUP_REQUEST_TIMEOUT_MS: '8000',
  };

  /* execFile, NOT execFileSync. The fake Supabase runs in THIS process, and a
   * synchronous child blocks the event loop that has to accept its connections
   * — the child then sees every request time out, which looks exactly like the
   * network failure the fixture is supposed to be injecting selectively. */
  const run = async (argv, file = process.execPath, args = [BACKUP, ...argv]) => {
    const opts = { encoding: 'utf8', env, cwd: dir, maxBuffer: 16 * 1024 * 1024 };
    try {
      const { stdout, stderr } = await promisify(execFile)(file, args, opts);
      return { code: 0, stdout: `${stdout}${stderr}` };
    } catch (e) {
      return { code: e.code ?? 1, stdout: `${e.stdout || ''}${e.stderr || ''}` };
    }
  };

  try {
    return await body({
      dir,
      remote,
      env,
      date: new Date().toISOString().slice(0, 10),
      run,
      runWeekly: () => run([], '/bin/sh', [WEEKLY]),
      ledger: () => readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    });
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}

test('one dead bucket listing: exit 1, a ledger row that says why, and a coverage line that admits it', async () => {
  await withFixture({ failListFor: 'exercise-media' }, async (fx) => {
    const { code, stdout } = await fx.run([]);

    assert.equal(code, 1, 'a backup missing 42 files is not a success');

    // The 19 tables and the other two buckets really did succeed — this is a
    // selective failure, not a dead endpoint, so report() actually ran.
    assert.match(stdout, /✓ career_goals: 36 row\(s\)/);
    assert.match(stdout, new RegExp(`coverage: ${TABLES.length} table\\(s\\) discovered, ${TABLES.length} verified on disk`));

    // THE恒真 LINE. Five runs of this job have logged "3 bucket(s) discovered,
    // 3 verified on disk" and never anything else — including 2026-08-22 and
    // 2026-09-12, when this exact call failed and no storage/ directory was
    // written at all. Both halves are asserted: the denominator must still be
    // every discovered bucket, and the numerator must be smaller than it.
    const line = stdout.match(/coverage: (\d+) bucket\(s\) discovered, (\d+) verified on disk/);
    assert.ok(line, 'the bucket coverage line must still be printed');
    assert.equal(Number(line[1]), BUCKETS.length, 'the failed bucket must not vanish from the denominator');
    assert.ok(Number(line[2]) < BUCKETS.length,
      `a bucket that was never fetched cannot be "verified on disk" — got ${line[2]} of ${line[1]}`);
    assert.match(stdout, /✗ bucket storage:exercise-media: never fetched/);

    // 2026-08-17 and 2026-08-22 wrote status='failed' with an EMPTY error.
    const rows = fx.ledger();
    const start = rows.find((r) => r.op === 'start' && r.job === 'backup-db' && r.step == null);
    assert.ok(start, 'the run must open a wrapper row');
    const finish = rows.find((r) => r.op === 'finish' && r.id === start.id);
    assert.equal(finish.status, 'failed');
    assert.ok(finish.error && finish.error.length > 0, 'a failure that cannot say what failed is the old defect');
    assert.match(finish.error, /exercise-media/);
  });
});

test('a normal week: the off-site copy is verified and the ledger has a green offsite step', async () => {
  await withFixture({}, async (fx) => {
    const { code, stdout } = await fx.runWeekly();
    assert.equal(code, 0, `the weekly script should be green on a clean week:\n${stdout}`);

    // 1. THE STEP EXISTS AND IS GREEN. Testing only the failure direction would pass an
    // implementation that writes the row exclusively when rclone fails — and then "rclone
    // succeeded" and "rclone never ran" stay indistinguishable, which is today's state:
    // `SELECT DISTINCT job, step` has exactly one pair for backup-db, and it is (backup-db, NULL).
    const rows = fx.ledger();
    const offsite = rows.find((r) => r.op === 'start' && r.job === 'backup-db' && r.step === 'offsite');
    assert.ok(offsite, "a green run must still record step='offsite' — silence is what it replaces");
    const done = rows.find((r) => r.op === 'finish' && r.id === offsite.id);
    assert.ok(done, "the offsite step must be CLOSED on a green week too — an implementation that "
      + "only finishes it on failure leaves 'rclone succeeded' and 'rclone never ran' identical");
    assert.equal(done.status, 'ok');

    // 2. THE COUNT COMES OUT OF THE MANIFEST. Never a literal: 19 + 42 + 1 is today's
    // shape and the twentieth table must not turn this green check red.
    const snapshot = join(fx.remote, fx.date);
    const manifest = JSON.parse(readFileSync(join(snapshot, '_manifest.json'), 'utf8'));
    const expected = manifest.counts.tables + manifest.counts.files + 1;
    assert.equal(expected, TABLES.length + MEDIA_FILES + 1, 'the manifest must describe what was discovered');
    assert.match(stdout, new RegExp(`${expected} of ${expected} object\\(s\\) off-site, checksums match`));

    // 3. THE HEAVIEST ONE: read a table back out of the OFF-SITE directory and
    // count its rows against what the database said. 2026-09-12's off-site copy
    // has no career_goals.json at all, and nothing in the pipeline noticed.
    const offsiteGoals = JSON.parse(readFileSync(join(snapshot, 'career_goals.json'), 'utf8'));
    assert.equal(offsiteGoals.length, CAREER_GOAL_ROWS,
      'the rows readable off-site must match the exact count the API reported');

    const media = readFileSync(join(snapshot, 'storage', 'exercise-media', 'squat', '1.png'), 'utf8');
    assert.match(media, /bytes of squat\/1\.png/, 'media files must survive the trip, not just their names');
  });
});

test('the weekly script fails loudly, and records WHY, when the snapshot never reaches Drive', async () => {
  await withFixture({}, async (fx) => {
    // rclone that cannot run at all — the 2026-08-05 shape, which exited 0.
    writeFileSync(join(fx.dir, 'rclone'), '#!/bin/sh\necho "boom" >&2\nexit 1\n');
    chmodSync(join(fx.dir, 'rclone'), 0o755);
    const { code, stdout } = await fx.runWeekly();
    assert.notEqual(code, 0, 'a backup that never left the laptop is not a clean weekly backup');
    assert.match(stdout, /rclone copy failed/);
    const rows = fx.ledger();
    const offsite = rows.find((r) => r.op === 'start' && r.step === 'offsite');
    const done = rows.find((r) => r.op === 'finish' && r.id === offsite.id);
    assert.equal(done.status, 'failed');
    assert.match(done.error, /rclone copy exited 1/);
  });
});

test('a table that throws once and answers on the retry costs the backup nothing', async () => {
  // The whole of defect 1, wired end to end. Four bare `await fetch` calls meant one dropped
  // socket WAS the verdict for that table — and on 2026-09-12 that cost career_goals, expenses
  // and sleep, none of which had anything wrong with them. The retry notice is asserted too, so
  // this cannot pass by the failure never having been injected.
  await withFixture({ flakyTables: { career_goals: 2 } }, async (fx) => {
    const { code, stdout } = await fx.run([]);
    assert.match(stdout, /✓ career_goals: 36 row\(s\)/,
      'two dropped sockets must not be the verdict for a table that answers on the third try');
    assert.equal(code, 0, `a blip the retry absorbed is not a failed backup:\n${stdout}`);
    // Anti-vacuity: without this the test would also pass if the fixture never
    // injected anything and career_goals simply worked first time.
    assert.match(stdout, /career_goals: .* retry 1\/2/, 'the injected failure must actually have been hit');
  });
});

test('listed 42, saved 40: the bucket read-back compares against what was LISTED', async () => {
  // Defect 4. readBackBucket was handed `b.files` — the number this process believes it saved —
  // as the expected count, then counted the files on disk and found... the same number. The one
  // discrepancy a disk read-back exists to find was the one it could never report.
  const gone = OBJECTS['exercise-media'].slice(0, 2);
  await withFixture({ missingObjects: gone }, async (fx) => {
    const { code, stdout } = await fx.run([]);
    assert.equal(code, 1);
    const saved = MEDIA_FILES - gone.length;
    assert.match(stdout, new RegExp(`✗ bucket storage:exercise-media: ${saved} row\\(s\\) on disk, API reported ${MEDIA_FILES}`),
      'the read-back must compare disk against the LISTING, not against itself');
    const line = stdout.match(/coverage: (\d+) bucket\(s\) discovered, (\d+) verified on disk/);
    assert.equal(Number(line[1]), BUCKETS.length);
    assert.ok(Number(line[2]) < BUCKETS.length, `got ${line[2]} of ${line[1]} verified with 2 files missing`);
  });
});

test('a snapshot that is short by two media files cannot record a green offsite step', async () => {
  /* The two halves meeting. The run is red (the bucket reports the 404s), the local snapshot is
   * two files short, rclone copies it faithfully and exits 0 — and the off-site step has to say
   * NO anyway, because "we copied everything we had" is not "a complete snapshot is off-site".
   * Sizing the check against counts.files rather than counts.filesListed makes this green. */
  await withFixture({ missingObjects: OBJECTS['exercise-media'].slice(0, 2) }, async (fx) => {
    const { code, stdout } = await fx.runWeekly();
    assert.notEqual(code, 0);
    const expected = TABLES.length + MEDIA_FILES + 1;
    assert.match(stdout, new RegExp(`off-site holds ${expected - 2} of ${expected} object\\(s\\)`));
    const rows = fx.ledger();
    const offsite = rows.find((r) => r.op === 'start' && r.step === 'offsite');
    const done = rows.find((r) => r.op === 'finish' && r.id === offsite.id);
    assert.equal(done.status, 'failed', 'an incomplete snapshot off-site is not a green offsite step');
  });
});

/* ── The WRAPPER row, not the step row (2026-09-13) ─────────────────────────
 *
 * The off-site step row above is queryable and the script exits non-zero, and
 * both of those are real improvements — but neither is what raises the alarm.
 * `healthLine()` in second-brain/backoffice/job-runs.js decides a job's verdict
 * from the wrapper row (step IS NULL) and from nothing else. That is deliberate
 * and must stay: inferring a run's outcome from its step rows is how a later
 * success washes out an earlier failure.
 *
 * So an off-site failure had to change the WRAPPER row, and the only honest way
 * to do that is to stop deciding that row before the off-site copy has been
 * decided. backup-db.mjs leaves it open under LIFEOS_BACKUP_DEFER_VERDICT; this
 * script closes it with `local AND off-site`.
 *
 * Both directions are tested. A rule that can only go red on a broken week
 * cannot certify a good one, and one that can only go green cannot report at all. */

test('a failed off-site copy turns the WRAPPER row red — not just the step row', async () => {
  await withFixture({}, async (fx) => {
    writeFileSync(join(fx.dir, 'rclone'), '#!/bin/sh\necho "boom" >&2\nexit 1\n');
    chmodSync(join(fx.dir, 'rclone'), 0o755);
    const { code, stdout } = await fx.runWeekly();
    assert.notEqual(code, 0, `${stdout}`);

    const rows = fx.ledger();
    const wrapper = rows.find((r) => r.op === 'start' && r.job === 'backup-db' && r.step === null);
    assert.ok(wrapper, 'the wrapper row must still be opened by backup-db.mjs');
    const done = rows.find((r) => r.op === 'finish' && r.id === wrapper.id);
    assert.ok(done, 'the deferred wrapper row must be closed by the script — an open row reads as an orphan, '
      + 'which is a different (and wrong) diagnosis from "the copy failed"');
    assert.equal(done.status, 'failed',
      'healthLine reads THIS row. Green here is the whole blind spot: the local snapshot was perfect '
      + 'and nothing left the laptop.');
    assert.match(done.error, /rclone copy exited 1/);
  });
});

test('a clean week closes the wrapper row ok, exactly once', async () => {
  await withFixture({}, async (fx) => {
    const { code, stdout } = await fx.runWeekly();
    assert.equal(code, 0, `${stdout}`);
    assert.match(stdout, /verdict deferred to the off-site step/,
      'the run must SAY the row is open on purpose — "NOT recorded" would read as a broken ledger');

    const rows = fx.ledger();
    const wrapper = rows.find((r) => r.op === 'start' && r.job === 'backup-db' && r.step === null);
    const closes = rows.filter((r) => r.op === 'finish' && r.id === wrapper.id);
    assert.equal(closes.length, 1,
      'closed twice means backup-db.mjs also decided it, and the two verdicts can disagree');
    assert.equal(closes[0].status, 'ok');
  });
});

test('a complete copy of an INCOMPLETE snapshot is still a red wrapper row', async () => {
  // rclone works perfectly and moves every byte it is given. What it is given is
  // missing 42 files — the 2026-09-12 shape, where the copy exited 0 and 17
  // objects landed where 62 belong.
  await withFixture({ failListFor: 'exercise-media' }, async (fx) => {
    const { code, stdout } = await fx.runWeekly();
    assert.notEqual(code, 0, `${stdout}`);

    const rows = fx.ledger();
    const wrapper = rows.find((r) => r.op === 'start' && r.job === 'backup-db' && r.step === null);
    const done = rows.find((r) => r.op === 'finish' && r.id === wrapper.id);
    assert.equal(done.status, 'failed',
      'rclone succeeding says nothing about whether a whole snapshot exists to copy');
    assert.match(done.error, /incomplete/);
  });
});

test('run by hand, backup-db.mjs still closes its own row — deferral is opt-in', async () => {
  await withFixture({}, async (fx) => {
    // No LIFEOS_BACKUP_DEFER_VERDICT: this is a human at a terminal, with no
    // wrapper script coming along later to close anything.
    const { code, stdout } = await fx.run([]);
    assert.equal(code, 0, `${stdout}`);
    assert.doesNotMatch(stdout, /JOB_RUN_DEFERRED/, 'nothing is deferred when nobody is there to collect it');

    const rows = fx.ledger();
    const wrapper = rows.find((r) => r.op === 'start' && r.job === 'backup-db' && r.step === null);
    const done = rows.find((r) => r.op === 'finish' && r.id === wrapper.id);
    assert.ok(done, 'an un-deferred run that leaves its row open would be reaped as an orphan');
    assert.equal(done.status, 'ok');
  });
});

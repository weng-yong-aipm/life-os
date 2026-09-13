import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

/* End-to-end over the real scripts/feed-daily.sh, with a fake ingest injected
 * through the FEED_DAILY_* seams. No network, no Desk, no second-brain: the
 * point is the retry DECISION, and the only way to see it is to count how many
 * times ingest was actually invoked.
 *
 * mkdtemp, never a PID-named directory — a fixed name collides the moment two
 * test files run in the same process pool, and "passes alone, red in the
 * aggregate" is a bug that hides for weeks. */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'feed-daily.sh');
const GUARD = join(HERE, 'feed-ingest-guard.mjs');

const sources = (n, mark, platform = 'rss') =>
  Array.from({ length: n }, (_, i) => `  ${mark} Source ${i + 1}${mark === '✗' ? ` (${platform})` : ''}: ${mark === '✗' ? 'fetch failed' : 'a title'}`).join('\n');

/* 22 of 22 sources dead, nothing staged — the 2026-09-08 DarkWake shape. */
const ALL_DOWN = `Ingesting [rss] · limit 6/source

· rss: 22 source(s)
${sources(22, '✗')}

0 item(s) staged.
`;

/* 1 of 22 dead, the other 21 fine and stored. */
const ONE_DOWN = `Ingesting [rss] · limit 6/source

· rss: 22 source(s)
  ✗ Bernama (rss): fetch failed
${sources(21, '✓')}

21 item(s) staged.
21 inserted, 0 already known, 0 failed
`;

const ALL_FINE = `Ingesting [rss] · limit 6/source

· rss: 22 source(s)
${sources(22, '✓')}

22 item(s) staged.
22 inserted, 0 already known, 0 failed
`;

/* The 2026-09-13 shape: ingest exits 0 because the 18 sources it still tries
 * all answered, while rss/github/youtube fetched from none of their 57. The
 * `·` lines are the real ones, abbreviated. */
const STARVED = `Ingesting [rss, github, youtube, reddit] · limit 6/source

· rss: skipping 25 given-up source(s): Simon Willison, Latent Space (swyx), ...
· github: skipping 12 given-up source(s): Patrick Collison, John Collison, ...
· youtube: skipping 20 given-up source(s): Andrej Karpathy, AI Engineer, ...
· reddit: skipping 12 given-up source(s): r/ClaudeAI, r/PromptEngineering, ...
· reddit: 14 source(s)
${sources(14, '✓')}

106 item(s) staged.
71 inserted, 35 already known, 0 failed
`;

/* A fake step: appends its name to calls.log, prints the scripted stdout for
 * this invocation, exits with the scripted code. */
function fakeStep(name, plan) {
  return `import { appendFileSync, readFileSync } from 'node:fs';
const calls = process.env.FAKE_CALLS;
appendFileSync(calls, ${JSON.stringify(name)} + '\\n');
const n = readFileSync(calls, 'utf8').split('\\n').filter((l) => l === ${JSON.stringify(name)}).length;
const plan = ${JSON.stringify(plan)};
const step = plan[Math.min(n - 1, plan.length - 1)];
process.stdout.write(step.out || '');
process.exit(step.code || 0);
`;
}

/* Stand-in for second-brain's job-runs.js. Records the exact `finish` argv, so
 * a test can assert on what the ledger was actually told. */
const FAKE_JOB_RUNS = `import { appendFileSync } from 'node:fs';
const [cmd, ...rest] = process.argv.slice(2);
appendFileSync(process.env.FAKE_JOB_RUNS_CALLS, JSON.stringify([cmd, ...rest]) + '\\n');
if (cmd === 'start') { console.log('9001'); }
else if (cmd === 'finish') { appendFileSync(process.env.FAKE_LEDGER, JSON.stringify(rest) + '\\n'); }
`;

function runPipeline({ ingestPlan, probeHost = 'localhost', env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'feed-daily-test-'));
  const sb = join(dir, 'second-brain', 'scripts');
  mkdirSync(sb, { recursive: true });
  const calls = join(dir, 'calls.log');
  const ledger = join(dir, 'ledger.log');
  const jobRunsCalls = join(dir, 'job-runs-calls.log');
  writeFileSync(calls, '');
  writeFileSync(ledger, '');
  writeFileSync(jobRunsCalls, '');

  writeFileSync(join(sb, 'ingest-follow.mjs'), fakeStep('ingest', ingestPlan));
  writeFileSync(join(sb, 'auto-summarize.mjs'), fakeStep('auto-summarize', [{ code: 0 }]));
  writeFileSync(join(sb, 'daily-report.mjs'), fakeStep('daily-report', [{ code: 0 }]));
  writeFileSync(join(dir, 'job-runs.mjs'), FAKE_JOB_RUNS);

  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync('/bin/sh', [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        // Skip the caffeinate re-exec: it works, and re-execing under the test
        // runner would just fork a sleep assertion for no reason.
        FEED_DAILY_CAFFEINATED: '1',
        FEED_DAILY_NODE: process.execPath,
        FEED_DAILY_SB: join(dir, 'second-brain'),
        FEED_DAILY_JOB_RUNS: join(dir, 'job-runs.mjs'),
        FEED_DAILY_GUARD: GUARD,
        FEED_DAILY_STATE_DIR: join(dir, 'state'),
        FEED_DAILY_RETRY_DELAYS: '0 0 0',
        FEED_DAILY_PROBE_HOST: probeHost,
        FEED_DAILY_START: '00:00',
        FAKE_CALLS: calls,
        FAKE_LEDGER: ledger,
        FAKE_JOB_RUNS_CALLS: jobRunsCalls,
        ...env,
      },
    });
  } catch (e) {
    stdout = String(e.stdout || '');
    code = e.status;
  }

  const callLines = readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  const ledgerRows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const jobRunsRows = readFileSync(jobRunsCalls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    dir,
    code,
    stdout,
    ingestCalls: callLines.filter((l) => l === 'ingest').length,
    calls: callLines,
    ledger: ledgerRows,
    jobRuns: jobRunsRows,
    stamp: () => JSON.parse(readFileSync(join(dir, 'state', 'last-run.json'), 'utf8')),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/* ---------- injection 1: every source unreachable ---------- */

test('all 22 sources unreachable -> the WHOLE run is retried, three times', () => {
  const r = runPipeline({
    ingestPlan: [{ out: ALL_DOWN, code: 1 }],
    probeHost: 'nx-feed-daily-test.invalid',
  });
  // Three delays in FEED_DAILY_RETRY_DELAYS, so three attempts and no more.
  assert.equal(r.ingestCalls, 3);
  assert.equal(r.code, 1);
  r.cleanup();
});

test('after the retries are spent the ledger blames the machine, not 22 sources', () => {
  const r = runPipeline({
    ingestPlan: [{ out: ALL_DOWN, code: 1 }],
    probeHost: 'nx-feed-daily-test.invalid',
  });
  const [, status, , summary] = r.ledger.at(-1);
  assert.equal(status, 'failed');
  assert.match(summary, /ingest \[host-network\]/);
  assert.match(summary, /after 3 attempt\(s\)/);
  // The denominator is the whole point: this sentence, unlike ingest's own
  // "22 source(s) unreachable", cannot be misread as 22-of-438.
  assert.match(summary, /0 of 22 attempted source\(s\) returned anything/);
  assert.match(summary, /DNS probe also failed/);
  assert.match(summary, /This is one machine, not 22 sources failing in the same second/);
  r.cleanup();
});

test('a blackout that clears on the second attempt stops retrying and goes green', () => {
  const r = runPipeline({
    ingestPlan: [{ out: ALL_DOWN, code: 1 }, { out: ALL_FINE, code: 0 }],
    probeHost: 'nx-feed-daily-test.invalid',
  });
  assert.equal(r.ingestCalls, 2);
  assert.equal(r.code, 0);
  assert.equal(r.ledger.at(-1)[1], 'ok');
  assert.equal(r.stamp().outcome, 'ok');
  r.cleanup();
});

/* ---------- injection 2: one source down, twenty-one fine ---------- */

test('1 of 22 unreachable -> NO whole-run retry; that is the source, not the weather', () => {
  const r = runPipeline({ ingestPlan: [{ out: ONE_DOWN, code: 1 }] });
  assert.equal(r.ingestCalls, 1);
  r.cleanup();
});

test('1 of 22 unreachable -> the other 21 are recorded as stored, and the cause is named source-side', () => {
  const r = runPipeline({ ingestPlan: [{ out: ONE_DOWN, code: 1 }] });
  const [, status, countsJson, summary] = r.ledger.at(-1);
  assert.equal(status, 'failed');
  assert.match(summary, /ingest \[source-failures\]/);
  assert.match(summary, /after 1 attempt\(s\)/);
  assert.match(summary, /1 of 22 source\(s\) unreachable/);
  assert.match(summary, /21 item\(s\) staged, 21 inserted/);
  // The 21 good ones must not be lost behind the one bad one, and the run must
  // not be relabelled a network fault.
  assert.doesNotMatch(summary, /host network/);
  assert.equal(JSON.parse(countsJson).ingest_attempts, 1);
  // The later steps still run: a partial ingest must still get a report out of
  // what is already stored.
  assert.deepEqual(r.calls, ['ingest', 'auto-summarize', 'daily-report']);
  r.cleanup();
});

/* ---------- injection 3: the normal morning ---------- */

test('a clean ingest is run exactly once — no spare retries', () => {
  const r = runPipeline({ ingestPlan: [{ out: ALL_FINE, code: 0 }] });
  assert.equal(r.ingestCalls, 1);
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, ['ingest', 'auto-summarize', 'daily-report']);
  const [, status, countsJson] = r.ledger.at(-1);
  assert.equal(status, 'ok');
  assert.equal(JSON.parse(countsJson).ingest_kind, 'ok');
  assert.equal(JSON.parse(countsJson).ingest_attempts, 1);
  r.cleanup();
});

/* ---------- the parser's own contract ---------- */

test('output the parser no longer understands is NOT retried and says so out loud', () => {
  // The failure mode this guards: an ingest-follow.mjs rewrite in the other
  // repo makes every line unparseable, which reads as 0 attempted / 0 staged —
  // indistinguishable from a blackout unless the parser can decline.
  const r = runPipeline({ ingestPlan: [{ out: 'brand new output format\n', code: 1 }] });
  assert.equal(r.ingestCalls, 1);
  assert.match(r.ledger.at(-1)[3], /ingest \[unrecognized\]/);
  assert.match(r.ledger.at(-1)[3], /diverged/);
  r.cleanup();
});

/* ---------- injection 4: a starving sweep that ingest itself calls a success ---------- */

test('a sweep that fetched nothing from three of four platforms exits 1, however happy ingest was', () => {
  // THE ACCEPTANCE TEST. On 2026-09-13 this exact input produced exit 0 and
  // "=== feed-daily done … all steps ok ===". ingest's exit code only reports
  // on the sources it chose to try, and it chooses fewer every time one is
  // given up on, so the green gets cheaper as the pipeline starves.
  const r = runPipeline({ ingestPlan: [{ out: STARVED, code: 0 }] });
  assert.equal(r.code, 1, 'a run that fetched nothing from rss, github and youtube is not a pass');
  assert.equal(r.ingestCalls, 1, 'starvation is not retryable — no wait revives a retired source');
  assert.match(r.stdout, /step ingest FAILED \(exit 0, but the guard's verdict is \[starved\]\)/);
  assert.doesNotMatch(r.stdout, /all steps ok/);
  r.cleanup();
});

test('the starved run still gets a report out, and the ledger says what was and was not fetched', () => {
  const r = runPipeline({ ingestPlan: [{ out: STARVED, code: 0 }] });
  const [, status, countsJson, summary] = r.ledger.at(-1);
  assert.equal(status, 'failed');
  assert.match(summary, /ingest \[starved\]/);
  assert.match(summary, /rss 0\/25, github 0\/12, youtube 0\/20/);
  // Both numbers in the sentence: 14-of-20 and 14-of-83 are the readings that
  // have to be told apart, and the old line printed only the first.
  assert.match(summary, /14 source\(s\) attempted, 69 skipped as given-up \(83 enabled in config\)/);
  assert.equal(JSON.parse(countsJson).ingest_kind, 'starved');
  // A failed ingest must not cancel the later steps — see the header.
  assert.deepEqual(r.calls, ['ingest', 'auto-summarize', 'daily-report']);
  r.cleanup();
});

/* ---------- the blackout refund ---------- */

test('a host-network round refunds its source failures, so a local outage cannot retire sources', () => {
  const r = runPipeline({
    ingestPlan: [{ out: ALL_DOWN, code: 1 }],
    probeHost: 'nx-feed-daily-test.invalid',
  });
  const rollbacks = r.jobRuns.filter((c) => c[0] === 'rollback-ingest-failures');
  assert.equal(rollbacks.length, 3, 'one refund per blackout attempt, not one per run');
  // The window must be an instant job-runs.js can compare against
  // ingest_failures.last_attempt, which is Date#toISOString.
  for (const [, since] of rollbacks) {
    assert.match(since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  }
  r.cleanup();
});

test('a source-side failure is NOT refunded — that round really was evidence about those sources', () => {
  const r = runPipeline({ ingestPlan: [{ out: ONE_DOWN, code: 1 }] });
  assert.deepEqual(r.jobRuns.filter((c) => c[0] === 'rollback-ingest-failures'), []);
  r.cleanup();
});

test('a clean run refunds nothing', () => {
  const r = runPipeline({ ingestPlan: [{ out: ALL_FINE, code: 0 }] });
  assert.deepEqual(r.jobRuns.filter((c) => c[0] === 'rollback-ingest-failures'), []);
  r.cleanup();
});

/* ---------- the once-a-day gate and the lock ---------- */

test('the second fire of the same day after a good run does nothing at all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feed-daily-gate-'));
  const state = join(dir, 'state');
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'last-run.json'),
    JSON.stringify({ date: new Date().toLocaleDateString('en-CA'), attempts: 1, outcome: 'ok' }));

  const r = runPipeline({ ingestPlan: [{ out: ALL_FINE, code: 0 }], env: { FEED_DAILY_STATE_DIR: state } });
  assert.equal(r.ingestCalls, 0, 'no step should run once the day is already done');
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '', 'a no-op fire must stay quiet — it happens ~40x a day');
  rmSync(dir, { recursive: true, force: true });
  r.cleanup();
});

test('a stale lock is taken over, not obeyed forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feed-daily-lock-'));
  const state = join(dir, 'state');
  mkdirSync(join(state, 'run.lock'), { recursive: true });
  // A pid that cannot be running: the highest legal pid is well under this.
  writeFileSync(join(state, 'run.lock', 'pid'), '4194303\n');

  const r = runPipeline({ ingestPlan: [{ out: ALL_FINE, code: 0 }], env: { FEED_DAILY_STATE_DIR: state } });
  assert.match(r.stdout, /stale lock \(pid '4194303' is not running\) — taking it over/);
  assert.equal(r.ingestCalls, 1);
  assert.equal(existsSync(join(state, 'run.lock')), false, 'the lock is released on exit');
  rmSync(dir, { recursive: true, force: true });
  r.cleanup();
});

test('a live lock holder is obeyed — no second concurrent run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feed-daily-lock2-'));
  const state = join(dir, 'state');
  mkdirSync(join(state, 'run.lock'), { recursive: true });
  // This test process is definitely alive.
  writeFileSync(join(state, 'run.lock', 'pid'), `${process.pid}\n`);

  const r = runPipeline({ ingestPlan: [{ out: ALL_FINE, code: 0 }], env: { FEED_DAILY_STATE_DIR: state } });
  assert.equal(r.ingestCalls, 0);
  assert.equal(r.code, 0);
  assert.equal(existsSync(join(state, 'run.lock')), true, 'the holder keeps its lock');
  rmSync(dir, { recursive: true, force: true });
  r.cleanup();
});

test('the attempt is claimed before the work, so a killed run still spends it', () => {
  const r = runPipeline({ ingestPlan: [{ out: ALL_DOWN, code: 1 }], probeHost: 'nx-feed-daily-test.invalid' });
  const s = r.stamp();
  assert.equal(s.attempts, 1);
  assert.equal(s.outcome, 'failed');
  r.cleanup();
});

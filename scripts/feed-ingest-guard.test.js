import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIngestOutput, classifyIngest, dayGate, nextStamp, localDate, shQuote, RETRY_DELAYS,
} from './feed-ingest-guard.mjs';

/* Verbatim from ~/Library/Logs/lifeos-feed-ingest.log, the 2026-09-08 07:40:03
 * run — the one launchd fired inside a two-second DarkWake on battery. 21 rss
 * + 1 github + 2 threads = 24 attempted, 22 of them `fetch failed`, threads
 * silent, nothing staged. Trimmed in the middle only; the shapes are exact. */
const BLACKOUT = `Logged in via browser: threads
Ingesting [rss, github, youtube, threads] · limit 6/source

· rss: skipping 4 given-up source(s): Latent Space (swyx), New Straits Times, NYT HomePage, Washington Post World
· rss: 21 source(s)
${Array.from({ length: 21 }, (_, i) => `  ✗ Source ${i + 1} (rss): fetch failed`).join('\n')}
· github: skipping 11 given-up source(s): John Collison, William Hockey, Eric Glyman
· github: 1 source(s)
  ✗ Patrick Collison (github): fetch failed
· youtube: skipping 20 given-up source(s): Andrej Karpathy, AI Engineer
· threads: 2 source(s)

0 item(s) staged.
`;

/* A healthy-but-imperfect sweep, the shape of the 2026-09-04 run: some sources
 * out, the great majority answering. */
const PARTIAL = `Ingesting [rss] · limit 6/source

· rss: 24 source(s)
  ✗ Bernama (rss): fetch failed
  ✗ SCMP (rss): fetch failed
  ✗ Global Times (rss): fetch failed
  ✓ Simon Willison: Something about SQLite
  ✓ Axios: Markets open lower
  ✓ BBC World: A headline

438 item(s) staged.
257 inserted, 179 already known, 2 failed
`;

const CLEAN = `Ingesting [rss] · limit 6/source

· rss: 3 source(s)
  ✓ Simon Willison: Something about SQLite
  ✓ Axios: Markets open lower
  ✓ BBC World: A headline

3 item(s) staged.
3 inserted, 0 already known, 0 failed
`;

/* ---------- parseIngestOutput ---------- */

test('the denominator counts attempted sources and excludes given-up ones', () => {
  const c = parseIngestOutput(BLACKOUT);
  // 21 rss + 1 github + 2 threads. The three "skipping N given-up source(s)"
  // lines describe sources that were never tried; counting them would inflate
  // the denominator and make a total blackout read as partial.
  assert.equal(c.attempted, 24);
  assert.equal(c.unreachable, 22);
  assert.equal(c.reachable, 0);
  assert.equal(c.staged, 0);
  assert.equal(c.recognized, true);
});

test('a partial sweep is parsed with both halves visible', () => {
  const c = parseIngestOutput(PARTIAL);
  assert.equal(c.attempted, 24);
  assert.equal(c.unreachable, 3);
  assert.equal(c.reachable, 3);
  assert.equal(c.staged, 438);
  assert.equal(c.inserted, 257);
  assert.equal(c.storeFailed, 2);
});

test('output that no longer has the staged line is marked unrecognized, not zero', () => {
  // The contract assertion. Zeros and "I could not read this" look identical
  // downstream unless the parser can say which one it is.
  const c = parseIngestOutput('Ingesting [rss]\n· rss: 5 source(s)\nsomething new we do not parse\n');
  assert.equal(c.recognized, false);
  assert.equal(c.staged, 0);
});

/* ---------- classifyIngest: the two failures that are not the same event ---------- */

test('total blackout is classified host-network and IS retryable', () => {
  const v = classifyIngest({ exitCode: 1, stdout: BLACKOUT, dnsOk: false });
  assert.equal(v.kind, 'host-network');
  assert.equal(v.retryable, true);
  // The ledger sentence must carry the denominator, which is the whole reason
  // this module exists — "22 unreachable" alone cannot say 22-of-22.
  assert.match(v.summary, /0 of 24 attempted source\(s\)/);
  assert.match(v.summary, /22 unreachable, 2 silent/);
  assert.match(v.summary, /DNS probe also failed/);
  assert.match(v.summary, /one machine, not 22 sources/);
});

test('a blackout with DNS still resolving says so instead of blaming the network', () => {
  const v = classifyIngest({ exitCode: 1, stdout: BLACKOUT, dnsOk: true });
  assert.equal(v.kind, 'host-network');
  assert.equal(v.retryable, true);
  assert.match(v.summary, /DNS probe SUCCEEDED, so the blackout may not be the network/);
});

test('a few dead sources out of many is source-failures and is NOT retryable', () => {
  // 3 of 24 out while 438 items staged. Retrying the whole sweep cannot fix
  // somebody else's feed, and calling this a network fault sends you chasing
  // the wrong thing.
  const v = classifyIngest({ exitCode: 1, stdout: PARTIAL.replace(', 2 failed', ', 0 failed'), dnsOk: true });
  assert.equal(v.kind, 'source-failures');
  assert.equal(v.retryable, false);
  assert.match(v.summary, /3 of 24 source\(s\) unreachable/);
  assert.match(v.summary, /the whole sweep is not retried/);
});

test('items fetched but not stored is the pipeline, never the network', () => {
  const v = classifyIngest({ exitCode: 1, stdout: PARTIAL, dnsOk: false });
  assert.equal(v.kind, 'store-failures');
  assert.equal(v.retryable, false);
  assert.match(v.summary, /2 item\(s\) fetched but not stored/);
  assert.match(v.summary, /Not a network fault/);
});

test('a clean run is ok and not retryable', () => {
  const v = classifyIngest({ exitCode: 0, stdout: CLEAN, dnsOk: true });
  assert.equal(v.kind, 'ok');
  assert.equal(v.retryable, false);
});

test('exit 0 wins even when some sources were unreachable', () => {
  const v = classifyIngest({ exitCode: 0, stdout: PARTIAL, dnsOk: true });
  assert.equal(v.kind, 'ok');
  assert.equal(v.retryable, false);
});

test('unparseable output refuses to guess and is not retried', () => {
  const v = classifyIngest({ exitCode: 1, stdout: 'ingest-follow.mjs rewritten, new output\n', dnsOk: false });
  assert.equal(v.kind, 'unrecognized');
  assert.equal(v.retryable, false);
  assert.match(v.summary, /diverged/);
});

test('an empty stdout (ingest died before printing) is unrecognized, not a blackout', () => {
  // The dangerous direction: no output parses as 0 attempted / 0 staged, which
  // would look exactly like a total blackout and trigger pointless retries
  // while naming the wrong cause.
  const v = classifyIngest({ exitCode: 1, stdout: '', dnsOk: false });
  assert.equal(v.kind, 'unrecognized');
  assert.equal(v.retryable, false);
});

test('the backoff is three attempts, immediate then 30s then 120s', () => {
  assert.deepEqual(RETRY_DELAYS, [0, 30, 120]);
});

/* ---------- the once-a-day gate ---------- */

const at = (h, m) => new Date(2026, 8, 8, h, m); // local, 2026-09-08

test('before the daily start time nothing runs', () => {
  const g = dayGate({ now: at(7, 29), stamp: null });
  assert.equal(g.run, false);
  assert.match(g.reason, /too early/);
});

test('first eligible fire of the day runs', () => {
  const g = dayGate({ now: at(7, 30), stamp: null });
  assert.equal(g.run, true);
  assert.match(g.reason, /attempt 1 of 3/);
});

test('a run that already succeeded today makes every later fire a no-op', () => {
  const g = dayGate({ now: at(11, 0), stamp: { date: '2026-09-08', attempts: 1, outcome: 'ok' } });
  assert.equal(g.run, false);
  assert.match(g.reason, /already completed ok today/);
});

test('a FAILED attempt does not close the day — that is the catch-up', () => {
  const g = dayGate({ now: at(11, 0), stamp: { date: '2026-09-08', attempts: 1, outcome: 'failed' } });
  assert.equal(g.run, true);
  assert.match(g.reason, /attempt 2 of 3/);
});

test('the daily attempt cap stops a bad day from burning runs all afternoon', () => {
  const g = dayGate({ now: at(15, 0), stamp: { date: '2026-09-08', attempts: 3, outcome: 'failed' } });
  assert.equal(g.run, false);
  assert.match(g.reason, /daily cap of 3 reached/);
});

test("yesterday's exhausted cap does not carry into today", () => {
  const g = dayGate({ now: at(8, 0), stamp: { date: '2026-09-07', attempts: 3, outcome: 'failed' } });
  assert.equal(g.run, true);
  assert.match(g.reason, /attempt 1 of 3/);
});

test('a run killed mid-flight still counted, so the cap is not decorative', () => {
  // outcome stays 'running' because nothing ever wrote the end. The attempt
  // must still be spent, or a crash loop retries forever.
  const g = dayGate({ now: at(9, 0), stamp: { date: '2026-09-08', attempts: 3, outcome: 'running' } });
  assert.equal(g.run, false);
  assert.match(g.reason, /daily cap of 3 reached/);
});

/* ---------- stamp arithmetic ---------- */

test('start bumps the attempt count; the outcome write does not bump again', () => {
  const now = at(7, 30);
  const started = nextStamp({ now, stamp: { date: '2026-09-08', attempts: 1, outcome: 'failed' }, outcome: 'running', bump: true });
  assert.equal(started.attempts, 2);
  const ended = nextStamp({ now, stamp: started, outcome: 'ok', bump: false });
  assert.equal(ended.attempts, 2);
  assert.equal(ended.outcome, 'ok');
});

test('a new day resets the count', () => {
  const started = nextStamp({ now: at(7, 30), stamp: { date: '2026-09-07', attempts: 3, outcome: 'failed' }, outcome: 'running', bump: true });
  assert.equal(started.date, '2026-09-08');
  assert.equal(started.attempts, 1);
});

test('localDate uses local calendar days, not UTC', () => {
  // MYT is UTC+8, so 07:40 local on the 8th is 23:40Z on the 7th. The gate is
  // about mornings on this laptop, so it must say the 8th.
  assert.equal(localDate(new Date(2026, 8, 8, 7, 40)), '2026-09-08');
});

test('shQuote survives a source name containing a quote', () => {
  assert.equal(shQuote("Ethan's Blog"), `'Ethan'\\''s Blog'`);
});

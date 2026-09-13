import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIngestOutput, classifyIngest, dayGate, nextStamp, localDate, shQuote, RETRY_DELAYS,
} from './feed-ingest-guard.mjs';

/* n result lines in ingest's exact shape. ✗ carries the platform in
 * parentheses and a reason; ✓ carries a title. */
const lines = (n, mark, platform) => Array.from({ length: n }, (_, i) => (
  mark === '✗'
    ? `  ✗ ${platform} source ${i + 1} (${platform}): fetch failed`
    : `  ✓ ${platform} source ${i + 1}: a title`
)).join('\n');

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

/* ---------- the two runs the starvation rule has to tell apart ----------
 *
 * Both are verbatim from ~/Library/Logs/lifeos-feed-ingest.log — the `·`
 * lines, the staged line and the store line are exact; the given-up NAME lists
 * are trimmed after the second name (the parser reads the count, not the
 * names) and the ✓/✗ lines are generated at the real totals.
 *
 * 2026-09-13 15:19:14. feed-daily printed "=== feed-daily done … all steps ok
 * ===" and the guard's own verdict line read "ingest verdict [ok]: 0 of 18
 * source(s) unreachable, 106 item(s) staged, 71 inserted". Eighteen sources of
 * 221 configured, and rss, github and youtube fetched from NOT ONE of theirs.
 * The daily report for that day says "2 platforms" where 09-09's says "5". */
const STARVED_0913 = `Logged in via browser: x, reddit, threads
Ingesting [rss, github, youtube, x, reddit, threads] · limit 6/source

· rss: skipping 25 given-up source(s): Simon Willison, Latent Space (swyx), ...
· github: skipping 12 given-up source(s): Patrick Collison, John Collison, ...
· youtube: skipping 20 given-up source(s): Andrej Karpathy, AI Engineer, ...
· x: skipping 134 given-up source(s): Andrej Karpathy, Shawn Wang (swyx), ...
· x: 2 source(s)
${lines(12, '✓', 'x')}
· reddit: skipping 12 given-up source(s): r/ClaudeAI, r/PromptEngineering, ...
· reddit: 14 source(s)
${lines(84, '✓', 'reddit')}
· threads: 2 source(s)
${lines(10, '✓', 'threads')}

106 item(s) staged.
71 inserted, 35 already known, 0 failed
`;

/* 2026-09-07 09:38:21, the last run in the log where every configured platform
 * actually fetched something: rss 21, github 1, youtube 4, x 50, reddit 14,
 * douyin 1, threads 2 — 93 attempted against 222 configured.
 *
 * NOT 2026-09-08, which is the trap. Both 09-08 runs read "all steps ok" and
 * both were already starving: the 21:56 one fetched from 0 of github's 12 and
 * 0 of youtube's 20 (the log has `github: skipping 12` and `youtube: skipping
 * 20` and no `N source(s)` line for either). Using it as the green baseline
 * would have pinned the requirement "keep passing a run that is already
 * lying", which is why STARVED_0908_TRAP below asserts the opposite. */
const GOOD_0907 = `Logged in via browser: x, reddit, douyin, threads
Ingesting [rss, github, youtube, x, reddit, douyin, threads] · limit 6/source

· rss: skipping 4 given-up source(s): Latent Space (swyx), New Straits Times, ...
· rss: 21 source(s)
${lines(21, '✗', 'rss')}
· github: skipping 11 given-up source(s): John Collison, William Hockey, ...
· github: 1 source(s)
${lines(1, '✓', 'github')}
· youtube: skipping 16 given-up source(s): LangChain, Stanford Online, ...
· youtube: 4 source(s)
${lines(4, '✓', 'youtube')}
· x: skipping 86 given-up source(s): xAI, Marc Lou, ...
· x: 50 source(s)
${lines(50, '✓', 'x')}
· reddit: skipping 12 given-up source(s): r/ClaudeAI, r/PromptEngineering, ...
· reddit: 14 source(s)
${lines(14, '✓', 'reddit')}
· douyin: 1 source(s)
${lines(1, '✓', 'douyin')}
· threads: 2 source(s)
${lines(2, '✓', 'threads')}

262 item(s) staged.
123 inserted, 139 already known, 0 failed
`;

/* The 2026-09-08 21:56 run, the one that must NOT be used as "a normal green
 * day". Same shape as the log: github and youtube have only a skipping line. */
const STARVED_0908_TRAP = `Ingesting [rss, github, youtube, x, instagram, reddit, douyin, threads] · limit 6/source

· rss: skipping 22 given-up source(s): Latent Space (swyx), Hamel Husain, ...
· rss: 3 source(s)
· github: skipping 12 given-up source(s): Patrick Collison, John Collison, ...
· youtube: skipping 20 given-up source(s): Andrej Karpathy, AI Engineer, ...
· x: skipping 96 given-up source(s): Andrej Karpathy, Cameron Wolfe, ...
· x: 40 source(s)
· instagram: skipping 1 given-up source(s): Google DeepMind
· instagram: 5 source(s)
· reddit: skipping 12 given-up source(s): r/ClaudeAI, r/PromptEngineering, ...
· reddit: 14 source(s)
· douyin: 1 source(s)
· threads: 2 source(s)
${lines(358, '✓', 'rss')}

358 item(s) staged.
108 inserted, 250 already known, 0 failed
`;

/* The user turned youtube off in the config: no `skipping` line and no
 * `N source(s)` line, because ingest never looked at the platform at all.
 * Nothing is enabled there, so nothing is starving. */
const PLATFORM_TURNED_OFF = `Ingesting [rss, github] · limit 6/source

· rss: 3 source(s)
${lines(3, '✓', 'rss')}
· github: skipping 2 given-up source(s): John Collison, William Hockey
· github: 4 source(s)
${lines(4, '✓', 'github')}

7 item(s) staged.
7 inserted, 0 already known, 0 failed
`;

/* The end state the "enabled and not given up" denominator cannot see: every
 * source on the only live platform has been retired, so the run tries nothing,
 * fails at nothing, and exits 0. 0 of 0 is a pass under any ratio rule. */
const EVERY_SOURCE_RETIRED = `Ingesting [rss] · limit 6/source

· rss: skipping 25 given-up source(s): Simon Willison, Latent Space (swyx), ...

0 item(s) staged.
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

/* ---------- the denominator, and the green that gets easier as the pipeline dies ---------- */

test('attempted and skipped-given-up are counted separately, and the denominator is their sum', () => {
  const c = parseIngestOutput(STARVED_0913);
  assert.equal(c.attempted, 18);          // x 2 + reddit 14 + threads 2
  assert.equal(c.skippedGivenUp, 203);    // 25 + 12 + 20 + 134 + 12
  assert.equal(c.enabled, 221);           // what the config actually asks for
  assert.deepEqual(
    c.platforms.map((p) => `${p.platform} ${p.attempted}/${p.enabled}`),
    ['rss 0/25', 'github 0/12', 'youtube 0/20', 'x 2/136', 'reddit 14/26', 'threads 2/2'],
  );
});

test('the 2026-09-13 run that reported "all steps ok" is starved, and exit 0 does not excuse it', () => {
  // THE REGRESSION THIS FILE EXISTS FOR. ingest exited 0 — truthfully, the 18
  // sources it chose to try all answered — and the verdict was a perfect green
  // while rss, github and youtube fetched from none of their 57 sources.
  const v = classifyIngest({ exitCode: 0, stdout: STARVED_0913, dnsOk: true });
  assert.equal(v.kind, 'starved');
  assert.equal(v.retryable, false, 'no wait fixes this; a human has to revive the sources');
  assert.match(v.summary, /3 platform\(s\) fetched from NONE of their configured sources/);
  assert.match(v.summary, /rss 0\/25, github 0\/12, youtube 0\/20/);
});

test('the verdict prints attempted AND skipped-given-up, because one number cannot tell 18/24 from 18/221', () => {
  const v = classifyIngest({ exitCode: 0, stdout: STARVED_0913, dnsOk: true });
  assert.match(v.summary, /18 source\(s\) attempted, 203 skipped as given-up \(221 enabled in config\)/);
  // The old sentence, which reads the same on a healthy day and a dead one.
  assert.doesNotMatch(v.summary, /^0 of 18 source\(s\) unreachable/);
});

test('a genuinely good day — 2026-09-07 — is still ok, and still says how big it was', () => {
  const v = classifyIngest({ exitCode: 0, stdout: GOOD_0907, dnsOk: true });
  assert.equal(v.kind, 'ok');
  assert.equal(v.retryable, false);
  assert.match(v.summary, /93 source\(s\) attempted, 129 skipped as given-up \(222 enabled in config\)/);
});

test('2026-09-08 is NOT the green baseline — it was already starving behind an "all steps ok"', () => {
  // Pinned as a fixture on purpose. It is the obvious "last known good run" to
  // reach for, and adopting it as the passing case would have written
  // "keep letting this through" into the spec.
  const v = classifyIngest({ exitCode: 0, stdout: STARVED_0908_TRAP, dnsOk: true });
  assert.equal(v.kind, 'starved');
  assert.match(v.summary, /github 0\/12, youtube 0\/20/);
});

test('a platform the user turned off is not starvation — nothing is enabled there', () => {
  // The reverse direction. Turning youtube off must not red the run forever,
  // or the rule gets disabled and takes the real detection with it.
  const v = classifyIngest({ exitCode: 0, stdout: PLATFORM_TURNED_OFF, dnsOk: true });
  assert.equal(v.kind, 'ok');
  assert.equal(parseIngestOutput(PLATFORM_TURNED_OFF).platforms.some((p) => p.platform === 'youtube'), false);
});

test('every source retired is starved, not the 0-of-0 pass that "enabled and not given up" would give', () => {
  const c = parseIngestOutput(EVERY_SOURCE_RETIRED);
  assert.equal(c.attempted, 0);
  assert.equal(c.enabled, 25, 'the config still asks for 25; giving up on them did not un-configure them');
  const v = classifyIngest({ exitCode: 0, stdout: EVERY_SOURCE_RETIRED, dnsOk: true });
  assert.equal(v.kind, 'starved');
  assert.match(v.summary, /rss 0\/25/);
});

test('a retryable blackout still outranks starvation — the retry that fixes a DarkWake must survive', () => {
  // BLACKOUT has `youtube: skipping 20` and no youtube source line, so it is
  // starved as well. Classifying it `starved` would make it non-retryable and
  // delete the recovery this module was built for.
  const v = classifyIngest({ exitCode: 1, stdout: BLACKOUT, dnsOk: false });
  assert.equal(v.kind, 'host-network');
  assert.equal(v.retryable, true);
  assert.match(v.summary, /24 source\(s\) attempted, 35 skipped as given-up \(59 enabled in config\)/);
});

test('exit 0 with output the parser cannot read is unrecognized, never ok', () => {
  // Otherwise a format change disables the starvation check silently: no lines
  // parsed means nothing enabled means nothing starved means green.
  const v = classifyIngest({ exitCode: 0, stdout: 'ingest-follow.mjs rewritten, new output\n', dnsOk: true });
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

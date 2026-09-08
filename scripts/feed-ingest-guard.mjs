#!/usr/bin/env node
/* Decision logic for scripts/feed-daily.sh. Pure functions + a thin CLI, so
 * the parts that decide "retry or not" and "whose fault was it" are testable
 * without a network, a Desk, or a laptop that sleeps.
 *
 * Why this file exists at all: the ingest step's own verdict lives in
 * ~/second-brain/scripts/ingest-follow.mjs (ingestVerdict), and that repo is
 * not ours to edit. Its ledger row says
 *
 *     22 source(s) unreachable, 0/0 item(s) failed to store (0 inserted)
 *       — not one source returned anything
 *
 * which is true but has no denominator: it reads identically whether 22 of 22
 * sources failed or 22 of 438 did. Those are opposite diagnoses. The first is
 * this machine's network; the second is the sources. This module supplies the
 * denominator by reading ingest's stdout, and feed-daily.sh writes the verdict
 * into the whole-job ledger row that it *does* own.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { lookup } from 'node:dns/promises';

/* Backoff for a whole-run retry. 0 = try immediately, then 30s, then 120s.
 * Three attempts spanning ~2.5 minutes covers the failure this exists for: a
 * launchd job fired inside a 2-second DarkWake window on battery, where the
 * SASE tunnel (and therefore DNS) has not come up yet. It deliberately does
 * NOT cover a network that is down for an hour — that is a day the job should
 * fail and say so, not a day it should sit spinning. */
export const RETRY_DELAYS = [0, 30, 120];

/* ---------- reading ingest's stdout ----------
 *
 * Measured against the real 2026-09-08 run in ~/Library/Logs/lifeos-feed-ingest.log:
 *
 *   · rss: skipping 4 given-up source(s): Latent Space (swyx), New Straits Times, ...
 *   · rss: 21 source(s)
 *     ✗ Simon Willison (rss): fetch failed
 *     ✓ Some Source: a title
 *   0 item(s) staged.
 *   257 inserted, 12 already known, 2 failed
 *
 * `recognized` is the contract assertion, and it is the load-bearing half.
 * This parser and the code that produces the text live in two different repos
 * and cannot be changed in one commit, so the parser must be able to say "I no
 * longer understand this" instead of quietly returning zeros — zeros here look
 * exactly like a total blackout, which would turn a format change into a
 * permanent false "the network is down".
 */
export function parseIngestOutput(stdout) {
  const lines = String(stdout || '').split('\n');
  let attempted = 0;
  let staged = null;
  let inserted = 0;
  let storeFailed = 0;
  const unreachableSources = [];
  const reachableSources = new Set();

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // "· rss: 21 source(s)" — the per-platform denominator.
    //
    // The sibling line "· rss: skipping 4 given-up source(s): <names>" must
    // NOT count: those sources were never attempted, and counting them
    // inflates the denominator, turning a total blackout into something that
    // reads as partial — precisely the misread this module exists to prevent.
    // Two independent things exclude it: the count has to sit immediately
    // after the platform's colon (there it is preceded by "skipping"), and the
    // line has to END at "source(s)" (there it ends with the names). Measured,
    // not assumed: dropping either one alone still excludes the real line, so
    // the first test in feed-ingest-guard.test.js pins the number 24 rather
    // than the pattern.
    const attemptedM = line.match(/^· .+?: (\d+) source\(s\)$/);
    if (attemptedM) { attempted += Number(attemptedM[1]); continue; }

    const failM = line.match(/^ {2}✗ (.+?) \((.+?)\): (.*)$/);
    if (failM) { unreachableSources.push({ name: failM[1], platform: failM[2], reason: failM[3] }); continue; }

    const okM = line.match(/^ {2}✓ (.+?): /);
    if (okM) { reachableSources.add(okM[1]); continue; }

    const stagedM = line.match(/^(\d+) item\(s\) staged\.$/);
    if (stagedM) { staged = Number(stagedM[1]); continue; }

    const storeM = line.match(/^(\d+) inserted, (\d+) already known, (\d+) failed/);
    if (storeM) { inserted = Number(storeM[1]); storeFailed = Number(storeM[3]); continue; }
  }

  return {
    recognized: staged !== null,
    attempted,
    staged: staged ?? 0,
    inserted,
    storeFailed,
    unreachable: unreachableSources.length,
    reachable: reachableSources.size,
    unreachableSources,
  };
}

/* ---------- the verdict ----------
 *
 * PURE. Four outcomes, and the whole point is that the middle two are not the
 * same event:
 *
 *   host-network    nothing at all got through: some sources failed and not one
 *                   returned an item. 22 sources do not go down in the same
 *                   second; this machine's DNS does. RETRYABLE.
 *   source-failures some sources failed while others returned normally. That is
 *                   the weather at those sources and retrying the whole sweep
 *                   changes nothing. NOT retryable — this is the case the old
 *                   `fetchFailures > 0` verdict got wrong for months.
 *   store-failures  items were fetched but could not be written. The network
 *                   reached the sources; the pipeline is what broke. NOT
 *                   retryable, and must not be relabelled as a network fault.
 *   unrecognized    the parser no longer understands ingest's output. Say so;
 *                   do not guess.
 *
 * `dnsOk` is corroboration, never the decision: a probe host can be blocked by
 * policy on a perfectly good network, so letting it gate anything would invent
 * a new way for a working run to be skipped. It only sharpens the sentence.
 */
export function classifyIngest({ exitCode, stdout, dnsOk = null }) {
  const c = parseIngestOutput(stdout);

  if (Number(exitCode) === 0) {
    return { kind: 'ok', retryable: false, counts: c, summary: ingestCountLine(c) };
  }

  if (!c.recognized) {
    return {
      kind: 'unrecognized',
      retryable: false,
      counts: c,
      summary: 'could not read ingest output — the "N item(s) staged." line is missing. '
        + "scripts/feed-ingest-guard.mjs's parser and second-brain's ingest-follow.mjs output have "
        + 'diverged, so this run was NOT classified. Fix the parser before trusting the next verdict.',
    };
  }

  if (c.storeFailed > 0) {
    return {
      kind: 'store-failures',
      retryable: false,
      counts: c,
      summary: `${c.storeFailed} item(s) fetched but not stored (${c.inserted} inserted) — the sources answered, `
        + 'the pipeline is what failed. Not a network fault and not retried.',
    };
  }

  const blackout = c.staged === 0 && c.unreachable > 0 && c.reachable === 0;
  if (blackout) {
    const silent = Math.max(0, c.attempted - c.unreachable);
    const probe = dnsOk === null ? 'no DNS probe'
      : dnsOk ? 'DNS probe SUCCEEDED, so the blackout may not be the network — look at the sources too'
      : 'DNS probe also failed';
    return {
      kind: 'host-network',
      retryable: true,
      counts: c,
      summary: `host network not ready — 0 of ${c.attempted} attempted source(s) returned anything `
        + `(${c.unreachable} unreachable${silent ? `, ${silent} silent` : ''}); ${probe}. `
        + `This is one machine, not ${c.unreachable} sources failing in the same second.`,
    };
  }

  return {
    kind: 'source-failures',
    retryable: false,
    counts: c,
    summary: `${c.unreachable} of ${c.attempted} source(s) unreachable; the rest answered `
      + `(${c.staged} item(s) staged, ${c.inserted} inserted). Source-side — the whole sweep is not retried.`,
  };
}

function ingestCountLine(c) {
  return `${c.unreachable} of ${c.attempted} source(s) unreachable, ${c.staged} item(s) staged, ${c.inserted} inserted`;
}

/* ---------- the once-a-day gate ----------
 *
 * StartInterval fires this script every half hour so a laptop that was asleep
 * at 07:30 still gets its feed when it wakes. That only makes sense if a second
 * run on the same day is a no-op, because auto-summarize and daily-report both
 * shell out to the `claude` CLI and a run is not free.
 *
 * PURE. Three ways to say no, and each one is a different sentence:
 *   • too early    — before the daily start time, do nothing at all;
 *   • done         — a run already succeeded today;
 *   • capped       — today's attempts are used up. Without this a day whose
 *                    network never comes back would burn 33 LLM-spending runs
 *                    between 07:30 and midnight.
 * A FAILED attempt does not mark the day done: that is the catch-up this whole
 * change exists for.
 */
export function dayGate({ now, stamp, startMinutes = 7 * 60 + 30, maxAttempts = 3 }) {
  const today = localDate(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const sameDay = stamp && stamp.date === today;
  const attempts = sameDay ? Number(stamp.attempts || 0) : 0;

  if (minutes < startMinutes) {
    return { run: false, reason: `too early — daily start is ${fmtMinutes(startMinutes)} local`, date: today, attempts };
  }
  if (sameDay && stamp.outcome === 'ok') {
    return { run: false, reason: `already completed ok today (${today})`, date: today, attempts };
  }
  if (attempts >= maxAttempts) {
    return {
      run: false,
      reason: `${attempts} attempt(s) already made today and all failed — daily cap of ${maxAttempts} reached, `
        + 'not spending another run. The last failure is in the ledger.',
      date: today,
      attempts,
    };
  }
  return { run: true, reason: `attempt ${attempts + 1} of ${maxAttempts} for ${today}`, date: today, attempts };
}

/* `bump` is what makes the daily cap countable rather than wishful. The attempt
 * is recorded BEFORE the steps run, not after: a run killed mid-flight (the
 * laptop closing, a kill -9) would otherwise never increment anything, and the
 * cap it was supposed to be counted against would never be reached. The end of
 * the run then rewrites the outcome without bumping again. */
export function nextStamp({ now, stamp, outcome, bump = false }) {
  const today = localDate(now);
  const sameDay = stamp && stamp.date === today;
  const prior = sameDay ? Number(stamp.attempts || 0) : 0;
  return { date: today, attempts: bump ? prior + 1 : Math.max(prior, 1), outcome, at: now.toISOString() };
}

export function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtMinutes(m) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}

/* Shell-safe single-quoted value, so a source name with a quote in it cannot
 * break out of the KEY='...' block that feed-daily.sh evals. */
export function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function readStamp(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeStamp(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/* ---------- CLI ---------- */
if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === 'classify') {
    const [exitCode, stdoutFile, dnsFlag] = rest;
    let stdout = '';
    try { stdout = readFileSync(stdoutFile, 'utf8'); } catch { stdout = ''; }
    const dnsOk = dnsFlag === undefined || dnsFlag === '' ? null : dnsFlag === '1';
    const v = classifyIngest({ exitCode: Number(exitCode), stdout, dnsOk });
    // KEY='value' lines, eval'd by the caller.
    process.stdout.write(`KIND=${shQuote(v.kind)}\n`);
    process.stdout.write(`RETRYABLE=${shQuote(v.retryable ? '1' : '0')}\n`);
    process.stdout.write(`VERDICT=${shQuote(v.summary)}\n`);
  } else if (cmd === 'gate') {
    // start is "HH:MM" local; both come from feed-daily.sh so the schedule is
    // configured in one place next to the plist it has to agree with.
    const [stampFile, start, max] = rest;
    const [h, m] = String(start || '07:30').split(':').map(Number);
    const g = dayGate({
      now: new Date(),
      stamp: readStamp(stampFile),
      startMinutes: (h || 0) * 60 + (m || 0),
      maxAttempts: Number(max) || 3,
    });
    console.log(g.reason);
    process.exit(g.run ? 0 : 10);
  } else if (cmd === 'record') {
    // `record <file> start` claims the attempt; `record <file> ok|failed` closes it.
    const [stampFile, outcome] = rest;
    const bump = outcome === 'start';
    writeStamp(stampFile, nextStamp({
      now: new Date(),
      stamp: readStamp(stampFile),
      outcome: bump ? 'running' : outcome,
      bump,
    }));
  } else if (cmd === 'net-probe') {
    // Same resolver stack the ingest's own fetch() uses, so a pass here really
    // does mean names were resolvable for the process that mattered.
    const host = rest[0] || 'one.one.one.one';
    try { await lookup(host); process.exit(0); } catch { process.exit(1); }
  } else {
    console.error('usage: feed-ingest-guard.mjs classify <exitCode> <stdoutFile> [0|1] | gate <stampFile> [HH:MM] [maxAttempts] | record <stampFile> <start|ok|failed> | net-probe [host]');
    process.exit(2);
  }
}

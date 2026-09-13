#!/bin/sh
# Morning feed pipeline: ingest everything you're logged into, auto-summarize
# what's new (capped, non-noise), then write the cited daily attention
# report. Driven by the com.wengyong.lifeos-feed-ingest LaunchAgent. Logs go
# to ~/Library/Logs/lifeos-feed-ingest.log (via the plist).
#
# auto-summarize runs BEFORE the report: without it the report was
# synthesizing from bare titles (summarization used to be a manual UI button
# only, so almost nothing recent had a summary by the time the report ran).
#
# `set -e` is deliberately NOT used, and neither is the `|| echo "step failed
# (continuing)"` suffix it replaced. Both halves matter:
#   • a failed step must NOT cancel the later ones — a broken ingest should
#     still get a report out of what is already stored;
#   • but the failure must survive to the exit code. The old `|| echo` form
#     gave launchd exit 0 on every run while the report was actually failing on
#     9 of the last 15, so nothing anywhere could tell a good night from a bad
#     one. FAILED remembers; the exit at the bottom tells.

# ---------------------------------------------------------------------------
# 1. Stay awake.
#
# 2026-09-08 07:40:03 this job started. `pmset -g log` for the same second:
#   DarkWake from Deep Idle [CDNP] : due to ... rtc/Maintenance Using BATT
#   com.apple.sleepservices.sessionStarted: window begins with cap time=180 secs
#   com.apple.sleepservices.sessionTerminated (07:40:05)
# launchd fired the job inside a two-second maintenance DarkWake on battery.
# Every one of the 22 network-bound sources came back `fetch failed`, because
# the SASE network extension had not brought the tunnel up and nothing resolved.
#
# `-i` (prevent idle sleep) is the flag that works on battery. `-s` is
# documented "valid only when system is running on AC power" — which is why the
# com.aichatops.caffeinate LaunchAgent, which passes `-s`, has been a no-op on
# every unplugged night. `-m` keeps the disk from idle-sleeping under it.
#
# The env var is the recursion stop: caffeinate re-executes this same file.
if [ -z "${FEED_DAILY_CAFFEINATED:-}" ]; then
  export FEED_DAILY_CAFFEINATED=1
  exec /usr/bin/caffeinate -i -m "$0" "$@"
fi

# ---------------------------------------------------------------------------
# 2. Wiring. Every one of these has its production value as the default; the
# overrides exist so scripts/feed-daily.test.js can drive the retry loop with
# a fake ingest instead of a real network. Nothing here reads a credential.
REPO="${FEED_DAILY_REPO:-/Users/wengyong/life-os}"
NODE="${FEED_DAILY_NODE:-/usr/local/bin/node}"
SB="${FEED_DAILY_SB:-$HOME/second-brain}"
JOB_RUNS="${FEED_DAILY_JOB_RUNS:-$SB/backoffice/job-runs.js}"
GUARD="${FEED_DAILY_GUARD:-$REPO/scripts/feed-ingest-guard.mjs}"
STATE_DIR="${FEED_DAILY_STATE_DIR:-$HOME/Library/Application Support/lifeos-feed-daily}"
# Whole-run backoff, in seconds, for a host-network blackout only. See
# RETRY_DELAYS in feed-ingest-guard.mjs.
RETRY_DELAYS="${FEED_DAILY_RETRY_DELAYS:-0 30 120}"
# What the DNS probe resolves. `localhost` / a `.invalid` name make the probe
# deterministic offline, which is how the tests drive both branches.
PROBE_HOST="${FEED_DAILY_PROBE_HOST:-one.one.one.one}"
# The daily schedule, kept here rather than in the plist: the plist only says
# how often to CHECK (StartInterval); this says which check counts as today's.
DAILY_START="${FEED_DAILY_START:-07:30}"
DAILY_MAX_ATTEMPTS="${FEED_DAILY_MAX_ATTEMPTS:-3}"

cd "$REPO" || { echo "FATAL: $REPO missing"; exit 1; }
mkdir -p "$STATE_DIR" || { echo "FATAL: cannot create $STATE_DIR"; exit 1; }
STAMP="$STATE_DIR/last-run.json"
LOCK="$STATE_DIR/run.lock"
INGEST_OUT="$STATE_DIR/last-ingest.out"

# ---------------------------------------------------------------------------
# 3. The once-a-day gate. The LaunchAgent is on StartInterval now, not
# StartCalendarInterval: a single 07:30 trigger on a laptop that sleeps means
# one missed morning costs 24 hours. Firing every half hour and no-op'ing is
# how the job catches up on its own. The gate is what keeps that from being
# four LLM-spending runs a day — see dayGate() for the three ways it says no.
GATE_REASON=$("$NODE" "$GUARD" gate "$STAMP" "$DAILY_START" "$DAILY_MAX_ATTEMPTS")
GATE_CODE=$?
if [ "$GATE_CODE" -eq 10 ]; then
  # Silent on purpose: this fires ~40x a day and must not bury the real runs.
  exit 0
elif [ "$GATE_CODE" -ne 0 ]; then
  echo "=== feed-daily $(date) ==="
  echo "FATAL: the daily gate itself failed (exit $GATE_CODE) — refusing to run blind"
  exit "$GATE_CODE"
fi

# ---------------------------------------------------------------------------
# 4. One at a time. A full run has taken as long as 11 hours (2026-09-05
# 07:38 → 19:00), so at a 30-minute interval overlap is the default, not the
# exception — and two concurrent runs would double the `claude` spend and let
# each one's startRun reap the other's ledger row.
#
# A stale lock must never disable the job permanently: that is the exact shape
# of every silent failure in this repo's history. If the recorded pid is gone,
# take the lock over and say so.
if ! mkdir "$LOCK" 2>/dev/null; then
  HOLDER=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$HOLDER" ] && kill -0 "$HOLDER" 2>/dev/null; then
    exit 0
  fi
  echo "=== feed-daily $(date) ==="
  echo "stale lock (pid '${HOLDER:-unknown}' is not running) — taking it over"
  rm -rf "$LOCK"
  mkdir "$LOCK" || { echo "FATAL: cannot take $LOCK"; exit 1; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM HUP

echo "=== feed-daily $(date) ==="
echo "gate: $GATE_REASON"
# Claim the attempt before doing any work — a run killed mid-flight must still
# count against the daily cap, or the cap is decorative.
"$NODE" "$GUARD" record "$STAMP" start || echo "WARNING: could not record the attempt — the daily cap is not counting"

# Whole-job ledger row (the per-step rows are written by the .mjs steps
# themselves — they are the only place the real counts exist).
#
# The ledger is not allowed to take the pipeline down: if it cannot open the
# db, RUN_ID stays empty, the finish calls are skipped, and healthLine() goes
# stale-red on its own because no fresh row appeared. Exit code and freshness
# are two independent books, and only agreement reads as healthy.
RUN_ID=$("$NODE" "$JOB_RUNS" start feed-daily) || RUN_ID=""
[ -n "$RUN_ID" ] || echo "WARNING: job-runs ledger unavailable — this run will not be recorded"

FAILED=""
run_step() {
  name=$1
  shift
  "$@"
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "!! step $name FAILED (exit $code) — continuing with the remaining steps"
    FAILED="$FAILED $name"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# 5. Ingest, with a retry that only fires for the one failure a retry can fix.
#
# The distinction is the whole point. ingest-follow.mjs's own ledger row reads
#   "22 source(s) unreachable, 0/0 item(s) failed to store (0 inserted)"
# with no denominator, so 22-of-22 and 22-of-438 are the same sentence. They
# are opposite diagnoses: nothing-got-through is this machine's DNS, and 22
# sources do not fail in the same second; some-got-through is those sources'
# own weather and retrying the sweep changes nothing about it. feed-ingest-
# guard.mjs reads the denominator off ingest's stdout and only `host-network`
# comes back retryable.
INGEST_KIND=""
INGEST_VERDICT=""
INGEST_ATTEMPTS=0
for delay in $RETRY_DELAYS; do
  if [ "$delay" -gt 0 ]; then
    echo "-- host network was not ready; waiting ${delay}s before ingest attempt $((INGEST_ATTEMPTS + 1))"
    sleep "$delay"
  fi
  INGEST_ATTEMPTS=$((INGEST_ATTEMPTS + 1))

  # Corroboration, never a gate: a probe host can be blocked by policy on a
  # perfectly good network, and letting it decide whether to run would invent a
  # brand-new way for a working morning to be skipped. It only sharpens the
  # sentence in the ledger.
  DNS_OK=1
  "$NODE" "$GUARD" net-probe "$PROBE_HOST" >/dev/null 2>&1 || DNS_OK=0

  # The instant this attempt began, in exactly the format job-runs.js writes
  # into ingest_failures.last_attempt (Date#toISOString), so the two compare as
  # strings. `.000Z` rather than `Z`: "…:07Z" sorts AFTER "…:07.412Z" because
  # 'Z' > '.', which would drop every row written in this very second — the
  # rows this window exists to catch.
  ATTEMPT_SINCE="$(date -u +%Y-%m-%dT%H:%M:%S).000Z"

  # NEVER pipe this into tee: a pipeline reports the LAST command's status, and
  # ingest's exit code is half of the verdict. File, then cat.
  "$NODE" "$SB/scripts/ingest-follow.mjs" all > "$INGEST_OUT" 2>&1
  INGEST_CODE=$?
  cat "$INGEST_OUT"

  KIND=""
  RETRYABLE=0
  VERDICT=""
  CLASSIFY=$("$NODE" "$GUARD" classify "$INGEST_CODE" "$INGEST_OUT" "$DNS_OK") || CLASSIFY=""
  if [ -n "$CLASSIFY" ]; then eval "$CLASSIFY"; fi
  if [ -z "$KIND" ]; then
    # The classifier is not allowed to fail quietly into "looks fine".
    KIND="classifier-failed"
    RETRYABLE=0
    VERDICT="feed-ingest-guard.mjs could not classify this run (ingest exited $INGEST_CODE); diagnose by hand"
  fi

  INGEST_KIND="$KIND"
  INGEST_VERDICT="$VERDICT"
  echo "ingest verdict [$KIND]: $VERDICT"

  # A blackout round taught us NOTHING about any individual source, so it must
  # not count against any of them. ingest-follow.mjs has already bumped
  # ingest_failures.attempts for every source it tried — it cannot know the
  # cause was this machine, because the verdict that establishes it is computed
  # here, afterwards. So the refund happens here, scoped to the rows this
  # attempt touched. Without it, five DarkWake mornings retire every source in
  # the config: 204 of them are already retired, and the 2026-09-11 window
  # alone accounts for 38 of those. See rollbackIngestFailuresSince().
  if [ "$KIND" = "host-network" ]; then
    "$NODE" "$JOB_RUNS" rollback-ingest-failures "$ATTEMPT_SINCE" \
      || echo "WARNING: could not refund this blackout's source failures — they still count toward give-up"
  fi

  [ "$RETRYABLE" = "1" ] || break
done

if [ "$INGEST_CODE" -ne 0 ]; then
  echo "!! step ingest FAILED (exit $INGEST_CODE after $INGEST_ATTEMPTS attempt(s)) — continuing with the remaining steps"
  FAILED="$FAILED ingest"
elif [ "$INGEST_KIND" != "ok" ]; then
  # ingest's own exit code only reports on the sources it CHOSE to try, and it
  # chooses fewer of them every time one is given up on — so it goes to zero
  # exactly as the pipeline starves. On 2026-09-13 it exited 0 having fetched
  # nothing whatsoever from rss, github and youtube, and this script printed
  # "all steps ok". The guard's verdict is the second book: any kind other than
  # `ok` fails the run even when ingest was happy. See classifyIngest().
  echo "!! step ingest FAILED (exit 0, but the guard's verdict is [$INGEST_KIND]) — continuing with the remaining steps"
  FAILED="$FAILED ingest"
fi

run_step auto-summarize "$NODE" "$SB/scripts/auto-summarize.mjs"
run_step daily-report   "$NODE" "$SB/scripts/daily-report.mjs"

# Cross-job health. Deliberately does NOT gate this script's exit code: it
# reports on backup-db and obsidian-brief too, and feed-daily must not go red
# for someone else's dead job.
#
# What changed 2026-08-17: the verdict used to go to stdout and nowhere else,
# and this line discarded its exit code, so "the line itself is the signal"
# meant the signal lived only in a log file. That is exactly how the backup sat
# dead for eleven days behind an exit code of 0. `job-runs.js health` now sends
# an alert when it goes red, so `|| true` here only keeps someone else's dead
# job from failing THIS script — it no longer swallows the warning.
"$NODE" "$JOB_RUNS" health || true

if [ -n "$FAILED" ]; then
  SUMMARY="failed step(s):$FAILED"
  case "$INGEST_KIND" in
    ok|"") : ;;
    *) SUMMARY="$SUMMARY | ingest [$INGEST_KIND] after $INGEST_ATTEMPTS attempt(s): $INGEST_VERDICT" ;;
  esac
  echo "=== feed-daily done $(date) — $SUMMARY ==="
  [ -n "$RUN_ID" ] && "$NODE" "$JOB_RUNS" finish "$RUN_ID" failed "{\"failed_steps\":\"$FAILED\",\"ingest_kind\":\"$INGEST_KIND\",\"ingest_attempts\":$INGEST_ATTEMPTS}" "$SUMMARY"
  "$NODE" "$GUARD" record "$STAMP" failed || echo "WARNING: could not record the outcome"
  exit 1
fi

[ -n "$RUN_ID" ] && "$NODE" "$JOB_RUNS" finish "$RUN_ID" ok "{\"failed_steps\":[],\"ingest_kind\":\"$INGEST_KIND\",\"ingest_attempts\":$INGEST_ATTEMPTS}"
"$NODE" "$GUARD" record "$STAMP" ok || echo "WARNING: could not record the outcome"
echo "=== feed-daily done $(date) — all steps ok ==="

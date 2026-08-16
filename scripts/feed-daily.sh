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
cd /Users/wengyong/life-os
NODE=/usr/local/bin/node
JOB_RUNS="$HOME/second-brain/backoffice/job-runs.js"

echo "=== feed-daily $(date) ==="

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

run_step ingest         "$NODE" "$HOME/second-brain/scripts/ingest-follow.mjs" all
run_step auto-summarize "$NODE" "$HOME/second-brain/scripts/auto-summarize.mjs"
run_step daily-report   "$NODE" "$HOME/second-brain/scripts/daily-report.mjs"

# Cross-job health, printed for the log. Deliberately does NOT gate this script's
# exit code: it reports on backup-db and obsidian-brief too, and feed-daily must
# not go red for someone else's dead job — the line itself is the signal.
"$NODE" "$JOB_RUNS" health || true

if [ -n "$FAILED" ]; then
  SUMMARY="failed step(s):$FAILED"
  echo "=== feed-daily done $(date) — $SUMMARY ==="
  [ -n "$RUN_ID" ] && "$NODE" "$JOB_RUNS" finish "$RUN_ID" failed "{\"failed_steps\":\"$FAILED\"}" "$SUMMARY"
  exit 1
fi

[ -n "$RUN_ID" ] && "$NODE" "$JOB_RUNS" finish "$RUN_ID" ok '{"failed_steps":[]}'
echo "=== feed-daily done $(date) — all steps ok ==="

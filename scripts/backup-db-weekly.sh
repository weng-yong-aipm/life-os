#!/bin/sh
# Weekly backup of the life-os Supabase database + storage buckets to Drive.
# Driven by the com.wengyong.lifeos-db-backup LaunchAgent. Logs go to
# ~/Library/Logs/lifeos-db-backup.log (via the plist).
#
# `set -e` is deliberately NOT used: a failed rclone sync must not prevent the
# log from recording what actually happened, and a partial backup-db.mjs
# failure (one bad table) should still get the good tables off the machine.
# But "keep going" is not "report success" — every step status is collected
# and the script exits non-zero if any of them failed. The only run this job ever
# performed (2026-08-05) ended with "rclone: command not found", a printed
# warning, and exit code 0, so launchd recorded a clean weekly backup that had
# never left the laptop.
#
# 2026-09-13 — WHY THE LEDGER ROW IS WRITTEN HERE AND NOT IN backup-db.mjs.
# That script opens a job_runs row, writes the local snapshot, and calls
# finishRun BEFORE this script has even looked for rclone. So the ledger's
# verdict for `backup-db` has always been a verdict on a directory on this
# laptop, and the one question a backup exists to answer — did a complete copy
# leave the machine? — had no row at all: `SELECT DISTINCT job, step` returned
# exactly one pair for this job, (backup-db, NULL), across all 21 runs. The
# off-site step is a step, so it gets a step row, written on BOTH outcomes.
# Writing it only on failure would leave "rclone succeeded" and "rclone never
# ran" looking identical in the ledger, which is the same blind spot moved.
REPO="${LIFEOS_BACKUP_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO" || { echo "FATAL: cannot enter the life-os checkout at $REPO"; exit 1; }
NODE="${LIFEOS_BACKUP_NODE:-/usr/local/bin/node}"
JOB_RUNS="${LIFEOS_BACKUP_JOB_RUNS:-$HOME/second-brain/backoffice/job-runs.js}"
BACKUP_ROOT="${LIFEOS_BACKUP_ROOT:-$HOME/life-os-db-backups}"
REMOTE="${LIFEOS_BACKUP_REMOTE:-gdrive:life-os-backups/db}"
export LIFEOS_BACKUP_ROOT="$BACKUP_ROOT"
DATE=$(date -u +%Y-%m-%d)

echo "=== backup-db $(date) ==="

# The wrapper row is left OPEN by backup-db.mjs (see its DEFERRED VERDICT note)
# and closed at the bottom of this script with `local AND off-site`. Before this,
# that row was decided before rclone had even been looked for, so healthLine() —
# which reads the wrapper row and nothing else, on purpose — reported this job
# green on every week the copy never left the laptop.
#
# The output is teed so a 90-minute run still logs its progress live (the
# 2026-09-12 run stalled for 57 minutes inside node, and a log that only appears
# at the end cannot say which table it stalled on) while still being parseable.
#
# `tee` is a pipeline, and a pipeline's exit status is the LAST command's — so
# `$?` here is tee's, which is 0 no matter how backup-db.mjs died. The status is
# therefore written out explicitly rather than read from `$?`. This is the same
# shape that made three scripts on this machine print OK while failing.
#
# mktemp's template must end in X's on BSD, and `$TMPDIR` is where launchd jobs
# are allowed to write.
export LIFEOS_BACKUP_DEFER_VERDICT=true
DB_TMP=$(mktemp "${TMPDIR:-/tmp}/backup-db-out-XXXXXX")
DB_ST="$DB_TMP.status"
{ "$NODE" tools/backup-db.mjs; echo "EXIT=$?" > "$DB_ST"; } 2>&1 | tee "$DB_TMP"
DB_STATUS=$(sed -n 's/^EXIT=//p' "$DB_ST" 2>/dev/null)
# An unreadable status file means the shell could not even record one. Treating
# that as success is the failure this whole block exists to stop.
[ -n "$DB_STATUS" ] || { echo "  ! backup-db.mjs left no exit status — treating as failure"; DB_STATUS=1; }

RUN_ID=$(sed -n 's/^JOB_RUN_DEFERRED id=\([0-9][0-9]*\) .*/\1/p' "$DB_TMP" | tail -1)
LOCAL_STATUS=$(sed -n 's/^JOB_RUN_DEFERRED .* local=\([a-z][a-z]*\) .*/\1/p' "$DB_TMP" | tail -1)
RUN_COUNTS=$(sed -n 's/^JOB_RUN_DEFERRED .* counts=\(.*\)$/\1/p' "$DB_TMP" | tail -1)
rm -f "$DB_TMP" "$DB_ST"
# No marker means backup-db.mjs threw before printing one — it closed the row
# itself in that path. Nothing to defer, and nothing to invent.
[ -n "$RUN_ID" ] || echo "  ! no deferred job_runs id in backup-db.mjs output — the wrapper row was closed by that script"

# Closes the wrapper row with the verdict of the WHOLE backup. Called on every
# exit path below; an early `exit` that skipped it would leave the row `running`
# and the job would read as an orphan rather than as the failure it is.
finish_run() {
  [ -n "$RUN_ID" ] && "$NODE" "$JOB_RUNS" finish "$RUN_ID" "$1" "$RUN_COUNTS" "$2"
  return 0
}

# launchd does not inherit an interactive shell's PATH, so a bare `rclone`
# resolves to nothing under the LaunchAgent — confirmed live 2026-08-05.
# Resolve an absolute path at runtime rather than hardcoding one: rclone is at
# /opt/homebrew/bin on this Apple-silicon machine, /usr/local/bin on Intel, and
# a Homebrew prefix change would otherwise silently reintroduce the same bug.
RCLONE=""
for candidate in "${LIFEOS_BACKUP_RCLONE:-}" /opt/homebrew/bin/rclone /usr/local/bin/rclone "$(command -v rclone 2>/dev/null)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then RCLONE="$candidate"; break; fi
done

# The off-site row opens here, before the first thing that can go wrong off-site,
# so a crash between here and the finish below leaves a `running` row that the
# next run reaps — rather than no row, which reads as "this step does not exist".
OFFSITE_ID=$("$NODE" "$JOB_RUNS" start backup-db offsite) || OFFSITE_ID=""
[ -n "$OFFSITE_ID" ] || echo "  ! job_runs not recorded for the offsite step — $JOB_RUNS"

finish_offsite() {
  [ -n "$OFFSITE_ID" ] && "$NODE" "$JOB_RUNS" finish "$OFFSITE_ID" "$1" "" "$2"
  return 0
}

if [ -z "$RCLONE" ]; then
  echo "FATAL: rclone not found — the off-site copy did NOT happen. Local backup is on disk only."
  finish_offsite failed "rclone not found on PATH — the off-site copy never ran"
  finish_run failed "off-site copy never ran: rclone not found on PATH"
  echo "=== backup-db done $(date) (exit 127) ==="
  exit 127
fi

# Each run writes its own dated directory (life-os-db-backups/<date>/), so a
# plain `copy` is enough — unlike second-brain's cockpit.db backup, there is
# no single mutable file here that a bad run could clobber over a good one.
"$RCLONE" copy "$BACKUP_ROOT" "$REMOTE" --checksum
SYNC_STATUS=$?

# A zero exit from `rclone copy` says rclone did not error. It does not say a
# whole snapshot is off-site: on 2026-09-12 the copy exited 0 over a directory
# that was missing three tables and all 42 media files, and 17 objects landed
# where 62 belong. So the copy is followed by a check that counts what is
# actually up there and compares checksums both ways.
VERIFY_OUT=""
VERIFY_STATUS=0
if [ "$SYNC_STATUS" -eq 0 ]; then
  VERIFY_OUT=$("$NODE" tools/backup-db.mjs --verify-offsite "$RCLONE" "$REMOTE" "$DATE" 2>&1)
  VERIFY_STATUS=$?
  echo "$VERIFY_OUT"
fi

if [ "$SYNC_STATUS" -ne 0 ]; then
  echo "FATAL: rclone copy failed (exit $SYNC_STATUS). Local backup is on disk only."
  finish_offsite failed "rclone copy exited $SYNC_STATUS"
  finish_run failed "rclone copy exited $SYNC_STATUS — nothing verified off-site"
  echo "=== backup-db done $(date) (exit $SYNC_STATUS) ==="
  exit "$SYNC_STATUS"
fi

if [ "$VERIFY_STATUS" -ne 0 ]; then
  echo "FATAL: the off-site copy is NOT a complete snapshot of $DATE."
  finish_offsite failed "$(echo "$VERIFY_OUT" | tail -n 1)"
  finish_run failed "off-site snapshot incomplete: $(echo "$VERIFY_OUT" | tail -n 1)"
  echo "=== backup-db done $(date) (exit $VERIFY_STATUS) ==="
  exit "$VERIFY_STATUS"
fi

# Empty error on the green path, on purpose: the `error` column means "why this
# failed", and putting a success sentence in it makes every reader of the ledger
# (healthLine included) parse prose to tell the two apart. The object counts are
# in VERIFY_OUT above, which is what the log is for.
finish_offsite ok ""
echo "off-site copy to $REMOTE OK"

# THE WRAPPER ROW IS ONLY GREEN WHEN BOTH HALVES ARE. A complete copy of an
# incomplete snapshot is still an incomplete backup: on 2026-09-12 rclone landed
# every byte it was given, and what it was given was missing three tables and all
# 42 media files. `local` here is backup-db.mjs's own verdict on the snapshot.
if [ "$DB_STATUS" -ne 0 ] || [ "$LOCAL_STATUS" = "failed" ]; then
  finish_run failed "the local snapshot is incomplete (backup-db.mjs exit $DB_STATUS) — it was copied off-site as-is"
  echo "=== backup-db done $(date) (backup-db.mjs exit $DB_STATUS — incomplete backup, synced anyway) ==="
  exit "$DB_STATUS"
fi

finish_run ok ""

echo "=== backup-db done $(date) ==="

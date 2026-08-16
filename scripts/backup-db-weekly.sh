#!/bin/sh
# Weekly backup of the life-os Supabase database + storage buckets to Drive.
# Driven by the com.wengyong.lifeos-db-backup LaunchAgent. Logs go to
# ~/Library/Logs/lifeos-db-backup.log (via the plist).
#
# `set -e` is deliberately NOT used: a failed rclone sync must not prevent the
# log from recording what actually happened, and a partial backup-db.mjs
# failure (one bad table) should still get the good tables off the machine.
# But "keep going" is not "report success" — both step statuses are collected
# and the script exits non-zero if either failed. The only run this job ever
# performed (2026-08-05) ended with "rclone: command not found", a printed
# warning, and exit code 0, so launchd recorded a clean weekly backup that had
# never left the laptop.
cd /Users/wengyong/life-os || { echo "FATAL: /Users/wengyong/life-os missing"; exit 1; }
NODE=/usr/local/bin/node

echo "=== backup-db $(date) ==="

"$NODE" tools/backup-db.mjs
DB_STATUS=$?

# launchd does not inherit an interactive shell's PATH, so a bare `rclone`
# resolves to nothing under the LaunchAgent — confirmed live 2026-08-05.
# Resolve an absolute path at runtime rather than hardcoding one: rclone is at
# /opt/homebrew/bin on this Apple-silicon machine, /usr/local/bin on Intel, and
# a Homebrew prefix change would otherwise silently reintroduce the same bug.
RCLONE=""
for candidate in /opt/homebrew/bin/rclone /usr/local/bin/rclone "$(command -v rclone 2>/dev/null)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then RCLONE="$candidate"; break; fi
done

if [ -z "$RCLONE" ]; then
  echo "FATAL: rclone not found — the off-site copy did NOT happen. Local backup is on disk only."
  echo "=== backup-db done $(date) (exit 127) ==="
  exit 127
fi

# Each run writes its own dated directory (life-os-db-backups/<date>/), so a
# plain `copy` is enough — unlike second-brain's cockpit.db backup, there is
# no single mutable file here that a bad run could clobber over a good one.
"$RCLONE" copy "$HOME/life-os-db-backups" gdrive:life-os-backups/db --checksum
SYNC_STATUS=$?

if [ "$SYNC_STATUS" -ne 0 ]; then
  echo "FATAL: rclone copy failed (exit $SYNC_STATUS). Local backup is on disk only."
  echo "=== backup-db done $(date) (exit $SYNC_STATUS) ==="
  exit "$SYNC_STATUS"
fi

echo "off-site copy to gdrive:life-os-backups/db OK"

if [ "$DB_STATUS" -ne 0 ]; then
  echo "=== backup-db done $(date) (backup-db.mjs exit $DB_STATUS — incomplete backup, synced anyway) ==="
  exit "$DB_STATUS"
fi

echo "=== backup-db done $(date) ==="

#!/bin/sh
# Weekly backup of the life-os Supabase database + storage buckets to Drive.
# Driven by the com.wengyong.lifeos-db-backup LaunchAgent. Logs go to
# ~/Library/Logs/lifeos-db-backup.log (via the plist).
#
# `set -e` is deliberately NOT used here: a failed rclone sync must not
# prevent the log from recording what actually happened, and a partial
# backup-db.mjs failure (one bad table) still leaves the good tables synced.
cd /Users/wengyong/life-os
NODE=/usr/local/bin/node
RCLONE=/opt/homebrew/bin/rclone
# launchd does not inherit an interactive shell's PATH, so bare `rclone`
# resolves to nothing under the LaunchAgent — confirmed live 2026-08-05
# ("rclone: command not found" in the log on the first scheduled run).

echo "=== backup-db $(date) ==="
"$NODE" tools/backup-db.mjs
STATUS=$?

# Each run writes its own dated directory (life-os-db-backups/<date>/), so a
# plain `copy` is enough — unlike second-brain's cockpit.db backup, there is
# no single mutable file here that a bad run could clobber over a good one.
"$RCLONE" copy "$HOME/life-os-db-backups" gdrive:life-os-backups/db --checksum \
  || echo "rclone sync failed (backup-db.mjs exit was $STATUS; local copy still on disk)"

echo "=== backup-db done $(date) ==="

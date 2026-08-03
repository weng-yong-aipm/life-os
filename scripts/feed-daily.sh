#!/bin/sh
# Morning feed pipeline: ingest everything you're logged into, then write the
# cited daily attention report. Driven by the com.wengyong.lifeos-feed-ingest
# LaunchAgent. Logs go to ~/Library/Logs/lifeos-feed-ingest.log (via the plist).
set -e
cd /Users/wengyong/life-os
NODE=/usr/local/bin/node

echo "=== feed-daily $(date) ==="
"$NODE" "$HOME/second-brain/scripts/ingest-follow.mjs" all || echo "ingest step failed (continuing to report)"
"$NODE" scripts/daily-report.mjs || echo "report step failed"
echo "=== feed-daily done $(date) ==="

#!/bin/sh
# Morning feed pipeline: ingest everything you're logged into, auto-summarize
# what's new (capped, non-noise), then write the cited daily attention
# report. Driven by the com.wengyong.lifeos-feed-ingest LaunchAgent. Logs go
# to ~/Library/Logs/lifeos-feed-ingest.log (via the plist).
#
# auto-summarize runs BEFORE the report: without it the report was
# synthesizing from bare titles (summarization used to be a manual UI button
# only, so almost nothing recent had a summary by the time the report ran).
set -e
cd /Users/wengyong/life-os
NODE=/usr/local/bin/node

echo "=== feed-daily $(date) ==="
"$NODE" "$HOME/second-brain/scripts/ingest-follow.mjs" all || echo "ingest step failed (continuing to report)"
"$NODE" "$HOME/second-brain/scripts/auto-summarize.mjs" || echo "auto-summarize step failed (continuing to report)"
"$NODE" "$HOME/second-brain/scripts/daily-report.mjs" || echo "report step failed"
echo "=== feed-daily done $(date) ==="

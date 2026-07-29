/* Pure Feed logic — no I/O. Dedupe, weekly digest rollup, and the NotebookLM
 * Markdown export. Mirrors the shape of learning/weekly.js and reuses its
 * ISO-week key so Feed and Learning group weeks identically. */

import { isoWeekKey } from '../learning/weekly.js';

export const STATUSES = ['new', 'applied', 'considering', 'rejected'];

/* The date a feed item "belongs" to: when it was published, else when fetched. */
export function itemDate(item) {
  const d = item.publishedAt || item.fetchedAt;
  return d ? String(d).slice(0, 10) : null;
}

/* Keep the first occurrence of each externalId (ingest is idempotent, but the
 * UI may merge multiple pulls). */
export function dedupeByExternalId(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.externalId || it.id || it.url;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(it);
  }
  return out;
}

/* Roll the items of one ISO week into a digest: totals, per-platform and
 * per-status counts, and the items grouped by platform (newest first). */
export function weeklyDigest(items, weekKey) {
  const inWeek = items.filter((it) => {
    const d = itemDate(it);
    return d && isoWeekKey(d) === weekKey;
  });
  const byPlatform = {};
  const byStatus = { new: 0, applied: 0, considering: 0, rejected: 0 };
  const groups = {};
  for (const it of inWeek) {
    const p = it.platform || 'other';
    byPlatform[p] = (byPlatform[p] || 0) + 1;
    const s = STATUSES.includes(it.status) ? it.status : 'new';
    byStatus[s] += 1;
    (groups[p] = groups[p] || []).push(it);
  }
  for (const p of Object.keys(groups)) {
    groups[p].sort((a, b) => String(itemDate(b)).localeCompare(String(itemDate(a))));
  }
  return { weekKey, total: inWeek.length, byPlatform, byStatus, groups };
}

const PLATFORM_LABEL = {
  youtube: 'YouTube', rss: 'Newsletters', bilibili: 'Bilibili',
  reddit: 'Reddit', x: 'X / Twitter', instagram: 'Instagram', douyin: '抖音',
};

/* Render a digest as one clean Markdown document — the single source you upload
 * (or sync via Google Doc) into NotebookLM. */
export function toMarkdownDigest(digest) {
  const lines = [];
  lines.push(`# AI learning digest — ${digest.weekKey}`);
  lines.push('');
  lines.push(`${digest.total} item${digest.total === 1 ? '' : 's'} · ` +
    `${digest.byStatus.applied} applied · ${digest.byStatus.considering} considering · ` +
    `${digest.byStatus.new} unreviewed`);
  lines.push('');
  const platforms = Object.keys(digest.groups).sort(
    (a, b) => (digest.byPlatform[b] || 0) - (digest.byPlatform[a] || 0));
  for (const p of platforms) {
    lines.push(`## ${PLATFORM_LABEL[p] || p}`);
    lines.push('');
    for (const it of digest.groups[p]) {
      const src = it.sourceName ? ` — *${it.sourceName}*` : '';
      const dur = it.durationSec ? ` (${Math.round(it.durationSec / 60)} min)` : '';
      lines.push(`### ${it.title}${dur}${src}`);
      if (it.summary) lines.push(it.summary);
      if (Array.isArray(it.topics) && it.topics.length) lines.push(`_Topics: ${it.topics.join(', ')}_`);
      if (it.url) lines.push(`<${it.url}>`);
      lines.push('');
    }
  }
  return lines.join('\n').trim() + '\n';
}

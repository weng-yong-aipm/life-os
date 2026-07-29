import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeByExternalId, weeklyDigest, toMarkdownDigest, itemDate } from './feed.js';

const items = [
  { externalId: 'a', platform: 'youtube', title: 'Build GPT', summary: 'from scratch', topics: ['llm'], durationSec: 3600, status: 'applied', publishedAt: '2026-07-27' },
  { externalId: 'b', platform: 'rss',     title: 'What changed', summary: 'weekly recap', status: 'new', publishedAt: '2026-07-26' },
  { externalId: 'a', platform: 'youtube', title: 'Build GPT (dup)', status: 'new', publishedAt: '2026-07-27' },
  { externalId: 'c', platform: 'youtube', title: 'Old talk', status: 'new', publishedAt: '2026-07-10' },
];

test('dedupeByExternalId keeps first occurrence', () => {
  const out = dedupeByExternalId(items);
  assert.equal(out.length, 3);
  assert.equal(out.find((x) => x.externalId === 'a').title, 'Build GPT');
});

test('itemDate falls back to fetchedAt', () => {
  assert.equal(itemDate({ publishedAt: '2026-07-27T10:00:00Z' }), '2026-07-27');
  assert.equal(itemDate({ fetchedAt: '2026-07-25T00:00:00Z' }), '2026-07-25');
  assert.equal(itemDate({}), null);
});

test('weeklyDigest groups the right week only', () => {
  const wk = '2026-W30'; // week of Jul 20–26, 2026
  const d = weeklyDigest(dedupeByExternalId(items), wk);
  // b (Jul 26) is in W30; a (Jul 27) is W31; c (Jul 10) is earlier
  assert.equal(d.total, 1);
  assert.equal(d.byPlatform.rss, 1);
  assert.equal(d.byStatus.new, 1);
});

test('weeklyDigest counts multiple platforms in a week', () => {
  const d = weeklyDigest(dedupeByExternalId(items), '2026-W31'); // Jul 27+
  assert.equal(d.total, 1);
  assert.equal(d.byPlatform.youtube, 1);
  assert.equal(d.byStatus.applied, 1);
});

test('toMarkdownDigest renders headings, duration and links', () => {
  const d = weeklyDigest(items, '2026-W31');
  const md = toMarkdownDigest(d);
  assert.match(md, /# AI learning digest — 2026-W31/);
  assert.match(md, /## YouTube/);
  assert.match(md, /### Build GPT \(60 min\)/);
  assert.match(md, /_Topics: llm_/);
  assert.doesNotMatch(md, /^<>/m); // no empty link line when url is absent
});

#!/usr/bin/env node
/* Nominate MEMORY.md index rows whose subject has gone quiet, so the hot index has a
 * CONTINUOUS outflow instead of a manual compaction every other week. READ-ONLY.
 *
 *   node tools/scan-index-rows.mjs [--days 60]
 *
 * The report is also the approval surface: delete the rows you disagree with, then run
 * tools/apply-index-archive.mjs against it.
 *
 * WHY THIS EXISTS (2026-09-23). MEMORY.md is a fixed-size container (~24,400 CHARACTERS —
 * over it the whole file reads as nothing) with a continuous inflow measured at ~590/day.
 * Every one-off compaction buys days, not months: measured that day, shortening every
 * filename to ≤18 chars would reclaim 2,683 chars = 4.5 days of growth; deleting every row
 * without a red-line marker would reclaim 4,521 = 7.7 days. Only an outflow that also runs
 * with time can hold the level.
 *
 * WHY IT NOMINATES INSTEAD OF DELETING. Emoji are not a load-bearing test. Read by hand on
 * 2026-09-23, half the rows carrying no 🔴/🛑 were still load-bearing: a scope boundary marked
 * ZERO TOLERANCE, a "these directories never merge" rule, a "stop asking, always do X" habit —
 * none of them carry a red-line marker and all three cause damage if unread. Culling by marker to hit a
 * number removes exactly the rows whose absence causes the damage the index exists to prevent.
 * So: the machine proposes on evidence it can actually measure (file age), the human disposes.
 *
 * ⚠️ DO NOT verify "this wrote nothing" with `git status` in the corpus — that directory's
 * .gitignore is `/*`, so it is empty whether or not every file was rewritten. Compare mtimes
 * or read the files. (Same trap documented in scan-memory-rot.mjs.)
 */
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CORPUS = join(homedir(), '.claude/projects/-Users-wengyong/memory');
export const INDEX = join(CORPUS, 'MEMORY.md');
export const DEFAULT_STALE_DAYS = 60;
/* A run that nominates most of the index is a broken instrument, not a finding — the corpus
 * moved, the clock is wrong, mtimes were flattened by a restore. Refuse rather than hand over
 * a report that would gut the index if approved in bulk. */
export const MAX_SHARE = 0.3;
const DAY = 86400000;

/** Rows are `- ` lines. Headings (`## …`) and prose are not rows and are never touched. */
export const isRow = (line) => line.startsWith('- ');

/** Every `(slug.md)` a row points at. A row with no links is prose-in-a-row and never nominated. */
export function linksOf(line) {
  return [...line.matchAll(/\(([\w.-]+)\.md\)/g)].map((m) => m[1]);
}

/* 🔴 Red-lined rows are never nominated, whatever their age. "Don't do X" does not expire
 * because nobody touched the file — an untouched prohibition is one nobody has had to break
 * yet, which is the prohibition working, not rotting. */
export const hasRedLine = (line) => /🔴|🛑/u.test(line);

/**
 * Decide one row. `ageOf(slug)` returns days since that entry file changed, or null if missing.
 *
 * Nominated only when EVERY linked entry is present and older than `days`. 🔴 All-or-nothing on
 * purpose: `scan-memory-rot` learned this the expensive way (30 nominations → 9 once partial
 * evidence stopped counting). An aggregate row links a dozen entries; archiving it because
 * eleven went quiet takes the twelfth — the live one — with it.
 */
export function judgeRow(line, { days, ageOf }) {
  if (!isRow(line)) return { nominate: false, reason: 'not a row' };
  if (hasRedLine(line)) return { nominate: false, reason: 'red line — never auto-nominated' };
  const links = linksOf(line);
  if (!links.length) return { nominate: false, reason: 'no links' };
  const ages = links.map((slug) => ({ slug, age: ageOf(slug) }));
  const missing = ages.filter((a) => a.age == null);
  // A broken link is a different defect (scan-memory-rot's job). Archiving on it would hide it.
  if (missing.length) return { nominate: false, reason: `entry file missing: ${missing.map((m) => m.slug).join(', ')}` };
  const fresh = ages.filter((a) => a.age < days);
  if (fresh.length) return { nominate: false, reason: `still active: ${fresh.map((f) => `${f.slug}(${f.age}d)`).join(', ')}` };
  return { nominate: true, reason: '', ages };
}

/** Guard: refuse to emit a report that would gut the index. Returns the nominations unchanged. */
export function assertPlausible(nominated, rowCount, maxShare = MAX_SHARE) {
  if (rowCount && nominated.length / rowCount > maxShare) {
    throw new Error(`scan-index-rows: ${nominated.length}/${rowCount} rows nominated (> ${Math.round(maxShare * 100)}%). `
      + 'That is an instrument fault, not a finding — mtimes flattened by a restore, a moved corpus, or a wrong clock. Refusing to report.');
  }
  return nominated;
}

export function renderReport(nominated, { days, size, limit = 24400 }) {
  const head = [
    `# 索引行归档提名 — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `MEMORY.md 现 ${size} 字符（上限 ${limit}，余量 ${limit - size}）。`,
    `下面每一行链接的**全部**条目都已经 ${days} 天没有变化。带 🔴/🛑 的行不在此列 —— 禁令不会因为没人碰而过期。`,
    '',
    '**这份报告就是审批面**：删掉你不同意归档的整段，然后 `node tools/apply-index-archive.mjs <本文件>`。',
    '被批准的行会**原文**移进 memory-archive-closed.md，条目文件一个字都不动。',
    '',
  ];
  const body = nominated.flatMap(({ line, ages }) => [
    `## ${ages.map((a) => `${a.slug}(${a.age}d)`).join(' · ')}`,
    '```',
    line,
    '```',
    '',
  ]);
  return [...head, ...(nominated.length ? body : ['（本轮没有够条件的行。）', ''])].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--days');
  const days = i > -1 ? Number(process.argv[i + 1]) : DEFAULT_STALE_DAYS;
  if (!Number.isFinite(days) || days <= 0) { console.error('--days must be a positive number'); process.exit(1); }
  if (!existsSync(INDEX)) { console.error(`scan-index-rows: ${INDEX} not found. Refusing to scan.`); process.exit(1); }

  const now = Date.now();
  const ageOf = (slug) => {
    const f = join(CORPUS, `${slug}.md`);
    return existsSync(f) ? Math.floor((now - statSync(f).mtimeMs) / DAY) : null;
  };
  const text = readFileSync(INDEX, 'utf8');
  const lines = text.split('\n');
  const rows = lines.filter(isRow);
  const nominated = [];
  for (const line of lines) {
    const v = judgeRow(line, { days, ageOf });
    if (v.nominate) nominated.push({ line, ages: v.ages });
  }
  assertPlausible(nominated, rows.length);

  const outDir = join(homedir(), 'life-os/docs/memory-reports');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `index-rows-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(out, renderReport(nominated, { days, size: [...text].length }), 'utf8');
  console.log(`scanned ${rows.length} rows · nominated ${nominated.length} (idle ≥ ${days}d) · report: ${out}`);
}

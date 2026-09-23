#!/usr/bin/env node
/* Move the index rows approved in a scan-index-rows report out of MEMORY.md and into
 * memory-archive-closed.md, VERBATIM. The only writer in this pair.
 *
 *   node tools/apply-index-archive.mjs <report.md>
 *
 * Nothing is deleted: the row's text lands in the archive, and the entry files it points at
 * are never opened. The archive already carries that promise in its own header ("一个字都没删")
 * and is linked from the bottom of MEMORY.md, so a row moved here is still one hop away.
 *
 * 🔴 Re-verification, not trust: a row is only moved if it is still in MEMORY.md **character for
 * character**. The report is edited by hand between scan and apply, and MEMORY.md is written by
 * every session in between — matching on a slug or a prefix would let a row that was rewritten
 * since the scan be archived under its old text, which silently drops whatever the rewrite added.
 *
 * ⚠️ DO NOT verify with `git status` in the corpus — .gitignore is `/*` there, so it is empty
 * whether this wrote nothing or rewrote everything. This script verifies by re-reading both files.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CORPUS = join(homedir(), '.claude/projects/-Users-wengyong/memory');
export const INDEX = join(CORPUS, 'MEMORY.md');
export const ARCHIVE = join(CORPUS, 'memory-archive-closed.md');

/** Approved rows are the fenced blocks the scanner wrote; deleting a block is how you reject it. */
export function parseApproved(markdown) {
  return [...markdown.matchAll(/```\n(- [^\n]*)\n```/g)].map((m) => m[1]);
}

/**
 * Remove `row` from the index if it is present verbatim. Returns the new text and whether it moved.
 * Refuses a row that appears more than once — two identical rows mean the index has a duplicate,
 * and picking one of them silently is how the *other* one becomes unreachable later.
 */
export function removeRow(indexText, row) {
  const lines = indexText.split('\n');
  const hits = lines.reduce((acc, l, n) => (l === row ? [...acc, n] : acc), []);
  if (!hits.length) return { text: indexText, moved: false, reason: 'row not found verbatim (rewritten since the scan?)' };
  if (hits.length > 1) return { text: indexText, moved: false, reason: `row appears ${hits.length}× — refusing to guess which one` };
  lines.splice(hits[0], 1);
  return { text: lines.join('\n'), moved: true, reason: '' };
}

/** Append moved rows under a dated heading, so the archive says when and from where. */
export function appendToArchive(archiveText, rows, today) {
  const head = `## ${today} 从热索引移出：连续 ${process.env.IDLE_LABEL || '长期'}没有变化的条目`;
  const note = '由 `tools/scan-index-rows.mjs` 提名、人工批准后移出。**一个字都没删**，每条仍指向完整的主题文件。';
  return `${archiveText.trimEnd()}\n\n${head}\n\n${note}\n\n${rows.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  if (!reportPath || !existsSync(reportPath)) { console.error('usage: node tools/apply-index-archive.mjs <report.md>'); process.exit(1); }
  for (const f of [INDEX, ARCHIVE]) {
    if (!existsSync(f)) { console.error(`apply-index-archive: ${f} not found. Refusing to write.`); process.exit(1); }
  }
  const rows = parseApproved(readFileSync(reportPath, 'utf8'));
  if (!rows.length) { console.log('report approves 0 rows — nothing to do'); process.exit(0); }

  let index = readFileSync(INDEX, 'utf8');
  const before = [...index].length;
  const moved = []; const skipped = [];
  for (const row of rows) {
    const r = removeRow(index, row);
    if (!r.moved) { skipped.push(`${row.slice(0, 48)}… — ${r.reason}`); continue; }
    index = r.text;
    moved.push(row);
  }
  if (!moved.length) {
    console.log('moved 0 rows');
    for (const s of skipped) console.log(`  skipped: ${s}`);
    process.exit(0);
  }
  writeFileSync(ARCHIVE, appendToArchive(readFileSync(ARCHIVE, 'utf8'), moved, new Date().toISOString().slice(0, 10)), 'utf8');
  writeFileSync(INDEX, index, 'utf8');

  /* Read both files back. A write that "succeeded" and a file that holds the bytes are two
   * different claims, and only the second one is the point of this script. */
  const idx2 = readFileSync(INDEX, 'utf8');
  const arc2 = readFileSync(ARCHIVE, 'utf8');
  const bad = moved.filter((row) => idx2.includes(row) || !arc2.includes(row));
  const after = [...idx2].length;
  console.log(`moved ${moved.length}/${rows.length} rows · index ${before} → ${after} 字符（-${before - after}）`);
  for (const s of skipped) console.log(`  skipped: ${s}`);
  if (bad.length) {
    console.error(`🔴 回读不一致：${bad.length} 行没有真的搬过去。索引和归档现在可能都不对，先看 ${ARCHIVE}`);
    process.exit(1);
  }
  console.log('回读通过：每一行都不在索引里、且都在归档里');
}

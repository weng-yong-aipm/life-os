#!/usr/bin/env node
/* The ONLY writer. Applies an approved rot report:
 *
 *   node tools/apply-retirement.mjs docs/reports/memory-rot-2026-08-17.md
 *
 * Never deletes a file, never removes an index line, never edits an entry body.
 * Rows the user deleted from the report are simply absent — deletion IS the
 * rejection, which is why there is no separate approve flag to get out of sync.
 *
 * Each row is RE-VERIFIED before it is applied: a reference that came back to
 * life between the scan and the apply is skipped and reported, not retired.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { withRetirement } from './memory-lifecycle.mjs';
import { classify, DEFAULT_ROOTS } from './memory-references.mjs';
import { CORPUS, buildTailIndex } from './scan-memory-rot.mjs';

/* Anchored on `- [ ] `. The report's 路径写短了 section uses plain `- ` rows for entries it
 * explicitly says are NOT rot; a looser pattern would retire exactly those. */
const ROW = /^- \[ \] (\S+) — (.+)$/gm;
const HEADING = '## 已淘汰';

/* The scan appends `[索引中]` / `[不在索引]` to nomination rows. ROW ends in `(.+)$`, so without
 * stripping that the annotation becomes a fake dead reference — and lands in the evidence written
 * into the entry, which is the one field a human reads when judging the retirement later. */
const ANNOTATION = /\s*\[[^\]]*\]\s*$/;

export function parseApproved(markdown) {
  return [...markdown.matchAll(ROW)].map((m) => ({
    name: m[1],
    dead: m[2].replace(ANNOTATION, '').split(',').map((s) => s.trim()).filter(Boolean),
  }));
}

/* MEMORY.md is a flat list of `- ` lines with no headings at all, so the first
 * retirement introduces the only heading in the file. A line can link several
 * entries — the first line of the real index links two — and moving one of
 * those would retire the others by association, so it is refused and reported. */
export function moveIndexLine(memoryMd, slug) {
  const lines = memoryMd.split('\n');
  const idx = lines.findIndex((l) => l.includes(`(${slug}.md)`));
  if (idx === -1) return { text: memoryMd, moved: false, reason: `no index line references ${slug}.md` };
  const linked = [...lines[idx].matchAll(/\(([\w.-]+)\.md\)/g)].length;
  if (linked > 1) return { text: memoryMd, moved: false, reason: `index line references ${linked} entries — refusing to move it and retire the others by association` };
  const [line] = lines.splice(idx, 1);
  const rest = lines.join('\n');
  return rest.includes(HEADING)
    ? { text: `${rest.trimEnd()}\n${line}\n`, moved: true, reason: '' }
    : { text: `${rest.trimEnd()}\n\n${HEADING}\n${line}\n`, moved: true, reason: '' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  if (!reportPath || !existsSync(reportPath)) { console.error('usage: node tools/apply-retirement.mjs <report.md>'); process.exit(1); }
  const rows = parseApproved(readFileSync(reportPath, 'utf8'));
  /* Built here, not at module scope: importing this file must not walk six repos — the test file
   * imports parseApproved/moveIndexLine and would otherwise pay for a full filesystem crawl.
   * Re-verification has to see the world the same way the scan did, tail resolution included, or
   * a row could be nominated by one and rejected by the other. */
  const tailIndex = buildTailIndex(DEFAULT_ROOTS, (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })));
  const today = new Date().toISOString().slice(0, 10);
  let applied = 0; const skipped = [];
  let index = readFileSync(join(CORPUS, 'MEMORY.md'), 'utf8');
  for (const { name, dead } of rows) {
    const file = join(CORPUS, `${name}.md`);
    if (!existsSync(file)) { skipped.push(`${name}: entry file not found`); continue; }
    const alive = dead.filter((ref) => classify(ref, {
      roots: DEFAULT_ROOTS,
      exists: (root, r) => existsSync(join(root, r)),
      findByTail: (r) => tailIndex.get(r) ?? null,
    }).state !== 'missing');
    if (alive.length) { skipped.push(`${name}: ${alive.join(', ')} came back since the scan`); continue; }
    writeFileSync(file, withRetirement(readFileSync(file, 'utf8'), {
      at: today,
      reason: 'broken-reference',
      evidence: dead.map((ref) => `${ref} — not found in any of ${DEFAULT_ROOTS.length} repo roots (checked ${today})`),
    }), 'utf8');
    const moved = moveIndexLine(index, name);
    index = moved.text;
    if (!moved.moved) skipped.push(`${name}: retired, but index line left in place — ${moved.reason}`);
    applied += 1;
  }
  writeFileSync(join(CORPUS, 'MEMORY.md'), index, 'utf8');
  console.log(`applied ${applied}/${rows.length}`);
  for (const s of skipped) console.log(`  skipped/partial: ${s}`);
}

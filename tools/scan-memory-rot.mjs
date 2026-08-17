#!/usr/bin/env node
/* Scan the memory corpus for entries whose file references no longer exist and
 * write a nomination report. READ-ONLY: this never touches an entry file.
 *
 *   node tools/scan-memory-rot.mjs
 *
 * The report is also the approval surface — delete the rows you disagree with,
 * then run tools/apply-retirement.mjs against it.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readStatus } from './memory-lifecycle.mjs';
import { extractPaths, classify, DEFAULT_ROOTS } from './memory-references.mjs';

export const CORPUS = join(homedir(), '.claude/projects/-Users-wengyong/memory');

/* A root that cannot be found is a broken instrument, not a finding: every
 * reference under it would resolve as missing and the run would nominate
 * hundreds of entries at once. Abort rather than report. */
export function assertRootsPresent(roots, isDir) {
  const gone = roots.filter((r) => !isDir(r));
  if (gone.length) throw new Error(`scan-memory-rot: repo root(s) not found — ${gone.join(', ')}. Refusing to scan: every reference under a missing root would read as dead.`);
}

/* Index every trailing-segment form of every file, so `src/api.js` can be recognised as
 * cockpit-react/src/api.js. First writer wins, so a shallower file beats a deeper one. */
export function buildTailIndex(roots, readdir) {
  const tails = new Map();
  const walk = (dir, root, depth) => {
    if (depth > 6) return;
    let ents; try { ents = readdir(dir); } catch { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const full = `${dir}/${e.name}`;
      if (e.isDirectory) { walk(full, root, depth + 1); continue; }
      const parts = full.slice(root.length + 1).split('/');
      for (let i = 0; i < parts.length; i++) {
        const tail = parts.slice(i).join('/');
        if (!tails.has(tail)) tails.set(tail, full);
      }
    }
  };
  for (const r of roots) walk(r, r, 0);
  return tails;
}

export function buildReport({ entries, roots, exists, findByTail, today }) {
  let refs = 0;
  const nominations = [];
  const tails = [];
  /* Both counts, always. 76 occurrences and 66 unique were measured on the same corpus on the
   * same day: the same dead path referenced by three entries counts three times in one and once
   * in the other. Printing only one makes two runs impossible to reconcile. */
  let deadOccurrences = 0;
  const deadUnique = new Set();
  for (const { name, src } of entries) {
    if (readStatus(src) === 'retired') continue;
    const dead = [];
    for (const ref of extractPaths(src)) {
      refs += 1;
      const c = classify(ref, { roots, exists, findByTail });
      if (c.state === 'missing') { dead.push(ref); deadOccurrences += 1; deadUnique.add(ref); }
      else if (c.state === 'tail') tails.push(`${name} — ${ref} → ${c.at}`);
    }
    if (dead.length) nominations.push({ name, dead });
  }
  const lines = [
    `# Memory rot — nominations ${today}`,
    '',
    `entries read: ${entries.length}`,
    `references resolved: ${refs}`,
    `dead references: ${deadOccurrences} occurrences · ${deadUnique.size} unique`,
    `nominations: ${nominations.length}`,
    `short paths (not rot): ${tails.length}`,
    `roots searched: ${roots.join(', ')}`,
    '',
    'Delete any row you disagree with, then run `node tools/apply-retirement.mjs <this file>`.',
    '',
    ...nominations.map(({ name, dead }) => `- [ ] ${name} — ${dead.join(', ')}`),
    '',
    '## 路径写短了（不是过时，是写法不精确）',
    '',
    ...tails.map((t) => `- ${t}`),
    '',
  ];
  return {
    markdown: lines.join('\n'),
    counts: { entries: entries.length, refs, nominations: nominations.length, tails: tails.length, deadOccurrences, deadUnique: deadUnique.size },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertRootsPresent(DEFAULT_ROOTS, (p) => existsSync(p) && statSync(p).isDirectory());
  const entries = readdirSync(CORPUS)
    .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
    .map((f) => ({ name: f.replace(/\.md$/, ''), src: readFileSync(join(CORPUS, f), 'utf8') }));
  const tailIndex = buildTailIndex(DEFAULT_ROOTS, (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })));
  const today = new Date().toISOString().slice(0, 10);
  const { markdown, counts } = buildReport({
    entries,
    roots: DEFAULT_ROOTS,
    exists: (root, ref) => existsSync(join(root, ref)),
    findByTail: (ref) => tailIndex.get(ref) ?? null,
    today,
  });
  const dir = join(homedir(), 'life-os/docs/reports');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `memory-rot-${today}.md`);
  writeFileSync(out, markdown, 'utf8');
  console.log(`${out}\nentries ${counts.entries} · refs ${counts.refs} · dead ${counts.deadOccurrences} occ / ${counts.deadUnique} uniq · nominations ${counts.nominations} · short-paths ${counts.tails}`);
}

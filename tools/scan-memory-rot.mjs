#!/usr/bin/env node
/* Scan the memory corpus for entries whose file references no longer exist and
 * write a nomination report. READ-ONLY: this never touches an entry file.
 *
 *   node tools/scan-memory-rot.mjs
 *
 * The report is also the approval surface — delete the rows you disagree with,
 * then run tools/apply-retirement.mjs against it.
 *
 * ⚠️ DO NOT verify "this wrote nothing" with `git status` in the corpus. That directory's
 * .gitignore is `/*` — it ignores everything, so no entry .md is tracked and `git status` there
 * is empty whether or not a tool rewrote all 294 files. Three runs of this scan were "verified"
 * that way before the gitignore was read; the check was vacuous. Compare file mtimes, or grep the
 * entries for the field a writer would have added.
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

/* The other direction. A retired entry whose dead references are alive again is
 * a retirement that may no longer hold — and a stale `retired` marker hides a
 * fact that has become true, which is exactly how an exemption list turns into
 * the hole it was built to close. Checked, never auto-reversed. */
export function reviveCandidates({ entries, roots, exists, findByTail }) {
  const out = [];
  for (const { name, src } of entries) {
    if (readStatus(src) !== 'retired') continue;
    const backAlive = extractPaths(src).filter((ref) => classify(ref, { roots, exists, findByTail }).state !== 'missing');
    if (backAlive.length) out.push({ name, backAlive });
  }
  return out;
}

/* Is the entry still linked from MEMORY.md? An entry that is not has already been dropped from
 * the index injected into every session — de-facto retired, with no marker saying so. Strong
 * signal, deliberately NOT automated: MEMORY.md was rewritten by another session in the minutes
 * between two runs of this scan (57 index lines → 66, one whole line removed), so acting on it
 * would let one session's edit retire another session's entry. Reported for a human to weigh. */
const indexNote = (index, name) => (index === undefined ? '' : index.includes(`(${name}.md)`) ? '  [索引中]' : '  [不在索引]');

export function buildReport({ entries, roots, exists, findByTail, today, index }) {
  let refs = 0;
  const nominations = [];
  const tails = [];
  /* Both counts, always. 76 occurrences and 66 unique were measured on the same corpus on the
   * same day: the same dead path referenced by three entries counts three times in one and once
   * in the other. Printing only one makes two runs impossible to reconcile. */
  let deadOccurrences = 0;
  const deadUnique = new Set();
  const pathFixes = [];
  for (const { name, src } of entries) {
    if (readStatus(src) === 'retired') continue;
    const dead = [];
    const seen = extractPaths(src);
    for (const ref of seen) {
      refs += 1;
      const c = classify(ref, { roots, exists, findByTail });
      if (c.state === 'missing') { dead.push(ref); deadOccurrences += 1; deadUnique.add(ref); }
      else if (c.state === 'tail') tails.push(`${name} — ${ref} → ${c.at}`);
    }
    /* THE unit of nomination. A dead reference is not a dead entry: ai-chatops-progress has 6 dead
     * refs out of 92 and ai-chatops-stale-branches 2 of 9 — the latter was rewritten the same day
     * this ran. Retiring either for a handful of stale paths deletes knowledge that is live. The
     * spec already said this tool checks whether a reference EXISTS, not whether the claim around
     * it still HOLDS; nominating the whole entry contradicted that sentence, so only an entry
     * whose references are ALL dead is proposed for retirement. The rest are stale paths to fix.
     *
     * `dead.length > 0` is load-bearing: an entry with no references at all satisfies
     * "every reference is dead" arithmetically (0 of 0), and advice-shaped entries — preferences,
     * conclusions, rules — have no anchor to check. Without this guard the tool would retire the
     * corpus by degrees, starting with the entries it understands least. */
    if (dead.length > 0 && dead.length === seen.length) nominations.push({ name, dead });
    else if (dead.length > 0) pathFixes.push({ name, dead, total: seen.length });
  }
  const revive = reviveCandidates({ entries, roots, exists, findByTail });
  const lines = [
    `# Memory rot — nominations ${today}`,
    '',
    `entries read: ${entries.length}`,
    `references resolved: ${refs}`,
    `dead references: ${deadOccurrences} occurrences · ${deadUnique.size} unique`,
    `nominations (every reference dead): ${nominations.length}`,
    `path fixes (entry still holds): ${pathFixes.length}`,
    `short paths (not rot): ${tails.length}`,
    `roots searched: ${roots.join(', ')}`,
    '',
    '## 建议淘汰（该条目的引用全部失效）',
    '',
    'Delete any row you disagree with, then run `node tools/apply-retirement.mjs <this file>`.',
    '',
    ...nominations.map(({ name, dead }) => `- [ ] ${name} — ${dead.join(', ')}${indexNote(index, name)}`),
    '',
    '## 待修路径（条目仍成立，只是路径过时）',
    '',
    'NOT retirement candidates. Fix the path in the entry, or leave it — these entries are still true.',
    '',
    ...pathFixes.map(({ name, dead, total }) => `- ${name} — ${dead.join(', ')}  (${dead.length}/${total} 引用失效)`),
    '',
    '## 路径写短了（不是过时，是写法不精确）',
    '',
    ...tails.map((t) => `- ${t}`),
    '',
    '## 待重审（已淘汰，但引用又活了）',
    '',
    'Not automatic — decide each one. A retirement that no longer holds hides a fact that has become true again.',
    '',
    ...revive.map(({ name, backAlive }) => `- ${name} — ${backAlive.join(', ')}`),
    '',
  ];
  return {
    markdown: lines.join('\n'),
    counts: { entries: entries.length, refs, nominations: nominations.length, pathFixes: pathFixes.length, tails: tails.length, deadOccurrences, deadUnique: deadUnique.size, revive: revive.length },
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
    index: readFileSync(join(CORPUS, 'MEMORY.md'), 'utf8'),
    roots: DEFAULT_ROOTS,
    exists: (root, ref) => existsSync(join(root, ref)),
    findByTail: (ref) => tailIndex.get(ref) ?? null,
    today,
  });
  const dir = join(homedir(), 'life-os/docs/reports');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `memory-rot-${today}.md`);
  writeFileSync(out, markdown, 'utf8');
  console.log(`${out}\nentries ${counts.entries} · refs ${counts.refs} · dead ${counts.deadOccurrences} occ / ${counts.deadUnique} uniq · 淘汰提名 ${counts.nominations} · 待修路径 ${counts.pathFixes} · 短路径 ${counts.tails} · 待重审 ${counts.revive}`);
}

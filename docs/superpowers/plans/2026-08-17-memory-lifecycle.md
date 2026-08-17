# Memory Entry Lifecycle + Broken-Reference Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find memory entries whose file references no longer exist, propose them for retirement with evidence, and on approval mark them retired without deleting anything.

**Architecture:** Four small modules in `tools/`, each exporting pure functions that a `.test.js` file drives directly. Filesystem access is injected as a predicate so the logic is testable without touching the real corpus. One module reads, one classifies, one reports, one writes — and only the last one writes.

**Tech Stack:** Node 20+ ESM, zero dependencies, `node --test "*/*.test.js"` (life-os convention — see `tools/gate.mjs` + `tools/gate.test.js` for the established tool/test pattern).

## Global Constraints

Copied from `docs/superpowers/specs/2026-08-17-memory-lifecycle-design.md`. Every task's requirements implicitly include these.

- **Zero dependencies.** life-os has no `dependencies` in `package.json`. No YAML library, no glob library. Native `node:fs`, `node:path` only.
- **Never round-trip the YAML.** Entry frontmatter contains a trailing space after `metadata: ` and nested keys. Parsing and re-serialising would reformat all 286 files. Lifecycle fields are inserted as text before the closing `---`.
- **Never delete, never edit a body.** No entry file is deleted, no index line is removed, no entry body byte is changed.
- **`ambiguous` is never evidence.** A path that exists under more than one root does not contribute to a nomination.
- **A tail match is not rot.** Entries write short paths: `src/api.js` for `cockpit-react/src/api.js`, `config/env.js` for `src/config/env.js`. Measured 2026-08-17: 7 of the 66 unique still-missing refs are this. They resolve as alive and are listed separately as entries whose paths are imprecise.
- **Measured baseline, 2026-08-17** (re-derive it in Task 6, do not trust these): 789 references extracted; **111** dead against AI-chatops alone; **66** unique still dead against all six roots; **7** of those are tail matches; **59** genuinely dead. The naive single-root number overstates rot by 47%.
- **A missing repo root aborts the run.** Not "skip that root" — abort. An unmounted directory would otherwise nominate hundreds of entries at once.
- **Counts are always reported.** Entries read and references resolved are printed even when there are zero nominations, so "nothing is rotten" is distinguishable from "the scan did not run".
- **This tool only ever writes `retired_reason: broken-reference`.** The other three enum values exist for later sub-projects.
- **Corpus path:** `~/.claude/projects/-Users-wengyong/memory/` — 286 entries plus `MEMORY.md`. It is a git working tree, so `git status` there is a valid check that the scan wrote nothing.
- **Root map:** `~/AI-chatops`, `~/life-os`, `~/cs-flow-builder`, `~/chatbot`, `~/PersonalNotes`, `~/Documents/DevNotes`.

---

## File Structure

| File | Responsibility |
|---|---|
| `tools/memory-lifecycle.mjs` | The only code that reads or writes lifecycle frontmatter. Text insertion, no YAML round-trip. |
| `tools/memory-lifecycle.test.js` | Body-preservation and idempotence properties. |
| `tools/memory-references.mjs` | Extract file references from an entry body; classify each against the root map. Filesystem injected. |
| `tools/memory-references.test.js` | The false-positive property and its mutation check. |
| `tools/scan-memory-rot.mjs` | Build the nomination report. Read-only. Aborts on a missing root. |
| `tools/scan-memory-rot.test.js` | Counts, abort-on-missing-root, zero-nomination distinguishability. |
| `tools/apply-retirement.mjs` | The only writer. Applies an approved report; moves index lines. |
| `tools/apply-retirement.test.js` | Re-verification, single-entry-line rule, index/status drift. |

---

### Task 1: Lifecycle frontmatter read/write

**Files:**
- Create: `tools/memory-lifecycle.mjs`
- Test: `tools/memory-lifecycle.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `frontmatterOf(src: string) -> { raw: string, length: number } | null`
  - `readStatus(src: string) -> 'active' | 'retired'`
  - `withRetirement(src: string, { at: string, reason: string, evidence: string[] }) -> string`

- [ ] **Step 1: Write the failing test**

Create `tools/memory-lifecycle.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { frontmatterOf, readStatus, withRetirement } from './memory-lifecycle.mjs';

/* A real entry's shape: note the trailing space after `metadata:` and the nested
 * keys. Reformatting either of those would rewrite all 286 files, so the tests
 * assert the original frontmatter text survives verbatim. */
const ENTRY = `---
name: ai-chatops-stale-branches
description: "The 6 unmerged branches"
metadata: 
  node_type: memory
  type: project
---

**CLEANED UP 2026-08-03: 167 local branches → 7.**

See \`scripts/daily-report.mjs\` for the old shape.
`;

test('an entry with no status field reads as active', () => {
  assert.equal(readStatus(ENTRY), 'active');
});

test('THE property: retiring preserves the body byte-for-byte', () => {
  const out = withRetirement(ENTRY, { at: '2026-08-17', reason: 'broken-reference', evidence: ['scripts/daily-report.mjs — not found in 6 roots'] });
  const bodyOf = (s) => s.slice(s.indexOf('\n---\n', 4) + 5);
  assert.equal(bodyOf(out), bodyOf(ENTRY), 'the body must not be touched');
});

test('THE property: the original frontmatter text survives verbatim', () => {
  const out = withRetirement(ENTRY, { at: '2026-08-17', reason: 'broken-reference', evidence: ['x'] });
  assert.ok(out.includes('metadata: \n'), 'the trailing space after `metadata:` was reformatted');
  assert.ok(out.includes('description: "The 6 unmerged branches"'));
});

test('retirement fields are written and read back', () => {
  const out = withRetirement(ENTRY, { at: '2026-08-17', reason: 'broken-reference', evidence: ['a', 'b'] });
  assert.equal(readStatus(out), 'retired');
  assert.ok(out.includes('retired_at: 2026-08-17'));
  assert.ok(out.includes('retired_reason: broken-reference'));
  assert.ok(out.includes('  a\n  b\n'), 'multi-line evidence must be indented under the block scalar');
});

test('retiring an already-retired entry changes nothing', () => {
  const once = withRetirement(ENTRY, { at: '2026-08-17', reason: 'broken-reference', evidence: ['x'] });
  const twice = withRetirement(once, { at: '2026-08-18', reason: 'broken-reference', evidence: ['y'] });
  assert.equal(twice, once, 're-running the applier must be idempotent');
});

test('an entry with no frontmatter is refused, not rewritten', () => {
  assert.throws(() => withRetirement('no frontmatter here\n', { at: '2026-08-17', reason: 'broken-reference', evidence: [] }), /frontmatter/);
  assert.equal(frontmatterOf('no frontmatter here\n'), null);
});

test('a nested `status:` key inside metadata is not mistaken for the top-level one', () => {
  const tricky = ENTRY.replace('  type: project', '  type: project\n  status: whatever');
  assert.equal(readStatus(tricky), 'active');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/life-os && node --test tools/memory-lifecycle.test.js`
Expected: FAIL — `Cannot find module './memory-lifecycle.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `tools/memory-lifecycle.mjs`:

```js
#!/usr/bin/env node
/* The only code that reads or writes lifecycle frontmatter on a memory entry.
 *
 * Text insertion, never a YAML round-trip. Entry frontmatter carries a trailing
 * space after `metadata: ` and nested keys; parsing and re-serialising would
 * reformat all 286 entries, turning a one-field change into a whole-corpus diff.
 * So the original frontmatter text is preserved verbatim and the new fields are
 * appended just before the closing `---`.
 *
 * Absent `status` means active. That is what makes this additive: 286 existing
 * entries need no migration and behave exactly as they do now.
 */

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

export function frontmatterOf(src) {
  const m = FM.exec(src);
  return m ? { raw: m[1], length: m[0].length } : null;
}

/* `^status:` with no leading whitespace — a `status:` nested under `metadata:`
 * is indented and must not be read as the entry's lifecycle state. */
export function readStatus(src) {
  const fm = frontmatterOf(src);
  if (!fm) return 'active';
  const m = /^status:[ \t]*(\S+)/m.exec(fm.raw);
  return m && m[1] === 'retired' ? 'retired' : 'active';
}

export function withRetirement(src, { at, reason, evidence = [] }) {
  const m = FM.exec(src);
  if (!m) throw new Error('memory-lifecycle: entry has no frontmatter — refusing to write');
  if (readStatus(src) === 'retired') return src;
  const block = [
    'status: retired',
    `retired_at: ${at}`,
    `retired_reason: ${reason}`,
    'retired_evidence: |',
    ...evidence.map((line) => `  ${line}`),
  ].join('\n');
  return `---\n${m[1]}\n${block}\n---\n${src.slice(m[0].length)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/life-os && node --test tools/memory-lifecycle.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
cd ~/life-os
git add tools/memory-lifecycle.mjs tools/memory-lifecycle.test.js
git commit -m "feat(memory): lifecycle frontmatter without a YAML round-trip"
```

---

### Task 2: Reference extraction and classification

**Files:**
- Create: `tools/memory-references.mjs`
- Test: `tools/memory-references.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_ROOTS: string[]`
  - `extractPaths(body: string) -> string[]` (deduped, sorted)
  - `classify(ref: string, { roots, exists, findByTail }) -> { state: 'alive'|'missing'|'ambiguous'|'tail', roots: string[], at?: string }`
    - `exists: (root: string, ref: string) => boolean`
    - `findByTail: (ref: string) => string | null` — the full path of a file whose trailing segments equal `ref`, or null. Optional; when omitted, no tail resolution happens.

Both filesystem functions are injected, so this module never touches the disk and the tests need no fixture tree.

`tail` is a fourth state, not a flavour of `alive`, because the two mean different things to the reader: the file exists, and the entry's path is imprecise and worth fixing. It is never a nomination.

- [ ] **Step 1: Write the failing test**

Create `tools/memory-references.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPaths, classify, DEFAULT_ROOTS } from './memory-references.mjs';

const ROOTS = ['/r/ai-chatops', '/r/life-os', '/r/cs-flow-builder'];
/* A fake filesystem: which relative paths exist under which root. */
const FS = {
  '/r/ai-chatops': new Set(['src/lib/cockpit/db.js']),
  '/r/life-os': new Set(['tools/gate.mjs', 'src/lib/cockpit/db.js']),
  '/r/cs-flow-builder': new Set(['src/store/useStore.js']),
};
const exists = (root, ref) => FS[root]?.has(ref) ?? false;
/* `src/api.js` in an entry means `cockpit-react/src/api.js` on disk — measured on 7 of 66. */
const TAILS = { 'src/api.js': '/r/ai-chatops/cockpit-react/src/api.js' };
const findByTail = (ref) => TAILS[ref] ?? null;
const opts = { roots: ROOTS, exists, findByTail };

test('extracts file paths from prose and inline code', () => {
  const body = 'See `src/lib/cockpit/db.js` and scripts/pm.mjs, plus docs/PM-INBOX.md.';
  assert.deepEqual(extractPaths(body), ['docs/PM-INBOX.md', 'scripts/pm.mjs', 'src/lib/cockpit/db.js']);
});

test('does not treat a bare word or a URL path as a file reference', () => {
  const body = 'Visit https://example.com/src/foo.js and note src/ is a directory.';
  assert.deepEqual(extractPaths(body), [], 'a URL path is not a repo path');
});

test('THE property: a path living under ANOTHER root is not missing', () => {
  // Measured 2026-08-17: resolving against AI-chatops alone calls 111 refs dead; against all six
  // roots, 66. Without the root map the report is wrong about 40% of its rows.
  assert.deepEqual(classify('src/store/useStore.js', opts), { state: 'alive', roots: ['/r/cs-flow-builder'] });
});

test('a path that exists under two roots is ambiguous, which is NOT evidence', () => {
  const r = classify('src/lib/cockpit/db.js', opts);
  assert.equal(r.state, 'ambiguous');
  assert.equal(r.roots.length, 2);
});

test('a path found nowhere is missing', () => {
  assert.deepEqual(classify('scripts/daily-report.mjs', opts), { state: 'missing', roots: [] });
});

test('THE property: a short path that matches a real file by tail is NOT rot', () => {
  // 7 of the 66 still-missing refs are this: the entry wrote `src/api.js` for a file that lives
  // at cockpit-react/src/api.js. Nominating those retires entries that are still correct.
  const r = classify('src/api.js', opts);
  assert.equal(r.state, 'tail');
  assert.equal(r.at, '/r/ai-chatops/cockpit-react/src/api.js');
});

test('tail resolution is skipped when no resolver is supplied', () => {
  assert.equal(classify('src/api.js', { roots: ROOTS, exists }).state, 'missing');
});

test('the default root map names all six roots', () => {
  assert.equal(DEFAULT_ROOTS.length, 6);
  assert.ok(DEFAULT_ROOTS.some((r) => r.endsWith('/cs-flow-builder')), 'cs-flow-builder is the root that made 2 of 6 sampled flags false');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/life-os && node --test tools/memory-references.test.js`
Expected: FAIL — `Cannot find module './memory-references.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `tools/memory-references.mjs`:

```js
#!/usr/bin/env node
/* Extract repo-relative file references from a memory entry, and classify each
 * one against every known repo root.
 *
 * The root map is the load-bearing part, not a config detail. Measured
 * 2026-08-17: resolving against AI-chatops alone flags 88 of 565 referenced
 * paths as dead, and 2 of a 6-path sample were false — they live in
 * cs-flow-builder. A report that is wrong about a third of its rows stops being
 * read, and then the governance list is the blind spot it was built to close.
 *
 * `ambiguous` (the same relative path under more than one root) is never
 * evidence of rot: we cannot tell which root the entry meant.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

const H = homedir();
export const DEFAULT_ROOTS = [
  join(H, 'AI-chatops'),
  join(H, 'life-os'),
  join(H, 'cs-flow-builder'),
  join(H, 'chatbot'),
  join(H, 'PersonalNotes'),
  join(H, 'Documents/DevNotes'),
];

/* Repo-relative paths only: a known top directory, then at least one more
 * segment, ending in a real extension. Anything preceded by `/` is skipped so a
 * URL path cannot masquerade as a repo path. */
const PATH_RE = /(^|[^\w/.-])((?:src|scripts|docs|tools|cockpit-react|tests|config)\/[\w./-]*\.\w{1,6})/g;

export function extractPaths(body) {
  const out = new Set();
  for (const m of body.matchAll(PATH_RE)) out.add(m[2]);
  return [...out].sort();
}

export function classify(ref, { roots, exists, findByTail }) {
  const hits = roots.filter((root) => exists(root, ref));
  if (hits.length > 1) return { state: 'ambiguous', roots: hits };
  if (hits.length === 1) return { state: 'alive', roots: hits };
  /* Not found at the path as written. Entries routinely write a short path —
   * `src/api.js` for cockpit-react/src/api.js, `config/env.js` for
   * src/config/env.js — and 7 of the 66 still-missing refs measured on
   * 2026-08-17 are exactly that. The file exists; the entry's path is imprecise.
   * Retiring those would delete knowledge that is still true. */
  const at = findByTail ? findByTail(ref) : null;
  return at ? { state: 'tail', roots: [], at } : { state: 'missing', roots: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/life-os && node --test tools/memory-references.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Mutation check — prove both false-positive tests have teeth**

Run each mutation separately and revert it before trying the next.

Mutation A — ignore every root but the first:

```js
const hits = roots.slice(0, 1).filter((root) => exists(root, ref));   // MUTANT A
```
Expected: FAIL on "a path living under ANOTHER root is not missing".

Mutation B — drop tail resolution:

```js
const at = null;   // MUTANT B
```
Expected: FAIL on "a short path that matches a real file by tail is NOT rot".

If either mutation leaves the suite green, that test is decorative — fix the test before
continuing. Revert both and re-run: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
cd ~/life-os
git add tools/memory-references.mjs tools/memory-references.test.js
git commit -m "feat(memory): resolve entry references across all six repo roots"
```

---

### Task 3: The scan and its report

**Files:**
- Create: `tools/scan-memory-rot.mjs`
- Test: `tools/scan-memory-rot.test.js`

**Interfaces:**
- Consumes: `extractPaths`, `classify`, `DEFAULT_ROOTS` (Task 2); `readStatus` (Task 1).
- Produces:
  - `buildReport({ entries, roots, exists, findByTail, today }) -> { markdown, counts: { entries, refs, nominations, tails } }` where `entries` is `Array<{ name: string, src: string }>`
  - `assertRootsPresent(roots, isDir: (p: string) => boolean) -> void` (throws)
  - `buildTailIndex(roots, readdir) -> Map<string, string>` — every trailing-segment form of every file under each root, mapped to its full path. `readdir: (dir) => Array<{ name, isDirectory }>`, injected for testability. Skips `node_modules`, `.git`, `dist`; depth-capped at 6.

- [ ] **Step 1: Write the failing test**

Create `tools/scan-memory-rot.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, assertRootsPresent } from './scan-memory-rot.mjs';

const ROOTS = ['/r/ai-chatops', '/r/cs-flow-builder'];
const FS = {
  '/r/ai-chatops': new Set(['src/lib/cockpit/db.js']),
  '/r/cs-flow-builder': new Set(['src/store/useStore.js']),
};
const exists = (root, ref) => FS[root]?.has(ref) ?? false;
const entry = (name, body) => ({ name, src: `---\nname: ${name}\n---\n\n${body}\n` });

test('THE property: an entry whose paths all resolve is not nominated', () => {
  const r = buildReport({
    entries: [entry('a', 'uses `src/store/useStore.js` in the other repo')],
    roots: ROOTS, exists, today: '2026-08-17',
  });
  assert.equal(r.counts.nominations, 0);
});

test('an entry with a dead path is nominated, with the roots searched named', () => {
  const r = buildReport({
    entries: [entry('b', 'see `scripts/daily-report.mjs`')],
    roots: ROOTS, exists, today: '2026-08-17',
  });
  assert.equal(r.counts.nominations, 1);
  assert.match(r.markdown, /scripts\/daily-report\.mjs/);
  assert.match(r.markdown, /cs-flow-builder/, 'the report must say which roots were searched');
});

test('THE property: zero nominations still reports the counts', () => {
  // An empty report with no counts is indistinguishable from a scan that never ran.
  const r = buildReport({ entries: [entry('a', 'no paths here')], roots: ROOTS, exists, today: '2026-08-17' });
  assert.equal(r.counts.nominations, 0);
  assert.equal(r.counts.entries, 1);
  assert.match(r.markdown, /entries read: 1/);
  assert.match(r.markdown, /references resolved: 0/);
});

test('an already-retired entry is not nominated again', () => {
  const retired = { name: 'c', src: '---\nname: c\nstatus: retired\n---\n\nsee `scripts/gone.mjs`\n' };
  const r = buildReport({ entries: [retired], roots: ROOTS, exists, today: '2026-08-17' });
  assert.equal(r.counts.nominations, 0);
});

test('THE property: a missing repo root aborts instead of nominating everything', () => {
  const isDir = (p) => p !== '/r/cs-flow-builder';
  assert.throws(() => assertRootsPresent(ROOTS, isDir), /cs-flow-builder/);
  assert.doesNotThrow(() => assertRootsPresent(ROOTS, () => true));
});

test('THE property: a short path is listed separately, never nominated', () => {
  const r = buildReport({
    entries: [entry('f', 'see `src/api.js`')],
    roots: ROOTS, exists, findByTail: (ref) => (ref === 'src/api.js' ? '/r/ai-chatops/cockpit-react/src/api.js' : null),
    today: '2026-08-17',
  });
  assert.equal(r.counts.nominations, 0, 'an imprecise path is not rot');
  assert.equal(r.counts.tails, 1);
  assert.match(r.markdown, /## 路径写短了/);
  assert.match(r.markdown, /cockpit-react\/src\/api\.js/);
});

test('buildTailIndex maps every trailing form, shallowest wins', () => {
  const tree = {
    '/r': [{ name: 'cockpit-react', isDirectory: true }],
    '/r/cockpit-react': [{ name: 'src', isDirectory: true }],
    '/r/cockpit-react/src': [{ name: 'api.js', isDirectory: false }],
  };
  const idx = buildTailIndex(['/r'], (d) => tree[d] ?? []);
  assert.equal(idx.get('src/api.js'), '/r/cockpit-react/src/api.js');
  assert.equal(idx.get('api.js'), '/r/cockpit-react/src/api.js');
  assert.equal(idx.get('cockpit-react/src/api.js'), '/r/cockpit-react/src/api.js');
});

test('buildTailIndex skips node_modules', () => {
  const tree = {
    '/r': [{ name: 'node_modules', isDirectory: true }, { name: 'src', isDirectory: true }],
    '/r/node_modules': [{ name: 'evil.js', isDirectory: false }],
    '/r/src': [{ name: 'real.js', isDirectory: false }],
  };
  const idx = buildTailIndex(['/r'], (d) => tree[d] ?? []);
  assert.equal(idx.get('evil.js'), undefined);
  assert.equal(idx.get('src/real.js'), '/r/src/real.js');
});
```

Update the import line at the top of this file to include the new export:

```js
import { buildReport, assertRootsPresent, buildTailIndex } from './scan-memory-rot.mjs';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/life-os && node --test tools/scan-memory-rot.test.js`
Expected: FAIL — `Cannot find module './scan-memory-rot.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `tools/scan-memory-rot.mjs`:

```js
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
  for (const { name, src } of entries) {
    if (readStatus(src) === 'retired') continue;
    const dead = [];
    for (const ref of extractPaths(src)) {
      refs += 1;
      const c = classify(ref, { roots, exists, findByTail });
      if (c.state === 'missing') dead.push(ref);
      else if (c.state === 'tail') tails.push(`${name} — ${ref} → ${c.at}`);
    }
    if (dead.length) nominations.push({ name, dead });
  }
  const lines = [
    `# Memory rot — nominations ${today}`,
    '',
    `entries read: ${entries.length}`,
    `references resolved: ${refs}`,
    `nominations: ${nominations.length}`,
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
  return { markdown: lines.join('\n'), counts: { entries: entries.length, refs, nominations: nominations.length, tails: tails.length } };
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
  console.log(`${out}\nentries ${counts.entries} · refs ${counts.refs} · nominations ${counts.nominations}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/life-os && node --test tools/scan-memory-rot.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
cd ~/life-os
git add tools/scan-memory-rot.mjs tools/scan-memory-rot.test.js
git commit -m "feat(memory): read-only rot scan that aborts on a missing root"
```

---

### Task 4: Apply retirement

**Files:**
- Create: `tools/apply-retirement.mjs`
- Test: `tools/apply-retirement.test.js`

**Interfaces:**
- Consumes: `withRetirement`, `readStatus` (Task 1); `extractPaths`, `classify` (Task 2).
- Produces:
  - `parseApproved(markdown: string) -> Array<{ name: string, dead: string[] }>`
  - `moveIndexLine(memoryMd: string, slug: string) -> { text: string, moved: boolean, reason: string }`

`MEMORY.md` is a flat list of `- ` lines with no headings. One line can reference **several** entries — the first line links both `resume-next-session.md` and `check-main-before-merging-2026-08-11.md`. Moving such a line would drag unrelated entries into the retired section, so only single-entry lines move; the rest are reported for manual handling.

- [ ] **Step 1: Write the failing test**

Create `tools/apply-retirement.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApproved, moveIndexLine } from './apply-retirement.mjs';

const REPORT = `# Memory rot — nominations 2026-08-17

entries read: 286
references resolved: 565
nominations: 2

- [ ] alpha-entry — scripts/gone.mjs, docs/also-gone.md
- [ ] beta-entry — src/vanished.js
`;

test('parses the approved rows and their evidence', () => {
  assert.deepEqual(parseApproved(REPORT), [
    { name: 'alpha-entry', dead: ['scripts/gone.mjs', 'docs/also-gone.md'] },
    { name: 'beta-entry', dead: ['src/vanished.js'] },
  ]);
});

test('a row the user deleted is simply absent — deletion IS the rejection', () => {
  const trimmed = REPORT.replace('- [ ] beta-entry — src/vanished.js\n', '');
  assert.deepEqual(parseApproved(trimmed).map((r) => r.name), ['alpha-entry']);
});

const INDEX = `- 👉 **两条:** [A](alpha-entry.md) · [B](beta-entry.md) — 双引用行
- 📦 **[Solo](solo-entry.md)** — 单引用行
`;

test('THE property: a single-entry index line moves under 已淘汰', () => {
  const r = moveIndexLine(INDEX, 'solo-entry');
  assert.equal(r.moved, true);
  assert.match(r.text, /## 已淘汰\n/);
  assert.ok(r.text.indexOf('solo-entry.md') > r.text.indexOf('## 已淘汰'), 'the line must end up below the heading');
  assert.match(r.text, /alpha-entry\.md/, 'other lines are untouched');
});

test('THE property: a line referencing several entries is NOT moved', () => {
  // Moving it would retire beta-entry too, which nobody approved.
  const r = moveIndexLine(INDEX, 'alpha-entry');
  assert.equal(r.moved, false);
  assert.match(r.reason, /2 entries|multiple/i);
  assert.equal(r.text, INDEX, 'the index must be left byte-identical when the move is refused');
});

test('an entry with no index line is reported, not invented', () => {
  const r = moveIndexLine(INDEX, 'not-listed');
  assert.equal(r.moved, false);
  assert.match(r.reason, /no index line/i);
});

test('the 已淘汰 heading is created once, not per retirement', () => {
  const once = moveIndexLine(INDEX, 'solo-entry').text;
  const withSecond = once.replace('- 👉 **两条:**', '- 🧩 **[C](gamma.md)** — x\n- 👉 **两条:**');
  const twice = moveIndexLine(withSecond, 'gamma').text;
  assert.equal(twice.split('## 已淘汰').length - 1, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/life-os && node --test tools/apply-retirement.test.js`
Expected: FAIL — `Cannot find module './apply-retirement.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `tools/apply-retirement.mjs`:

```js
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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { withRetirement } from './memory-lifecycle.mjs';
import { classify, DEFAULT_ROOTS } from './memory-references.mjs';
import { CORPUS, buildTailIndex } from './scan-memory-rot.mjs';

const ROW = /^- \[ \] (\S+) — (.+)$/gm;
const HEADING = '## 已淘汰';

export function parseApproved(markdown) {
  return [...markdown.matchAll(ROW)].map((m) => ({
    name: m[1],
    dead: m[2].split(',').map((s) => s.trim()).filter(Boolean),
  }));
}

/* MEMORY.md is a flat list of `- ` lines with no headings at all, so the first
 * retirement introduces the only heading in the file. A line can link several
 * entries; moving one of those would retire the others by association, so it is
 * refused and reported instead. */
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
  for (const s of skipped) console.log(`  skipped//partial: ${s}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/life-os && node --test tools/apply-retirement.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
cd ~/life-os
git add tools/apply-retirement.mjs tools/apply-retirement.test.js
git commit -m "feat(memory): apply retirement, re-verifying each row and refusing shared index lines"
```

---

### Task 5: The list must be checked in both directions

**Files:**
- Modify: `tools/scan-memory-rot.mjs` (add `reviveCandidates`, include the section in the report)
- Modify: `tools/scan-memory-rot.test.js` (add the tests below)

**Interfaces:**
- Consumes: `readStatus` (Task 1); `extractPaths`, `classify` (Task 2).
- Produces: `reviveCandidates({ entries, roots, exists }) -> Array<{ name: string, backAlive: string[] }>`

A retired entry whose references are alive again hides a fact that has become true. An exemption list checked in only one direction becomes the hole it was built to close.

- [ ] **Step 1: Write the failing test**

Append to `tools/scan-memory-rot.test.js`:

```js
import { reviveCandidates } from './scan-memory-rot.mjs';

test('THE property: a retired entry whose references came back is flagged for re-review', () => {
  const retired = { name: 'c', src: '---\nname: c\nstatus: retired\n---\n\nsee `src/store/useStore.js`\n' };
  const got = reviveCandidates({ entries: [retired], roots: ROOTS, exists });
  assert.deepEqual(got, [{ name: 'c', backAlive: ['src/store/useStore.js'] }]);
});

test('a retired entry whose references are still dead is not flagged', () => {
  const retired = { name: 'd', src: '---\nname: d\nstatus: retired\n---\n\nsee `scripts/still-gone.mjs`\n' };
  assert.deepEqual(reviveCandidates({ entries: [retired], roots: ROOTS, exists }), []);
});

test('an active entry is never a revive candidate', () => {
  assert.deepEqual(reviveCandidates({ entries: [entry('e', 'see `src/store/useStore.js`')], roots: ROOTS, exists }), []);
});

test('a retired entry whose short path now resolves by tail is also a revive candidate', () => {
  const retired = { name: 'g', src: '---\nname: g\nstatus: retired\n---\n\nsee `src/api.js`\n' };
  const got = reviveCandidates({ entries: [retired], roots: ROOTS, exists, findByTail: (r) => (r === 'src/api.js' ? '/r/ai-chatops/cockpit-react/src/api.js' : null) });
  assert.deepEqual(got, [{ name: 'g', backAlive: ['src/api.js'] }]);
});

test('revive candidates appear in the report under their own heading', () => {
  const retired = { name: 'c', src: '---\nname: c\nstatus: retired\n---\n\nsee `src/store/useStore.js`\n' };
  const r = buildReport({ entries: [retired], roots: ROOTS, exists, today: '2026-08-17' });
  assert.match(r.markdown, /## 待重审/);
  assert.match(r.markdown, /src\/store\/useStore\.js/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/life-os && node --test tools/scan-memory-rot.test.js`
Expected: FAIL — `reviveCandidates is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `tools/scan-memory-rot.mjs`, above `buildReport`:

```js
/* The other direction. A retired entry whose dead references are alive again is
 * a retirement that may no longer hold — and a stale `retired` marker hides a
 * fact that has become true, which is exactly how an exemption list turns into
 * the hole it was built to close. */
export function reviveCandidates({ entries, roots, exists, findByTail }) {
  const out = [];
  for (const { name, src } of entries) {
    if (readStatus(src) !== 'retired') continue;
    const backAlive = extractPaths(src).filter((ref) => classify(ref, { roots, exists, findByTail }).state !== 'missing');
    if (backAlive.length) out.push({ name, backAlive });
  }
  return out;
}
```

Then, in `buildReport`, accept the same inputs and append the section. Replace the `const lines = [...]` block's tail (everything from the nominations `.map(...)` line onward) with:

```js
    ...nominations.map(({ name, dead }) => `- [ ] ${name} — ${dead.join(', ')}`),
    '',
    '## 待重审',
    '',
    'Retired entries whose references are alive again. Not automatic — decide each one.',
    '',
    ...reviveCandidates({ entries, roots, exists, findByTail }).map(({ name, backAlive }) => `- ${name} — ${backAlive.join(', ')}`),
    '',
  ];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/life-os && node --test tools/scan-memory-rot.test.js`
Expected: PASS, 14 tests

- [ ] **Step 5: Run the whole suite**

Run: `cd ~/life-os && npm test`
Expected: all tests pass, including the pre-existing `improve/coach.test.js`, `tools/gate.test.js`, `tools/loop-guard.test.js`, `tools/backup-db.test.js`, `tools/sw-precache.test.js`.

- [ ] **Step 6: Commit**

```bash
cd ~/life-os
git add tools/scan-memory-rot.mjs tools/scan-memory-rot.test.js
git commit -m "feat(memory): flag retirements whose references came back to life"
```

---

### Task 6: Acceptance against the real 286 entries

Fixtures prove the logic; only the real corpus proves the tool. This task produces evidence, not code.

**Files:**
- Create: `docs/reports/memory-rot-<today>.md` (produced by the run, committed as the record)

**Interfaces:**
- Consumes: everything above. Produces: nothing further tasks depend on.

- [ ] **Step 1: Confirm the corpus is clean before the run**

```bash
cd ~/.claude/projects/-Users-wengyong/memory && git status --porcelain | head
```
Expected: whatever is already dirty, noted down. This is the baseline the next step compares against — the scan must not add to it.

- [ ] **Step 2: Run the scan**

```bash
cd ~/life-os && node tools/scan-memory-rot.mjs
```
Expected: prints the report path and `entries N · refs M · nominations K`.

Measured with this exact regex and root map on 2026-08-17: **789 references** across ~286 entries,
**66 unique still-missing**, **7 of those tail matches**, so **≈59 genuine nominations**. Treat
these as the shape to sanity-check against, not as a pass condition — the corpus moves.

Two failure signals: `M` near 0 means the extractor is broken; `K` near 111 means the root map is
not being applied (111 is the single-root number). Do not proceed on either.

- [ ] **Step 3: Prove the scan wrote nothing to the corpus**

```bash
cd ~/.claude/projects/-Users-wengyong/memory && git status --porcelain | head
```
Expected: byte-identical to Step 1's output. Any new entry in this list means the "read-only" claim is false.

- [ ] **Step 4: Record the root-map effect as a number**

```bash
cd ~/life-os && node -e "
import('./tools/memory-references.mjs').then(async ({ extractPaths, classify, DEFAULT_ROOTS }) => {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const C = join(process.env.HOME, '.claude/projects/-Users-wengyong/memory');
  const ex = (root, ref) => existsSync(join(root, ref));
  let one = 0, all = 0, amb = 0, total = 0;
  for (const f of readdirSync(C).filter(x => x.endsWith('.md') && x !== 'MEMORY.md')) {
    for (const ref of extractPaths(readFileSync(join(C, f), 'utf8'))) {
      total++;
      if (!ex(DEFAULT_ROOTS[0], ref)) one++;
      const c = classify(ref, DEFAULT_ROOTS, ex);
      if (c.state === 'missing') all++;
      if (c.state === 'ambiguous') amb++;
    }
  }
  console.log({ total, deadAgainstAIChatopsOnly: one, deadAgainstAllRoots: all, ambiguous: amb });
});
"
```
Expected: `deadAgainstAllRoots` is materially lower than `deadAgainstAIChatopsOnly` (the 2026-08-17 single-root baseline was 88 of 565). **Write both numbers into the report's header** — the reduction is the tool's headline claim and must be a number, not an adjective.

- [ ] **Step 5: Hand-check the two samples that motivated the two false-positive guards**

```bash
grep -E "^- \[ \].*(useStore|compile-golden)" ~/life-os/docs/reports/memory-rot-*.md
grep -E "^- \[ \].*(src/api\.js|config/env\.js)" ~/life-os/docs/reports/memory-rot-*.md
```
Expected: **no output from either.** The first pair lives in `cs-flow-builder` — if they are nominated, the root map is not applied. The second pair resolves by tail to `cockpit-react/src/api.js` and `src/config/env.js` — if they are nominated, tail resolution is not applied. Both greps are anchored to nomination rows (`- [ ]`) on purpose: those paths SHOULD appear in the 路径写短了 section, and an unanchored grep would hide the bug by matching there.

- [ ] **Step 6: Spot-check three nominations by hand**

Pick three rows from the report and, for each, run `ls <root>/<path>` across all six roots to confirm the file really is gone everywhere. Note any that turn out to be renames rather than deletions — the tool reports a rename as a deletion and the spec says so, but a report full of renames means the retirement bar needs rethinking before anything is applied.

- [ ] **Step 7: Commit the report as the record**

```bash
cd ~/life-os
git add docs/reports/memory-rot-*.md
git commit -m "chore(memory): first rot scan against the live 286-entry corpus"
```

- [ ] **Step 8: Stop. Do not run apply-retirement.**

Applying is Weng's decision on a report he has read. The plan ends with the report on disk and the numbers in hand.

---

## Self-Review

**Amendment made while writing this plan:** the regex and root map were run against the real
corpus before the plan was finalised, which surfaced a third false-positive class the spec does not
mention — entries writing short paths (`src/api.js` for `cockpit-react/src/api.js`), 7 of 66. The
`tail` state, `buildTailIndex`, and their tests were added here. The spec should be amended to
match; until it is, this plan is the more accurate document on that one point.

**Spec coverage:** Every spec section maps to a task — schema → Task 1; root map and `ambiguous` → Task 2; report, counts, abort-on-missing-root → Task 3; the only writer, index handling, re-verification → Task 4; bidirectional list → Task 5; real-data acceptance including the `cs-flow-builder` check → Task 6. The spec's "unparseable frontmatter is reported and skipped" is covered by Task 1's throw plus Task 4's `existsSync`/skip path.

**Known gap, deliberate:** the spec's `## Anti-rot` also requires that `MEMORY.md` and entry status cannot drift (an active entry sitting under `已淘汰`). Task 5 covers the retired→alive direction only. The index-drift check needs the index and the entries read together, which no task does today; it is listed here rather than silently dropped, and belongs in the next sub-project alongside the weekly runner.

**Placeholders:** none — every step carries the code or command it needs.

**Type consistency:** `readStatus`, `withRetirement`, `extractPaths`, `classify`, `DEFAULT_ROOTS`, `buildReport`, `assertRootsPresent`, `reviveCandidates`, `parseApproved`, `moveIndexLine`, `CORPUS` are each defined once and used with the same signature everywhere. `entries` is `Array<{ name, src }>` in every function that takes it.

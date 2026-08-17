import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, assertRootsPresent, buildTailIndex, reviveCandidates } from './scan-memory-rot.mjs';

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

test('THE property: dead references are counted BOTH ways, occurrences and unique', () => {
  // 76 occurrences vs 66 unique on the live corpus — the same dead path referenced by three
  // entries counts three times in one and once in the other. A report printing only one of them
  // cannot be reconciled against a later run that printed the other.
  const r = buildReport({
    entries: [entry('x', 'see `scripts/gone.mjs`'), entry('y', 'also `scripts/gone.mjs`'), entry('z', 'and `docs/other.md`')],
    roots: ROOTS, exists, today: '2026-08-17',
  });
  assert.equal(r.counts.deadOccurrences, 3, 'gone.mjs twice + other.md once');
  assert.equal(r.counts.deadUnique, 2, 'gone.mjs and other.md');
  assert.match(r.markdown, /dead references: 3 occurrences · 2 unique/);
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

/* ── The other direction: a retirement that may no longer hold ──────────────────────────────── */

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

/* ── The unit of nomination: a dead reference is not a dead entry ────────────────────────────── */

test('THE property: an entry with only SOME dead refs is NOT nominated for retirement', () => {
  // ai-chatops-stale-branches has 2 dead refs out of 9 and was updated today. Retiring it for
  // those 2 would delete knowledge that is live. The entry is still true; two paths are stale.
  const r = buildReport({
    entries: [entry('mixed', 'alive `src/store/useStore.js` and dead `scripts/gone.mjs`')],
    roots: ROOTS, exists, today: '2026-08-17',
  });
  assert.equal(r.counts.nominations, 0, 'a partially-stale entry must not be retired');
  assert.equal(r.counts.pathFixes, 1);
  assert.match(r.markdown, /## 待修路径/);
  assert.match(r.markdown, /mixed — scripts\/gone\.mjs/);
});

test('THE property: an entry whose refs are ALL dead IS nominated', () => {
  const r = buildReport({
    entries: [entry('rotten', 'see `scripts/gone.mjs` and `docs/also-gone.md`')],
    roots: ROOTS, exists, today: '2026-08-17',
  });
  assert.equal(r.counts.nominations, 1);
  assert.equal(r.counts.pathFixes, 0);
  assert.match(r.markdown, /- \[ \] rotten/);
});

test('THE property: an entry with NO references at all is never nominated', () => {
  // 0 dead of 0 refs satisfies "all refs are dead" arithmetically. Advice and preferences have
  // no anchor to check, and nominating them would retire the corpus by degrees.
  const r = buildReport({
    entries: [entry('advice', 'always run the tests before pushing')],
    roots: ROOTS, exists, today: '2026-08-17',
  });
  assert.equal(r.counts.nominations, 0, 'an entry with nothing to check cannot be evidence of rot');
  assert.equal(r.counts.pathFixes, 0);
});

test('the path-fix rows carry the ratio, so a 6-of-92 entry reads differently from a 5-of-6', () => {
  const r = buildReport({
    entries: [entry('mixed', 'alive `src/store/useStore.js` and dead `scripts/gone.mjs`')],
    roots: ROOTS, exists, today: '2026-08-17',
  });
  assert.match(r.markdown, /1\/2/, 'the report must show how much of the entry is stale');
});

test('path-fix rows are plain `- `, so the applier can never read them as approvals', () => {
  const r = buildReport({
    entries: [entry('mixed', 'alive `src/store/useStore.js` and dead `scripts/gone.mjs`')],
    roots: ROOTS, exists, today: '2026-08-17',
  });
  const approvalRows = [...r.markdown.matchAll(/^- \[ \] /gm)].length;
  assert.equal(approvalRows, 0, 'a path-fix row written as an approval row would retire the entry');
});

/* ── Index membership: a strong signal, surfaced not automated ───────────────────────────────── */

test('THE property: nominations say whether the entry is still in the active index', () => {
  // An entry still linked from MEMORY.md is one Weng curates; one that is not has already been
  // dropped from the injected index and is de-facto retired without a marker. The signal is
  // reported, never acted on: MEMORY.md was rewritten by another session DURING this scan, so
  // treating it as authoritative would let one session's edit retire another's entry.
  const index = '- 📦 **[Kept](rotten.md)** — still curated\n';
  const r = buildReport({
    entries: [entry('rotten', 'see `scripts/gone.mjs`'), entry('orphan', 'see `docs/also-gone.md`')],
    roots: ROOTS, exists, today: '2026-08-17', index,
  });
  assert.match(r.markdown, /- \[ \] rotten .*索引中/, 'an indexed entry must be marked as curated');
  assert.match(r.markdown, /- \[ \] orphan .*不在索引/, 'an unindexed entry must be marked');
});

test('without an index the rows carry no membership claim at all', () => {
  const r = buildReport({ entries: [entry('rotten', 'see `scripts/gone.mjs`')], roots: ROOTS, exists, today: '2026-08-17' });
  assert.ok(!/索引/.test(r.markdown), 'no index supplied means no claim, not a false "not indexed"');
});

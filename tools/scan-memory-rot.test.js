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

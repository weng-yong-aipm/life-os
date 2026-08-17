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

test('does not treat a URL path as a file reference', () => {
  const body = 'Visit https://example.com/src/foo.js for details.';
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

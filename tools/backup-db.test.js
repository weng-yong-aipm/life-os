import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tablesFromOpenApi,
  bucketsFromList,
  parseContentRange,
  coverageReport,
  isSafeObjectKey,
} from './backup-db.mjs';

/* Shaped like the real PostgREST root: the doc path, two RPCs, and the
 * relations. `sets` and `sleep` are the tables that migrations added after the
 * old hardcoded array was frozen — the ones the 2026-08-05 run silently skipped. */
const OPENAPI = {
  swagger: '2.0',
  paths: {
    '/': {},
    '/receipts': {},
    '/feed_items': {},
    '/sleep': {},
    '/sets': {},
    '/rpc/rls_auto_enable': {},
    '/rpc/requires_aal2': {},
  },
};

test('table discovery reads the live schema, so a new table needs no code change', () => {
  assert.deepEqual(tablesFromOpenApi(OPENAPI), ['feed_items', 'receipts', 'sets', 'sleep']);
});

test('discovery drops the root doc and stored procedures, which are not relations', () => {
  const names = tablesFromOpenApi(OPENAPI);
  assert.ok(!names.includes(''));
  assert.ok(!names.some((n) => n.startsWith('rpc/')));
});

test('a spec with no paths yields no tables (and coverage turns that into a failure)', () => {
  assert.deepEqual(tablesFromOpenApi({}), []);
  assert.deepEqual(tablesFromOpenApi(null), []);
  assert.equal(coverageReport([], new Map()).ok, false);
});

test('bucket discovery covers every live bucket, including public ones', () => {
  const live = [
    { id: 'receipts', name: 'receipts', public: false },
    { id: 'meals', name: 'meals', public: false },
    { id: 'exercise-media', name: 'exercise-media', public: true },
  ];
  assert.deepEqual(bucketsFromList(live), ['exercise-media', 'meals', 'receipts']);
  assert.deepEqual(bucketsFromList(null), []);
});

test('Content-Range gives the true total, including the empty-relation form', () => {
  assert.deepEqual(parseContentRange('0-999/4213'), { from: 0, to: 999, total: 4213 });
  assert.deepEqual(parseContentRange('*/0'), { from: null, to: null, total: 0 });
  assert.deepEqual(parseContentRange('0-9/*'), { from: 0, to: 9, total: null });
});

test('an unparseable Content-Range is null, never mistaken for "no more rows"', () => {
  assert.equal(parseContentRange(undefined), null);
  assert.equal(parseContentRange(''), null);
  assert.equal(parseContentRange('rows 0-9'), null);
});

test('coverage passes only when every discovered table is on disk with the right count', () => {
  const r = coverageReport(['receipts', 'sleep'], {
    receipts: { rows: 3, expected: 3 },
    sleep: { rows: 0, expected: 0 },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reasons, []);
});

test('the 2026-08-05 defect: a discovered table with no backup file FAILS', () => {
  const r = coverageReport(['receipts', 'sets'], { receipts: { rows: 3, expected: 3 } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['sets']);
  assert.match(r.reasons.join(' '), /sets/);
});

test('a half-written table fails: fewer rows on disk than the API counted', () => {
  const r = coverageReport(['feed_items'], { feed_items: { rows: 1000, expected: 4213 } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.mismatched, [{ name: 'feed_items', onDisk: 1000, expected: 4213 }]);
});

test('a corrupt backup file fails rather than counting as covered', () => {
  const r = coverageReport(['meals'], { meals: { error: 'Unexpected end of JSON input' } });
  assert.equal(r.ok, false);
  assert.equal(r.unreadable.length, 1);
});

test('extra files on disk do not mask a missing table', () => {
  const r = coverageReport(['sets'], { receipts: { rows: 9, expected: 9 } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['sets']);
});

test('storage keys that would escape the backup directory are rejected', () => {
  assert.equal(isSafeObjectKey('barbell-curl/674.png'), true);
  assert.equal(isSafeObjectKey('674.png'), true);
  assert.equal(isSafeObjectKey('../../.env'), false);
  assert.equal(isSafeObjectKey('a/../../b'), false);
  assert.equal(isSafeObjectKey('/etc/passwd'), false);
  assert.equal(isSafeObjectKey(''), false);
});
